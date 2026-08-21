#!/usr/bin/env node
// M0 收尾 UI 观察：crash-without-stop 与 Stop 超时（ASTER_PI_STOP_WAIT_MS 注入）。
// 前置：
//   1) 以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动 debug aster.exe
//      并在环境里给 aster 进程设 ASTER_PI_STOP_WAIT_MS=200（Stop 预算压到 200ms，
//      taskkill 之后的 try_wait 必然超时，稳定复现 TimedOut）。
//   2) 本脚本用 CDP 驱动页面；Pi 已托管 0.84.2，且当前停在 Pi 模块。
// 用法：node scripts/evidence/m0-crash-stop-timeout-ui.mjs [--cdp-port 9222]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const HOME = os.homedir();
const LOCAL = process.env.LOCALAPPDATA || "";
const SHOT_DIR = path.join("docs", "evidence");

function tokenize(p) {
  if (p == null) return p;
  return String(p).replaceAll(HOME, "%USERPROFILE%").replaceAll(LOCAL, "%LOCALAPPDATA%");
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list HTTP ${res.status}`);
  return res.json();
}

function callCdp(wsUrl, method, params = {}, timeoutMs = 180000) {
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error(`CDP ${method} timeout`));
    }, timeoutMs);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
    ws.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(new Error(String(e.message || e)));
    });
  });
}

async function evalJs(wsUrl, expression, timeoutMs = 180000) {
  const result = await callCdp(
    wsUrl,
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    timeoutMs,
  );
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description || result.exceptionDetails.text || "js",
    );
  }
  return result.result?.value;
}

async function shot(wsUrl, name) {
  await callCdp(wsUrl, "Page.enable").catch(() => {});
  const result = await callCdp(wsUrl, "Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const out = path.join(SHOT_DIR, name);
  fs.writeFileSync(out, Buffer.from(result.data, "base64"));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function piNodePids() {
  return new Promise((resolve) => {
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*pi-coding-agent*' } | Select-Object -ExpandProperty ProcessId",
      ],
      { windowsHide: true },
    );
    let out = "";
    ps.stdout.on("data", (d) => {
      out += String(d);
    });
    ps.on("close", () => {
      resolve(
        out
          .split(/\r?\n/)
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      );
    });
  });
}

async function main() {
  const targets = await listTargets();
  const page =
    targets.find((t) => t.type === "page" && /aster/i.test(t.title || "")) ||
    targets.find((t) => t.type === "page");
  if (!page) throw new Error("no CDP page");
  const wsUrl = page.webSocketDebuggerUrl;

  const projectCrash = fs.mkdtempSync(path.join(os.tmpdir(), "aster-m0-crash-"));
  const projectSwitch = fs.mkdtempSync(path.join(os.tmpdir(), "aster-m0-switch-"));
  const report = {
    projectCrash: tokenize(projectCrash),
    projectSwitch: tokenize(projectSwitch),
    observations: {},
    shots: {},
  };

  const invoke = `globalThis.__TAURI_INTERNALS__.invoke`;

  // ---------- Stage 1: crash-without-stop ----------
  report.observations.crashBefore = await evalJs(
    wsUrl,
    `(async () => {
      const invoke = ${invoke};
      const p = ${JSON.stringify(projectCrash)};
      const dbg = globalThis.__asterDebug;
      if (!dbg) return { ok: false, error: 'no __asterDebug' };
      await dbg.piConsoleStore.refreshTree();
      await dbg.piConsoleStore.createSession(p);
      const t0 = Date.now();
      const norm = (x) => String(x || '').replace(/\\\\/g, '/').toLowerCase();
      while (Date.now() - t0 < 170000) {
        const cwd = document.querySelector('.session-header .cwd');
        const state = document.querySelector('.session-header .state');
        if (cwd && state && norm(cwd.getAttribute('title') || cwd.textContent) === norm(p) && state.textContent.trim() === 'Ready') {
          return { ok: true, ms: Date.now() - t0, state: state.textContent.trim() };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      return { ok: false };
    })()`,
    180000,
  );
  if (!report.observations.crashBefore.ok) throw new Error("crash session did not become Ready");

  const baselinePids = new Set(await piNodePids());
  report.observations.baselinePiPids = [...baselinePids];
  // Create the switch-target session too, so we have a second bound session for stage 2 later.
  // (Stage 1 kills the crash session's node to simulate crash.)

  // Locate the Pi node pid belonging to projectCrash: diff before/after is ambiguous
  // because createSession spawns exactly one node per open. After Ready, the newest
  // pi-coding-agent node pid is the one just spawned.
  const afterPids = await piNodePids();
  const crashNodePid = afterPids.find((pid) => !baselinePids.has(pid));
  report.observations.crashNodePid = crashNodePid || null;

  if (!crashNodePid) {
    report.observations.crash = { skipped: true, reason: "no fresh pi node pid" };
  } else {
    // Kill node WITHOUT pi_session_stop (external crash).
    try {
      process.kill(crashNodePid);
    } catch (e) {
      report.observations.crash = { skipped: true, reason: `kill failed: ${e}` };
    }
    if (!report.observations.crash) {
      await sleep(1500);
      report.observations.crash = await evalJs(
        wsUrl,
        `(async () => {
          const invoke = ${invoke};
          const p = ${JSON.stringify(projectSwitch)};
          const snap = await invoke('pi_runtime_snapshot');
          const choose = await invoke('project_choose', { path: p }).then(
            () => ({ ok: true }),
            (e) => ({ ok: false, error: String(e && e.message ? e.message : e) }),
          );
          return {
            lifecycle: snap && snap.lifecycle,
            choose,
            stillBound: !!(snap && snap.projectPath),
          };
        })()`,
      );
      report.shots.crashBlocked = await shot(wsUrl, "m0-crash-blocked-2026-08-21.png");
    }
  }

  // ---------- Stage 2: Stop timeout keeps slot, blocks project change ----------
  report.observations.stopBefore = await evalJs(
    wsUrl,
    `(async () => {
      const invoke = ${invoke};
      const p = ${JSON.stringify(projectSwitch)};
      const dbg = globalThis.__asterDebug;
      if (!dbg) return { ok: false, error: 'no __asterDebug' };
      // Ensure a session is bound on projectSwitch (reuse crash one if still bound).
      await dbg.piConsoleStore.refreshRuntime();
      const facts = dbg.getHostRuntimeFacts();
      const blocked = dbg.piProjectBlocksChange(facts, p);
      // If no session bound yet, open one on projectSwitch first.
      if (!facts.pi || !facts.pi.projectPath) {
        await dbg.piConsoleStore.createSession(p);
        const t0 = Date.now();
        const norm = (x) => String(x || '').replace(/\\\\/g, '/').toLowerCase();
        while (Date.now() - t0 < 170000) {
          const cwd = document.querySelector('.session-header .cwd');
          const state = document.querySelector('.session-header .state');
          if (cwd && state && norm(cwd.getAttribute('title') || cwd.textContent) === norm(p) && state.textContent.trim() === 'Ready') {
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
        await dbg.piConsoleStore.refreshRuntime();
      }
      return { ok: true };
    })()`,
    180000,
  );
  if (!report.observations.stopBefore.ok) throw new Error("stage2 session not ready");

  report.observations.stopTimeout = await evalJs(
    wsUrl,
    `(async () => {
      const invoke = ${invoke};
      const p = ${JSON.stringify(projectSwitch)};
      const dbg = globalThis.__asterDebug;
      if (!dbg) return { ok: false, error: 'no __asterDebug' };
      await dbg.piConsoleStore.refreshRuntime();
      const blocked = dbg.piProjectBlocksChange(dbg.getHostRuntimeFacts(), p);
      // Force an offer to the target project even if it equals current (we just want the dialog).
      dbg.piConsoleStore.offerProjectBlock(p, blocked || '当前存在活动 Pi Session（超时注入）');
      await new Promise((r) => setTimeout(r, 200));
      const dialog = document.querySelector('[role="alertdialog"]');
      const stopBtn = [...(dialog ? dialog.querySelectorAll('button') : [])].find((b) =>
        (b.innerText || '').includes('停止 Session 后切换'),
      );
      if (!stopBtn) return { ok: false, error: 'no stop-switch button' };
      stopBtn.click();
      // Wait for stop attempt to complete (fails with ASTER_PI_STOP_WAIT_MS budget).
      await new Promise((r) => setTimeout(r, 3000));
      const activeBefore = await invoke('project_get_active');
      const snap = await invoke('pi_runtime_snapshot');
      const errEl = document.querySelector('.session-header .err[role="alert"]');
      const dialogStill = !!document.querySelector('[role="alertdialog"]');
      return {
        ok: dialogStill && !!errEl,
        errorText: errEl ? errEl.textContent.trim() : null,
        dialogStill,
        lifecycle: snap && snap.lifecycle,
        projectPath: snap && snap.projectPath,
        activeBefore,
      };
    })()`,
    60000,
  );
  if (report.observations.stopTimeout && report.observations.stopTimeout.projectPath) {
    report.observations.stopTimeout.projectPath = tokenize(report.observations.stopTimeout.projectPath);
  }
  if (report.observations.stopTimeout && report.observations.stopTimeout.activeBefore) {
    report.observations.stopTimeout.activeBefore = tokenize(report.observations.stopTimeout.activeBefore);
  }
  report.shots.stopTimeout = await shot(wsUrl, "m0-stop-timeout-2026-08-21.png");

  console.log(JSON.stringify(report, null, 2));

  const o = report.observations;
  const failed = [];
  if (!o.crashBefore || !o.crashBefore.ok) failed.push("crash session ready");
  if (!o.crash || o.crash.skipped || !o.crash.lifecycle === "crashed") failed.push("crash lifecycle");
  if (!o.crash || o.crash.skipped || !o.crash.choose.ok || !/活动 Pi Session/.test(String(o.crash.choose.error || ""))) {
    failed.push("crash blocks choose");
  }
  if (!o.stopTimeout || !o.stopTimeout.ok) failed.push("stop timeout keeps dialog");
  if (!o.stopTimeout || !/未能停止|still alive/.test(String(o.stopTimeout.errorText || ""))) {
    failed.push("stop timeout error visible");
  }
  if (failed.length) {
    console.error("FAILED: " + failed.join("; "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
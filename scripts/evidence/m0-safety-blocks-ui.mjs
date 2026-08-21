#!/usr/bin/env node
// Remaining M0 UI evidence against a live Aster WebView2 (CDP :9222).
// Session should already be bound (header Ready). Native IFileDialog is not
// driven here; keep/stop uses the same store helpers ModuleBar calls after pick.
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
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
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

function piNodePids(marker) {
  return new Promise((resolve) => {
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*pi-coding-agent*' -and $_.CommandLine -like '*${marker}*' } | Select-Object -ExpandProperty ProcessId`,
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
  const projectB = fs.mkdtempSync(path.join(os.tmpdir(), "aster-m0-b-"));
  const projectC = fs.mkdtempSync(path.join(os.tmpdir(), "aster-m0-c-"));
  const report = {
    projectB: tokenize(projectB),
    projectC: tokenize(projectC),
    observations: {},
    shots: {},
  };

  report.observations.headerBefore = await evalJs(
    wsUrl,
    `JSON.stringify({
      state: document.querySelector('.session-header .state') && document.querySelector('.session-header .state').textContent.trim(),
      cwd: document.querySelector('.session-header .cwd') && (document.querySelector('.session-header .cwd').getAttribute('title') || document.querySelector('.session-header .cwd').textContent),
    })`,
  );
  report.observations.headerBefore = JSON.parse(report.observations.headerBefore);
  report.observations.headerBefore.cwd = tokenize(report.observations.headerBefore.cwd);
  report.shots.idleReady = await shot(wsUrl, "m0-safety-blocks-idle-ready-2026-08-20.png");

  report.observations.backendRefuse = await evalJs(
    wsUrl,
    `(async () => {
      const invoke = globalThis.__TAURI_INTERNALS__.invoke;
      const pathB = ${JSON.stringify(projectB)};
      const snap0 = await invoke('pi_runtime_snapshot');
      const choose = await invoke('project_choose', { path: pathB }).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, error: String(e && e.message ? e.message : e) }),
      );
      const workdir = await invoke('host_workdir_set', { host: 'pi', path: pathB }).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, error: String(e && e.message ? e.message : e) }),
      );
      const snap1 = await invoke('pi_runtime_snapshot');
      const active = await invoke('project_get_active');
      return {
        choose,
        workdir,
        lifecycle: snap1 && snap1.lifecycle,
        projectPath: snap1 && snap1.projectPath,
        active,
        sameProject: snap0 && snap1 && snap0.projectPath === snap1.projectPath,
      };
    })()`,
  );
  if (report.observations.backendRefuse.projectPath) {
    report.observations.backendRefuse.projectPath = tokenize(report.observations.backendRefuse.projectPath);
  }
  if (report.observations.backendRefuse.active) {
    report.observations.backendRefuse.active = tokenize(report.observations.backendRefuse.active);
  }

  report.observations.keepOffer = await evalJs(
    wsUrl,
    `(async () => {
      const pathB = ${JSON.stringify(projectB)};
      const dbg = globalThis.__asterDebug;
      if (!dbg) return { ok: false, error: 'no __asterDebug' };
      await dbg.piConsoleStore.refreshRuntime();
      const blocked = dbg.piProjectBlocksChange(dbg.getHostRuntimeFacts(), pathB);
      if (!blocked) return { ok: false, error: 'frontend helper did not block' };
      dbg.piConsoleStore.offerProjectBlock(pathB, blocked);
      await new Promise((r) => setTimeout(r, 200));
      const dialog = document.querySelector('[role="alertdialog"]');
      return {
        ok: !!dialog,
        blocked,
        dialogText: dialog ? dialog.innerText : null,
      };
    })()`,
  );
  report.shots.keepDialog = await shot(wsUrl, "m0-safety-blocks-keep-2026-08-20.png");
  report.observations.keepUi = await evalJs(
    wsUrl,
    `(async () => {
      const dialog = document.querySelector('[role="alertdialog"]');
      const keep = [...(dialog ? dialog.querySelectorAll('button') : [])].find((b) =>
        (b.innerText || '').includes('保持当前会话'),
      );
      if (!keep) return { ok: false, error: 'no keep button' };
      keep.click();
      await new Promise((r) => setTimeout(r, 200));
      const cwd = document.querySelector('.session-header .cwd');
      return {
        ok: !document.querySelector('[role="alertdialog"]'),
        cwdAfter: cwd ? (cwd.getAttribute('title') || cwd.textContent) : null,
      };
    })()`,
  );
  if (report.observations.keepUi && report.observations.keepUi.cwdAfter) {
    report.observations.keepUi.cwdAfter = tokenize(report.observations.keepUi.cwdAfter);
  }

  report.observations.stopSwitch = await evalJs(
    wsUrl,
    `(async () => {
      const pathB = ${JSON.stringify(projectB)};
      const dbg = globalThis.__asterDebug;
      if (!dbg) return { ok: false, error: 'no __asterDebug' };
      await dbg.piConsoleStore.refreshRuntime();
      const blocked = dbg.piProjectBlocksChange(dbg.getHostRuntimeFacts(), pathB);
      dbg.piConsoleStore.offerProjectBlock(pathB, blocked || '当前存在活动 Pi Session');
      await new Promise((r) => setTimeout(r, 200));
      const dialog = document.querySelector('[role="alertdialog"]');
      const stopBtn = [...(dialog ? dialog.querySelectorAll('button') : [])].find((b) =>
        (b.innerText || '').includes('停止 Session 后切换'),
      );
      if (!stopBtn) return { ok: false, error: 'no stop-switch button' };
      stopBtn.click();
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        if (!document.querySelector('[role="alertdialog"]')) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const invoke = globalThis.__TAURI_INTERNALS__.invoke;
      const active = await invoke('project_get_active');
      const snap = await invoke('pi_runtime_snapshot');
      const empty = document.querySelector('.empty-state');
      return {
        ok: !document.querySelector('[role="alertdialog"]'),
        active,
        lifecycle: snap && snap.lifecycle,
        emptyStatus: empty ? empty.textContent.trim() : null,
        hasHeader: !!document.querySelector('.session-header'),
      };
    })()`,
    90000,
  );
  if (report.observations.stopSwitch && report.observations.stopSwitch.active) {
    report.observations.stopSwitch.active = tokenize(report.observations.stopSwitch.active);
  }

  report.observations.createB = await evalJs(
    wsUrl,
    `(async () => {
      const pathB = ${JSON.stringify(projectB)};
      const nameB = pathB.split(/[\\\\/]/).filter(Boolean).pop();
      const dbg = globalThis.__asterDebug;
      if (!dbg) return { ok: false, error: 'no __asterDebug' };
      await dbg.piConsoleStore.refreshTree();
      await new Promise((r) => setTimeout(r, 300));
      let row = [...document.querySelectorAll('.project-row')].find((r) => {
        const n = r.querySelector('.name');
        return n && n.textContent.trim() === nameB;
      });
      if (!row) {
        await dbg.piConsoleStore.createSession(pathB);
      } else {
        row.querySelector('button.new-session').click();
      }
      const t0 = Date.now();
      const norm = (p) => String(p || '').replace(/\\\\/g, '/').toLowerCase();
      while (Date.now() - t0 < 170000) {
        const cwd = document.querySelector('.session-header .cwd');
        const state = document.querySelector('.session-header .state');
        const shown = cwd ? (cwd.getAttribute('title') || cwd.textContent) : '';
        if (cwd && state && norm(shown) === norm(pathB) && state.textContent.trim() === 'Ready') {
          return { ok: true, ms: Date.now() - t0, cwd: shown, state: state.textContent.trim() };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      const cwd = document.querySelector('.session-header .cwd');
      return { ok: false, cwd: cwd && (cwd.getAttribute('title') || cwd.textContent), state: document.querySelector('.session-header .state') && document.querySelector('.session-header .state').textContent };
    })()`,
    180000,
  );
  if (report.observations.createB && report.observations.createB.cwd) {
    report.observations.createB.cwd = tokenize(report.observations.createB.cwd);
  }

  report.observations.streamingKeep = await evalJs(
    wsUrl,
    `(async () => {
      const invoke = globalThis.__TAURI_INTERNALS__.invoke;
      const pathC = ${JSON.stringify(projectC)};
      try {
        await invoke('pi_session_set_model', { provider: 'ark-coding', modelId: 'deepseek-v4-flash' });
      } catch (e) {
        return { skipped: true, reason: 'set_model', error: String(e && e.message ? e.message : e) };
      }
      const prompted = await invoke('pi_session_prompt', { message: 'Count from 1 to 80, one integer per line, no tools.' }).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, error: String(e && e.message ? e.message : e) }),
      );
      if (!prompted.ok) return { skipped: true, reason: 'prompt', error: prompted.error };
      let streaming = false;
      for (let i = 0; i < 40; i++) {
        const snap = await invoke('pi_session_snapshot');
        if (snap && snap.isStreaming) {
          streaming = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!streaming) return { skipped: true, reason: 'never streaming' };
      const dbg = globalThis.__asterDebug;
      await dbg.piConsoleStore.refreshRuntime();
      const blocked = dbg.piProjectBlocksChange(dbg.getHostRuntimeFacts(), pathC);
      dbg.piConsoleStore.offerProjectBlock(pathC, blocked || '当前存在活动 Pi Session');
      await new Promise((r) => setTimeout(r, 150));
      const dialog = document.querySelector('[role="alertdialog"]');
      const keep = [...(dialog ? dialog.querySelectorAll('button') : [])].find((b) =>
        (b.innerText || '').includes('保持当前会话'),
      );
      if (keep) keep.click();
      await new Promise((r) => setTimeout(r, 300));
      const after = await invoke('pi_session_snapshot');
      try {
        await invoke('pi_session_abort');
      } catch {}
      return {
        ok: !!(after && after.isStreaming),
        stillStreaming: !!(after && after.isStreaming),
        dialogShown: !!dialog,
        cwd: document.querySelector('.session-header .cwd') && document.querySelector('.session-header .cwd').getAttribute('title'),
      };
    })()`,
    180000,
  );
  if (report.observations.streamingKeep && report.observations.streamingKeep.cwd) {
    report.observations.streamingKeep.cwd = tokenize(report.observations.streamingKeep.cwd);
  }

  const marker = path.basename(projectB);
  const pids = await piNodePids(marker.replace(/'/g, ""));
  report.observations.crashPids = pids;
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {}
  }
  if (pids.length) {
    await sleep(1500);
    report.observations.crash = await evalJs(
      wsUrl,
      `(async () => {
        const invoke = globalThis.__TAURI_INTERNALS__.invoke;
        const pathC = ${JSON.stringify(projectC)};
        const snap = await invoke('pi_runtime_snapshot');
        const choose = await invoke('project_choose', { path: pathC }).then(
          () => ({ ok: true }),
          (e) => ({ ok: false, error: String(e && e.message ? e.message : e) }),
        );
        try { await invoke('pi_session_stop'); } catch {}
        return { lifecycle: snap && snap.lifecycle, choose };
      })()`,
    );
  } else {
    report.observations.crash = { skipped: true, reason: "no matching pi pid" };
  }

  report.observations.github = await evalJs(
    wsUrl,
    `(async () => {
      const skills = [...document.querySelectorAll('button.tb-tab')].find((b) => (b.innerText || '').includes('Skills'));
      if (skills) skills.click();
      await new Promise((r) => setTimeout(r, 400));
      const skillsText = document.body.innerText;
      const hasM1 = skillsText.includes('运行 M1 示例流水线');
      const hasRollback = skillsText.includes('回滚最新部署');
      const openBtn = [...document.querySelectorAll('button')].find((b) => /连接 GitHub|凭据管理/.test(b.innerText || ''));
      if (!openBtn) return { hasM1, hasRollback, error: 'no github button' };
      const visible = () => !!(document.querySelector('.modal-card') || document.querySelector('.modal-backdrop'));
      const closes = {};
      openBtn.click(); await new Promise((r) => setTimeout(r, 200));
      closes.opened = visible();
      const x = document.querySelector('button.close-btn'); if (x) x.click();
      await new Promise((r) => setTimeout(r, 200)); closes.afterX = visible();
      openBtn.click(); await new Promise((r) => setTimeout(r, 200));
      const backdrop = document.querySelector('.modal-backdrop'); if (backdrop) backdrop.click();
      await new Promise((r) => setTimeout(r, 200)); closes.afterBackdrop = visible();
      openBtn.click(); await new Promise((r) => setTimeout(r, 200));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 200)); closes.afterEscape = visible();
      openBtn.click(); await new Promise((r) => setTimeout(r, 200));
      const start = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('获取 GitHub 设备授权码'));
      if (start) start.click();
      await new Promise((r) => setTimeout(r, 80));
      const x2 = document.querySelector('button.close-btn'); if (x2) x2.click();
      await new Promise((r) => setTimeout(r, 2500));
      closes.afterCloseDuringStart = visible();
      openBtn.click(); await new Promise((r) => setTimeout(r, 400));
      const errEl = document.querySelector('.modal-card .tag.err');
      const reopenError = errEl ? errEl.textContent.trim() : null;
      const x3 = document.querySelector('button.close-btn'); if (x3) x3.click();
      return { hasM1, hasRollback, closes, reopenError };
    })()`,
    30000,
  );
  report.shots.skills = await shot(wsUrl, "m0-safety-blocks-skills-2026-08-20.png");

  report.observations.dsh = await evalJs(
    wsUrl,
    `(async () => {
      const tab = [...document.querySelectorAll('button.tb-tab')].find((b) => (b.innerText || '').includes('DeepSeek'));
      if (tab) tab.click();
      await new Promise((r) => setTimeout(r, 300));
      const idle = document.querySelector('.dsh-bar-left .tag') && document.querySelector('.dsh-bar-left .tag').textContent.trim();
      const startBtn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('启动服务'));
      let seenStarting = false;
      if (startBtn) {
        startBtn.click();
        for (let i = 0; i < 30; i++) {
          const tag = document.querySelector('.dsh-bar-left .tag');
          const btn = [...document.querySelectorAll('button')].find((b) => /启动/.test(b.innerText || ''));
          if ((tag && tag.textContent.trim() === 'Starting') || (btn && btn.innerText.includes('启动中'))) {
            seenStarting = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 40));
        }
        for (let i = 0; i < 40; i++) {
          const tag = document.querySelector('.dsh-bar-left .tag');
          if (tag && tag.textContent.trim() !== 'Starting') break;
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      const final = document.querySelector('.dsh-bar-left .tag') && document.querySelector('.dsh-bar-left .tag').textContent.trim();
      return { idle, seenStarting, final };
    })()`,
    30000,
  );

  console.log(JSON.stringify(report, null, 2));
  const o = report.observations;
  const failed = [];
  if (!o.headerBefore || o.headerBefore.state !== "Ready") failed.push("idle Ready");
  if (!o.backendRefuse || o.backendRefuse.choose.ok || !/活动 Pi Session/.test(String(o.backendRefuse.choose.error || ""))) {
    failed.push("backend refuse choose");
  }
  if (!o.keepOffer || !o.keepOffer.ok) failed.push("keep offer");
  if (!o.keepUi || !o.keepUi.ok) failed.push("keep ui");
  if (!o.stopSwitch || !o.stopSwitch.ok) failed.push("stop switch");
  if (o.github && (o.github.hasM1 || o.github.hasRollback)) failed.push("m1 buttons");
  if (
    o.github &&
    o.github.closes &&
    (o.github.closes.afterX || o.github.closes.afterBackdrop || o.github.closes.afterEscape || o.github.closes.afterCloseDuringStart)
  ) {
    failed.push("github close");
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

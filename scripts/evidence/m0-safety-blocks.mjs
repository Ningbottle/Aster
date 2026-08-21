#!/usr/bin/env node
// M0 safety blocks: real WebView2 UI → invoke → Rust evidence.
// Prerequisite: npm run tauri dev with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// Native folder dialog is stubbed only for `project_pick_directory` so the
// real 打开项目 button still runs openProjectPicker / hostRuntimeStore / alertdialog.
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
  const out = path.join(SHOT_DIR, name);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(out, Buffer.from(result.data, "base64"));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(wsUrl, expression, timeoutMs = 120000, intervalMs = 250) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    last = await evalJs(wsUrl, expression, timeoutMs);
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timed out: ${expression} last=${JSON.stringify(last)}`);
}

function piNodePids(marker) {
  return new Promise((resolve, reject) => {
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
    let err = "";
    ps.stdout.on("data", (d) => {
      out += String(d);
    });
    ps.stderr.on("data", (d) => {
      err += String(d);
    });
    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code !== 0 && !out.trim()) {
        resolve([]);
        return;
      }
      const pids = out
        .split(/\r?\n/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      resolve(pids);
    });
  });
}

function runRfd(folderPath, { dismiss = false } = {}) {
  return new Promise((resolve, reject) => {
    const script = path.join("scripts", "dev", "complete-rfd.ps1");
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script];
    if (dismiss) args.push("-Dismiss");
    else args.push("-Path", folderPath, "-TimeoutMs", "20000");
    const ps = spawn("powershell.exe", args, { windowsHide: true });
    let out = "";
    let err = "";
    ps.stdout.on("data", (d) => {
      out += String(d);
    });
    ps.stderr.on("data", (d) => {
      err += String(d);
    });
    ps.on("error", reject);
    ps.on("close", (code) => {
      resolve({ code, out: out.trim(), err: err.trim() });
    });
  });
}

async function clickOpenProject(wsUrl) {
  return evalJs(wsUrl, `document.querySelector('button.open-project').click(); 'clicked'`, 8000);
}

async function openProjectViaUi(wsUrl, folderPath) {
  await clickOpenProject(wsUrl);
  const rfd = await runRfd(folderPath);
  return rfd;
}

async function main() {
  const targets = await listTargets();
  const page =
    targets.find((t) => t.type === "page" && /aster/i.test(t.title || "")) ||
    targets.find((t) => t.type === "page" && /localhost:1420/.test(t.url || "")) ||
    targets.find((t) => t.type === "page");
  if (!page) throw new Error("no CDP page");
  const wsUrl = page.webSocketDebuggerUrl;
  const report = { page: { title: page.title, url: page.url }, observations: {} };

  const projectA = fs.mkdtempSync(path.join(os.tmpdir(), "aster-m0-a-"));
  const projectB = fs.mkdtempSync(path.join(os.tmpdir(), "aster-m0-b-"));
  const projectC = fs.mkdtempSync(path.join(os.tmpdir(), "aster-m0-c-"));
  report.projectA = tokenize(projectA);
  report.projectB = tokenize(projectB);
  report.projectC = tokenize(projectC);

  await waitFor(
    wsUrl,
    `!!document.querySelector('button.open-project') || [...document.querySelectorAll('button.tb-tab')].some((b) => (b.innerText || '').includes('Pi'))`,
    60000,
  );

  // --- empty Pi / DSH labels ---
  report.observations.empty = await evalJs(
    wsUrl,
    `(() => {
      const piTab = [...document.querySelectorAll('button.tb-tab')].find((b) => (b.innerText || '').includes('Pi'));
      if (piTab) piTab.click();
      const empty = document.querySelector('.empty-state');
      const headerState = document.querySelector('.session-header .state');
      return {
        emptyStatus: empty ? empty.textContent.trim() : null,
        headerState: headerState ? headerState.textContent.trim() : null,
        hasSessionHeader: !!headerState,
        bodyHasReady: (document.body.innerText || '').includes('\\nReady\\n') || /empty-state[^>]*>Ready/.test(document.body.innerHTML || ''),
      };
    })()`,
  );

  const dshTab = await evalJs(
    wsUrl,
    `(() => {
      const tab = [...document.querySelectorAll('button.tb-tab')].find((b) => (b.innerText || '').includes('DeepSeek'));
      if (tab) tab.click();
      return true;
    })()`,
  );
  await sleep(300);
  report.observations.dshIdle = await evalJs(
    wsUrl,
    `(() => {
      const tag = document.querySelector('.dsh-bar-left .tag');
      const startBtn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('启动服务'));
      return {
        lifecycleTag: tag ? tag.textContent.trim() : null,
        barText: (document.querySelector('.dsh-bar') && document.querySelector('.dsh-bar').innerText) || '',
        hasStart: !!startBtn,
      };
    })()`,
  );

  if (dshTab) {
    report.observations.dshStarting = await evalJs(
      wsUrl,
      `(async () => {
        const startBtn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('启动服务'));
        if (!startBtn) return { skipped: true, reason: 'no start button (already running?)' };
        startBtn.click();
        const seen = [];
        for (let i = 0; i < 40; i++) {
          const tag = document.querySelector('.dsh-bar-left .tag');
          const label = tag ? tag.textContent.trim() : '';
          const btn = [...document.querySelectorAll('button')].find((b) => /启动/.test(b.innerText || ''));
          seen.push({ i, label, btn: btn ? btn.innerText.trim() : null });
          if (label === 'Starting' || (btn && btn.innerText.includes('启动中'))) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        for (let i = 0; i < 24; i++) {
          const tag = document.querySelector('.dsh-bar-left .tag');
          const label = tag ? tag.textContent.trim() : '';
          if (label && label !== 'Starting') {
            return { seenStarting: seen.some((s) => s.label === 'Starting' || (s.btn || '').includes('启动中')), finalLabel: label, samples: seen.slice(0, 8) };
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        const tag = document.querySelector('.dsh-bar-left .tag');
        return { seenStarting: seen.some((s) => s.label === 'Starting' || (s.btn || '').includes('启动中')), finalLabel: tag ? tag.textContent.trim() : null, samples: seen.slice(0, 8) };
      })()`,
      120000,
    );
  }

  await evalJs(
    wsUrl,
    `(() => {
      const piTab = [...document.querySelectorAll('button.tb-tab')].find((b) => (b.innerText || '').includes('Pi'));
      if (piTab) piTab.click();
      return true;
    })()`,
  );
  await sleep(200);

  // --- open project A via 打开项目 (stub only the native folder dialog) ---
  report.observations.openA = await evalJs(
    wsUrl,
    `(async () => {
      const pathA = ${JSON.stringify(projectA)};
      const internals = globalThis.__TAURI_INTERNALS__;
      if (!internals || !internals.invoke) return { ok: false, error: 'no tauri invoke' };
      const orig = internals.invoke.bind(internals);
      internals.invoke = (cmd, args) => {
        if (cmd === 'project_pick_directory') return Promise.resolve(pathA);
        return orig(cmd, args);
      };
      try {
        const btn = document.querySelector('button.open-project');
        if (!btn) return { ok: false, error: 'no 打开项目 button' };
        btn.click();
        const t0 = Date.now();
        const want = pathA.split(/[\\\\/]/).filter(Boolean).pop();
        while (Date.now() - t0 < 20000) {
          const names = [...document.querySelectorAll('.project-row .name')].map((n) => n.textContent.trim());
          if (names.includes(want)) return { ok: true, names: names.filter((n) => n === want || n.startsWith('aster-m0')), ms: Date.now() - t0 };
          await new Promise((r) => setTimeout(r, 150));
        }
        return { ok: false, error: 'tree did not show project A', ms: 20000 };
      } finally {
        internals.invoke = orig;
      }
    })()`,
  );

  report.observations.createA = await evalJs(
    wsUrl,
    `(async () => {
      const pathA = ${JSON.stringify(projectA)};
      const nameA = pathA.split(/[\\\\/]/).filter(Boolean).pop();
      const row = [...document.querySelectorAll('.project-row')].find((r) => {
        const n = r.querySelector('.name');
        return n && n.textContent.trim() === nameA;
      });
      const plus = row && row.querySelector('button.new-session');
      if (!plus) return { ok: false, error: 'no new-session button for project A', nameA };
      plus.click();
      const t0 = Date.now();
      const norm = (p) => String(p || '').replace(/\\\\/g, '/').toLowerCase();
      while (Date.now() - t0 < 180000) {
        const cwd = document.querySelector('.session-header .cwd');
        const state = document.querySelector('.session-header .state');
        const dialog = document.querySelector('[role="alertdialog"]');
        const shown = cwd ? (cwd.getAttribute('title') || cwd.textContent) : '';
        if (cwd && state && norm(shown) === norm(pathA)) {
          return {
            ok: true,
            ms: Date.now() - t0,
            cwd: shown,
            state: state.textContent.trim(),
            hasDialog: !!dialog,
          };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      const cwdNow = document.querySelector('.session-header .cwd');
      return { ok: false, error: 'session header did not bind to project A', ms: 180000, cwd: cwdNow ? (cwdNow.getAttribute('title') || cwdNow.textContent) : null };
    })()`,
    180000,
  );
  if (report.observations.createA && report.observations.createA.cwd) {
    report.observations.createA.cwd = tokenize(report.observations.createA.cwd);
  }

  report.shots = { idleReady: await shot(wsUrl, "m0-safety-blocks-idle-ready-2026-08-20.png") };

  // --- pick B while idle: keep ---
  const pickBKeepPromise = evalJs(
    wsUrl,
    `(async () => {
      const pathB = ${JSON.stringify(projectB)};
      const internals = globalThis.__TAURI_INTERNALS__;
      const orig = internals.invoke.bind(internals);
      let abortCalls = 0;
      internals.invoke = (cmd, args) => {
        if (cmd === 'pi_session_abort') abortCalls += 1;
        if (cmd === 'project_pick_directory') return Promise.resolve(pathB);
        return orig(cmd, args);
      };
      try {
        document.querySelector('button.open-project').click();
        const t0 = Date.now();
        let dialog = null;
        while (Date.now() - t0 < 15000) {
          dialog = document.querySelector('[role="alertdialog"]');
          if (dialog) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!dialog) return { ok: false, error: 'no alertdialog', abortCalls };
        const text = dialog.innerText;
        const keep = [...dialog.querySelectorAll('button')].find((b) => (b.innerText || '').includes('保持当前会话'));
        if (!keep) return { ok: false, error: 'no keep button', text, abortCalls };
        window.__asterM0HoldDialog = true;
        const tHold = Date.now();
        while (window.__asterM0HoldDialog && Date.now() - tHold < 8000) {
          await new Promise((r) => setTimeout(r, 100));
        }
        keep.click();
        window.__asterM0HoldDialog = false;
        await new Promise((r) => setTimeout(r, 200));
        const cwd = document.querySelector('.session-header .cwd');
        const stillDialog = document.querySelector('[role="alertdialog"]');
        return {
          ok: !stillDialog,
          abortCalls,
          dialogText: text,
          cwdAfter: cwd ? (cwd.getAttribute('title') || cwd.textContent) : null,
          dialogGone: !stillDialog,
        };
      } finally {
        internals.invoke = orig;
      }
    })()`,
  );
  await waitFor(wsUrl, `!!window.__asterM0HoldDialog && !!document.querySelector('[role="alertdialog"]')`, 20000);
  report.shots.keepDialog = await shot(wsUrl, "m0-safety-blocks-keep-2026-08-20.png");
  await evalJs(wsUrl, `window.__asterM0HoldDialog = false; true`);
  report.observations.pickBKeep = await pickBKeepPromise;
  if (report.observations.pickBKeep && report.observations.pickBKeep.cwdAfter) {
    report.observations.pickBKeep.cwdAfter = tokenize(report.observations.pickBKeep.cwdAfter);
  }

  const activeAfterKeep = await evalJs(
    wsUrl,
    `(async () => {
      const invoke = globalThis.__TAURI_INTERNALS__.invoke;
      const active = await invoke('project_get_active');
      const snap = await invoke('pi_runtime_snapshot');
      return { active, lifecycle: snap && snap.lifecycle, projectPath: snap && snap.projectPath };
    })()`,
  );
  report.observations.afterKeepFacts = {
    active: tokenize(activeAfterKeep && activeAfterKeep.active),
    lifecycle: activeAfterKeep && activeAfterKeep.lifecycle,
    projectPath: tokenize(activeAfterKeep && activeAfterKeep.projectPath),
  };

  // --- pick B again: stop then switch ---
  report.observations.pickBStopSwitch = await evalJs(
    wsUrl,
    `(async () => {
      const pathB = ${JSON.stringify(projectB)};
      const internals = globalThis.__TAURI_INTERNALS__;
      const orig = internals.invoke.bind(internals);
      internals.invoke = (cmd, args) => {
        if (cmd === 'project_pick_directory') return Promise.resolve(pathB);
        return orig(cmd, args);
      };
      try {
        document.querySelector('button.open-project').click();
        const t0 = Date.now();
        let dialog = null;
        while (Date.now() - t0 < 15000) {
          dialog = document.querySelector('[role="alertdialog"]');
          if (dialog) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (!dialog) return { ok: false, error: 'no alertdialog before stop-switch' };
        const stopBtn = [...dialog.querySelectorAll('button')].find((b) =>
          (b.innerText || '').includes('停止 Session 后切换'),
        );
        if (!stopBtn) return { ok: false, error: 'no stop-switch button' };
        stopBtn.click();
        const t1 = Date.now();
        while (Date.now() - t1 < 60000) {
          const dialogNow = document.querySelector('[role="alertdialog"]');
          const empty = document.querySelector('.empty-state');
          const names = [...document.querySelectorAll('.project-row .name')].map((n) => n.textContent.trim());
          if (!dialogNow) {
            return {
              ok: true,
              ms: Date.now() - t1,
              emptyStatus: empty ? empty.textContent.trim() : null,
              treeNames: names,
              hasSessionHeader: !!document.querySelector('.session-header'),
            };
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        return { ok: false, error: 'dialog stayed after stop-switch' };
      } finally {
        internals.invoke = orig;
      }
    })()`,
    90000,
  );

  const activeAfterSwitch = await evalJs(
    wsUrl,
    `(async () => {
      const invoke = globalThis.__TAURI_INTERNALS__.invoke;
      const active = await invoke('project_get_active');
      const snap = await invoke('pi_runtime_snapshot');
      return { active, lifecycle: snap && snap.lifecycle, projectPath: snap && snap.projectPath };
    })()`,
  );
  report.observations.afterStopSwitchFacts = {
    active: tokenize(activeAfterSwitch && activeAfterSwitch.active),
    lifecycle: activeAfterSwitch && activeAfterSwitch.lifecycle,
    projectPath: tokenize(activeAfterSwitch && activeAfterSwitch.projectPath),
  };

  // Recreate session on B for streaming + crash
  report.observations.createB = await evalJs(
    wsUrl,
    `(async () => {
      const pathB = ${JSON.stringify(projectB)};
      const nameB = pathB.split(/[\\\\/]/).filter(Boolean).pop();
      const row = [...document.querySelectorAll('.project-row')].find((r) => {
        const n = r.querySelector('.name');
        return n && n.textContent.trim() === nameB;
      });
      const plus = row && row.querySelector('button.new-session');
      if (!plus) return { ok: false, error: 'no new-session button for project B', nameB };
      plus.click();
      const t0 = Date.now();
      const norm = (p) => String(p || '').replace(/\\\\/g, '/').toLowerCase();
      while (Date.now() - t0 < 180000) {
        const cwd = document.querySelector('.session-header .cwd');
        const state = document.querySelector('.session-header .state');
        const shown = cwd ? (cwd.getAttribute('title') || cwd.textContent) : '';
        if (cwd && state && norm(shown) === norm(pathB)) {
          return { ok: true, ms: Date.now() - t0, cwd: shown, state: state.textContent.trim() };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      return { ok: false, error: 'session on B did not open' };
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
        return { ok: false, skipped: true, reason: 'set_model failed', error: String(e && e.message ? e.message : e) };
      }
      const prompted = await invoke('pi_session_prompt', { message: 'Count from 1 to 80, one integer per line, no tools.' }).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, error: String(e && e.message ? e.message : e) }),
      );
      if (!prompted.ok) return { ok: false, skipped: true, reason: 'prompt failed', error: prompted.error };
      let streaming = false;
      for (let i = 0; i < 40; i++) {
        const snap = await invoke('pi_session_snapshot');
        if (snap && snap.isStreaming) { streaming = true; break; }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!streaming) return { ok: false, skipped: true, reason: 'never saw isStreaming' };

      const internals = globalThis.__TAURI_INTERNALS__;
      const orig = internals.invoke.bind(internals);
      let abortCalls = 0;
      internals.invoke = (cmd, args) => {
        if (cmd === 'pi_session_abort') abortCalls += 1;
        if (cmd === 'project_pick_directory') return Promise.resolve(pathC);
        return orig(cmd, args);
      };
      try {
        document.querySelector('button.open-project').click();
        const t0 = Date.now();
        let dialog = null;
        while (Date.now() - t0 < 15000) {
          dialog = document.querySelector('[role="alertdialog"]');
          if (dialog) break;
          await new Promise((r) => setTimeout(r, 80));
        }
        if (!dialog) {
          const busy = await invoke('pi_session_snapshot');
          return { ok: false, error: 'no dialog while streaming', abortCalls, stillStreaming: !!(busy && busy.isStreaming) };
        }
        const dialogText = dialog.innerText;
        const keep = [...dialog.querySelectorAll('button')].find((b) => (b.innerText || '').includes('保持当前会话'));
        keep.click();
        await new Promise((r) => setTimeout(r, 300));
        const after = await invoke('pi_session_snapshot');
        const cwd = document.querySelector('.session-header .cwd');
        return {
          ok: abortCalls === 0 && !!(after && after.isStreaming),
          abortCalls,
          dialogText,
          stillStreaming: !!(after && after.isStreaming),
          cwdAfter: cwd ? (cwd.getAttribute('title') || cwd.textContent) : null,
        };
      } finally {
        internals.invoke = orig;
        try { await orig('pi_session_abort', {}); } catch {}
      }
    })()`,
    180000,
  );
  if (report.observations.streamingKeep && report.observations.streamingKeep.cwdAfter) {
    report.observations.streamingKeep.cwdAfter = tokenize(report.observations.streamingKeep.cwdAfter);
  }

  // crash without pi_session_stop
  const marker = path.basename(projectB);
  const pidsBeforeKill = await piNodePids(marker.replace(/'/g, ""));
  report.observations.crashPidsBefore = pidsBeforeKill;
  for (const pid of pidsBeforeKill) {
    try {
      process.kill(pid);
    } catch {}
  }
  if (pidsBeforeKill.length) {
    await sleep(1500);
    report.observations.crashUi = await evalJs(
      wsUrl,
      `(async () => {
        const invoke = globalThis.__TAURI_INTERNALS__.invoke;
        try { await invoke('pi_runtime_snapshot'); } catch {}
        const pathC = ${JSON.stringify(projectC)};
        const internals = globalThis.__TAURI_INTERNALS__;
        const orig = internals.invoke.bind(internals);
        internals.invoke = (cmd, args) => {
          if (cmd === 'project_pick_directory') return Promise.resolve(pathC);
          return orig(cmd, args);
        };
        try {
          const snap = await orig('pi_runtime_snapshot', {});
          document.querySelector('button.open-project').click();
          const t0 = Date.now();
          let dialog = null;
          while (Date.now() - t0 < 15000) {
            dialog = document.querySelector('[role="alertdialog"]');
            if (dialog) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          const headerState = document.querySelector('.session-header .state');
          const keep = dialog && [...dialog.querySelectorAll('button')].find((b) => (b.innerText || '').includes('保持当前会话'));
          if (keep) keep.click();
          const choose = await orig('project_choose', { path: pathC }).then(
            () => ({ ok: true }),
            (e) => ({ ok: false, error: String(e && e.message ? e.message : e) }),
          );
          return {
            snapshotLifecycle: snap && snap.lifecycle,
            snapshotProject: snap && snap.projectPath,
            headerState: headerState ? headerState.textContent.trim() : null,
            dialogShown: !!dialog,
            dialogText: dialog ? dialog.innerText : null,
            chooseOther: choose,
          };
        } finally {
          internals.invoke = orig;
        }
      })()`,
    );
    if (report.observations.crashUi && report.observations.crashUi.snapshotProject) {
      report.observations.crashUi.snapshotProject = tokenize(report.observations.crashUi.snapshotProject);
    }
    await evalJs(
      wsUrl,
      `(async () => {
        try { await globalThis.__TAURI_INTERNALS__.invoke('pi_session_stop'); } catch {}
        return true;
      })()`,
    );
  } else {
    report.observations.crashUi = { skipped: true, reason: "no pi-coding-agent pid matched project B marker" };
  }

  // GitHub modal
  report.observations.github = await evalJs(
    wsUrl,
    `(async () => {
      const skills = [...document.querySelectorAll('button.tb-tab')].find((b) => (b.innerText || '').includes('Skills'));
      if (skills) skills.click();
      await new Promise((r) => setTimeout(r, 400));
      const skillsText = document.body.innerText;
      const hasM1 = skillsText.includes('运行 M1 示例流水线');
      const hasRollback = skillsText.includes('回滚最新部署');
      const openBtn = [...document.querySelectorAll('button')].find((b) =>
        /连接 GitHub|凭据管理/.test(b.innerText || ''),
      );
      if (!openBtn) return { hasM1, hasRollback, error: 'no github button' };

      function modalVisible() {
        return !!(document.querySelector('.modal-card') || document.querySelector('.modal-backdrop'));
      }

      const closes = {};
      openBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      closes.opened = modalVisible();
      const x = document.querySelector('button.close-btn');
      if (x) x.click();
      await new Promise((r) => setTimeout(r, 200));
      closes.afterX = modalVisible();

      openBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      const backdrop = document.querySelector('.modal-backdrop');
      if (backdrop) backdrop.click();
      await new Promise((r) => setTimeout(r, 200));
      closes.afterBackdrop = modalVisible();

      openBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      closes.afterEscape = modalVisible();

      openBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      const start = [...document.querySelectorAll('button')].find((b) =>
        (b.innerText || '').includes('获取 GitHub 设备授权码'),
      );
      if (start) start.click();
      await new Promise((r) => setTimeout(r, 80));
      const x2 = document.querySelector('button.close-btn');
      if (x2) x2.click();
      await new Promise((r) => setTimeout(r, 2500));
      closes.afterCloseDuringStart = modalVisible();
      openBtn.click();
      await new Promise((r) => setTimeout(r, 400));
      const errEl = document.querySelector('.modal-card .tag.err');
      const reopenError = errEl ? errEl.textContent.trim() : null;
      const x3 = document.querySelector('button.close-btn');
      if (x3) x3.click();
      return { hasM1, hasRollback, closes, reopenError };
    })()`,
    30000,
  );
  report.shots.skills = await shot(wsUrl, "m0-safety-blocks-skills-2026-08-20.png");

  console.log(JSON.stringify(report, null, 2));

  const o = report.observations;
  const failed = [];
  if (!o.empty || (o.empty.emptyStatus !== "Closed" && o.empty.emptyStatus !== "Needs setup")) {
    failed.push("empty Pi status not Closed/Needs setup");
  }
  if (!o.dshIdle || o.dshIdle.lifecycleTag !== "Closed") failed.push("DSH idle not Closed");
  if (!o.openA || !o.openA.ok) failed.push("open project A via UI");
  if (!o.createA || !o.createA.ok || o.createA.state !== "Ready") failed.push("idle session Ready");
  if (!o.pickBKeep || !o.pickBKeep.ok || o.pickBKeep.abortCalls !== 0) failed.push("keep dialog");
  if (!o.pickBStopSwitch || !o.pickBStopSwitch.ok) failed.push("stop then switch");
  if (o.github && (o.github.hasM1 || o.github.hasRollback)) failed.push("M1/rollback buttons present");
  if (
    o.github &&
    (!o.github.closes ||
      o.github.closes.afterX ||
      o.github.closes.afterBackdrop ||
      o.github.closes.afterEscape ||
      o.github.closes.afterCloseDuringStart)
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

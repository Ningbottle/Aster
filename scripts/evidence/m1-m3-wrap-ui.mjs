#!/usr/bin/env node
// M1–M3 wrap real-UI observation via CDP :9222.
// Does NOT change OS DPI. Skip 200%. Tokenize home/local paths.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const SHOT_DIR = path.join("docs", "evidence");
const HOME = os.homedir();
const LOCAL = process.env.LOCALAPPDATA || "";

function tokenize(value) {
  if (value == null) return value;
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.map(tokenize);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = tokenize(v);
    return out;
  }
  if (typeof value !== "string") return value;
  return value.replaceAll(HOME, "%USERPROFILE%").replaceAll(LOCAL, "%LOCALAPPDATA%");
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}

function callCdp(wsUrl, method, params = {}, timeoutMs = 60000) {
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

async function evalJs(wsUrl, expression, timeoutMs = 120000) {
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
  const r = await callCdp(wsUrl, "Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const out = path.join(SHOT_DIR, name);
  fs.writeFileSync(out, Buffer.from(r.data, "base64"));
  return out.replaceAll("\\", "/");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ps(command) {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "powershell failed").trim());
  }
  return (r.stdout || "").trim();
}

function resizeAster(logicalW, logicalH) {
  const out = ps(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMove {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h, bool r);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rc);
  public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
$p = Get-Process -Name aster -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { throw 'no aster hwnd' }
$h = $p.MainWindowHandle
$dpi = [WinMove]::GetDpiForWindow($h)
if ($dpi -lt 96) { $dpi = 96 }
$scale = $dpi / 96.0
$pw = [int]([math]::Round(${logicalW} * $scale))
$ph = [int]([math]::Round(${logicalH} * $scale))
$rc = New-Object WinMove+RECT
[void][WinMove]::GetWindowRect($h, [ref]$rc)
[void][WinMove]::MoveWindow($h, $rc.L, $rc.T, $pw, $ph, $true)
Start-Sleep -Milliseconds 400
[void][WinMove]::GetWindowRect($h, [ref]$rc)
Write-Output ("{0}|{1}|{2}|{3}|{4}" -f $dpi, $pw, $ph, ($rc.R - $rc.L), ($rc.B - $rc.T))
`);
  const [dpi, wantW, wantH, gotW, gotH] = out.split("|").map(Number);
  return { dpi, wantW, wantH, gotW, gotH };
}

const openModule = (label) => `
  (async () => {
    const add = document.querySelector('button.tb-add');
    if (!add) return { ok: false, error: 'no tb-add' };
    add.click();
    await new Promise((r) => setTimeout(r, 200));
    const item = [...(document.querySelector('.tb-menu')?.querySelectorAll('button') || [])]
      .find((b) => (b.innerText || '').includes(${JSON.stringify(label)}));
    if (!item) return { ok: false, error: 'no menu item' };
    item.click();
    await new Promise((r) => setTimeout(r, 700));
    return { ok: true };
  })()
`;

const overflowProbe = `
  (() => {
    const overflow = (el) => el
      ? { sw: el.scrollWidth, cw: el.clientWidth, over: el.scrollWidth > el.clientWidth + 1 }
      : null;
    const bar = document.querySelector('.dsh-bar');
    const iframe = document.querySelector('iframe');
    const ir = iframe ? iframe.getBoundingClientRect() : null;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      body: overflow(document.body),
      main: overflow(document.querySelector('.main')),
      dshBar: overflow(bar),
      dshBarWrap: bar ? getComputedStyle(bar).flexWrap : null,
      iframe: ir ? { w: ir.width, h: ir.height, has: true } : { has: false },
    };
  })()
`;

async function main() {
  const targets = await listTargets();
  const page =
    targets.find((t) => t.type === "page" && /aster/i.test(t.title || "")) ||
    targets.find((t) => t.type === "page");
  if (!page) throw new Error("no CDP page");
  const ws = page.webSocketDebuggerUrl;
  const report = { phase: "m1-m3-wrap-ui", skipDpi200: true, observations: {} };

  report.observations.idle = await evalJs(
    ws,
    `(() => ({
      view: localStorage.getItem('aster.activeView'),
      restore: !!document.querySelector('.sidebar-restore'),
      sidebar: !!(document.querySelector('.sidebar') && document.querySelector('.sidebar').offsetParent),
      stopBtn: [...document.querySelectorAll('button')].some((b) => (b.innerText || '').includes('停止 Session')),
      perm: (document.querySelector('.perm') || {}).innerText || null,
      ctx: (document.querySelector('.ctx') || {}).textContent || null,
      state: (document.querySelector('.state') || {}).textContent || null,
    }))()`,
  );
  report.shots = {};
  report.shots.idle = await shot(ws, "m1-m3-wrap-idle-2026-08-25.png");

  // M1: hide sidebar via Ctrl+B then restore with the visible button.
  await evalJs(
    ws,
    `(async () => {
      const view = localStorage.getItem('aster.activeView') || 'pi';
      if (view !== 'pi') {
        const pi = [...document.querySelectorAll('.tb-tab')].find((b) => (b.innerText || '').includes('Pi'));
        if (pi) pi.click();
        await new Promise((r) => setTimeout(r, 400));
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return true;
    })()`,
  );
  report.observations.afterHide = await evalJs(
    ws,
    `(() => ({
      restore: !!document.querySelector('.sidebar-restore'),
      restoreLabel: document.querySelector('.sidebar-restore')?.textContent || null,
      sidebar: !!(document.querySelector('.sidebar') && document.querySelector('.sidebar').offsetParent),
      hiddenKey: localStorage.getItem('aster.sidebar.pi.hidden'),
    }))()`,
  );
  report.shots.sidebarHidden = await shot(ws, "m1-m3-wrap-sidebar-hidden-2026-08-25.png");
  await evalJs(
    ws,
    `(async () => {
      const btn = document.querySelector('.sidebar-restore');
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 300));
      return !!btn;
    })()`,
  );
  report.observations.afterRestore = await evalJs(
    ws,
    `(() => ({
      restore: !!document.querySelector('.sidebar-restore'),
      sidebar: !!(document.querySelector('.sidebar') && document.querySelector('.sidebar').offsetParent),
      hiddenKey: localStorage.getItem('aster.sidebar.pi.hidden'),
    }))()`,
  );

  // M2: archive / unarchive via visible buttons, auto-expand after open.
  report.observations.archiveUi = await evalJs(
    ws,
    `(async () => {
      const invoke = globalThis.__TAURI_INTERNALS__.invoke;
      const dbg = globalThis.__asterDebug;
      if (dbg) await dbg.piConsoleStore.refreshTree();
      await new Promise((r) => setTimeout(r, 400));
      const rows = [...document.querySelectorAll('.pi-project-tree li')];
      const archiveBtn = [...document.querySelectorAll('.pi-project-tree button.forget')]
        .find((b) => (b.innerText || '').trim() === '归档' && !b.disabled);
      if (!archiveBtn) {
        return {
          error: 'no enabled archive button',
          forgetLabels: [...document.querySelectorAll('.pi-project-tree button.forget')].map((b) => ({
            text: (b.innerText || '').trim(),
            disabled: b.disabled,
            title: b.title || '',
          })),
          groups: document.querySelectorAll('.project-group').length,
        };
      }
      archiveBtn.click();
      await new Promise((r) => setTimeout(r, 600));
      const unarchive = [...document.querySelectorAll('.pi-project-tree button.forget')]
        .find((b) => (b.innerText || '').trim() === '取消归档');
      const archivedLabel = [...document.querySelectorAll('.pi-project-tree .empty')]
        .some((el) => (el.textContent || '').includes('已归档'));
      if (unarchive) {
        unarchive.click();
        await new Promise((r) => setTimeout(r, 600));
      }
      const tree = dbg ? dbg.piConsoleStore.snapshot().tree : [];
      const activePath = dbg?.piConsoleStore.snapshot().active?.projectPath || null;
      const expanded = [...document.querySelectorAll('.project-toggle[aria-expanded="true"]')]
        .map((b) => b.querySelector('.name')?.textContent || '');
      const activeArchiveDisabled = [...document.querySelectorAll('.session-btn.active')]
        .map((btn) => {
          const forget = btn.parentElement?.querySelector('button.forget');
          return forget ? { text: forget.innerText.trim(), disabled: forget.disabled, title: forget.title } : null;
        });
      return {
        hadUnarchive: !!unarchive,
        archivedLabel,
        unarchiveStill: [...document.querySelectorAll('.pi-project-tree button.forget')]
          .some((b) => (b.innerText || '').trim() === '取消归档'),
        expanded,
        activeArchiveDisabled,
        treeProjects: tree.map((p) => ({
          name: p.displayName,
          sessions: p.sessions.length,
          archived: (p.archivedSessions || []).length,
        })),
        activePath,
      };
    })()`,
  );
  report.shots.tree = await shot(ws, "m1-m3-wrap-tree-2026-08-25.png");

  // M3: open a session if possible, inspect header, stop, crash, recover.
  report.observations.session = await evalJs(
    ws,
    `(async () => {
      const invoke = globalThis.__TAURI_INTERNALS__.invoke;
      const dbg = globalThis.__asterDebug;
      if (!dbg) return { error: 'no __asterDebug' };
      await dbg.piConsoleStore.refreshTree();
      await dbg.piConsoleStore.refreshRuntime();
      const snap = dbg.piConsoleStore.snapshot();
      if (!snap.active) {
        const tree = snap.tree || [];
        let opened = false;
        for (const p of tree) {
          const s = (p.sessions || []).find((x) => x.availability === 'available');
          if (s) {
            await dbg.piConsoleStore.openSession(p.path, s.sessionId);
            opened = true;
            break;
          }
        }
        if (!opened) {
          const runtimes = await invoke('pi_discover').catch((e) => String(e));
          return { error: 'no available session to open', runtimes, tree: tree.length };
        }
        await new Promise((r) => setTimeout(r, 8000));
      }
      const after = dbg.piConsoleStore.snapshot();
      const facts = dbg.getHostRuntimeFacts();
      return {
        sessionStatus: after.sessionStatus,
        lifecycle: facts.pi?.lifecycle || after.runtime?.lifecycle || null,
        hasActive: !!after.active,
        header: {
          state: document.querySelector('.state')?.textContent || null,
          ctx: document.querySelector('.ctx')?.textContent || null,
          perm: document.querySelector('.perm')?.innerText || null,
          stop: [...document.querySelectorAll('.lifecycle button')].map((b) => b.innerText.trim()),
          recover: [...document.querySelectorAll('.lifecycle button')].some((b) => (b.innerText || '').includes('重新打开')),
        },
        thinkingDetails: document.querySelectorAll('details.thinking').length,
        liveTools: after.liveTools?.length || 0,
      };
    })()`,
    120000,
  );
  report.shots.session = await shot(ws, "m1-m3-wrap-session-2026-08-25.png");

  if (report.observations.session?.hasActive) {
    report.observations.stop = await evalJs(
      ws,
      `(async () => {
        const dbg = globalThis.__asterDebug;
        const btn = [...document.querySelectorAll('.lifecycle button')]
          .find((b) => (b.innerText || '').includes('停止 Session'));
        if (!btn) return { error: 'no stop button' };
        btn.click();
        await new Promise((r) => setTimeout(r, 2500));
        const after = dbg.piConsoleStore.snapshot();
        const facts = dbg.getHostRuntimeFacts();
        return {
          clicked: true,
          sessionStatus: after.sessionStatus,
          lifecycle: facts.pi?.lifecycle || after.runtime?.lifecycle || null,
          hasActive: !!after.active,
          empty: !!document.querySelector('.pi-empty'),
          err: document.querySelector('.err')?.textContent || null,
        };
      })()`,
    );
    report.shots.afterStop = await shot(ws, "m1-m3-wrap-after-stop-2026-08-25.png");
  }

  // Crash: reopen, kill Pi RPC child, watch Crashed + recover button.
  report.observations.crash = await evalJs(
    ws,
    `(async () => {
      const dbg = globalThis.__asterDebug;
      if (!dbg) return { error: 'no __asterDebug' };
      await dbg.piConsoleStore.refreshTree();
      const snap = dbg.piConsoleStore.snapshot();
      if (!snap.active) {
        const tree = snap.tree || [];
        for (const p of tree) {
          const s = (p.sessions || []).find((x) => x.availability === 'available');
          if (s) {
            await dbg.piConsoleStore.openSession(p.path, s.sessionId);
            await new Promise((r) => setTimeout(r, 8000));
            break;
          }
        }
      }
      const after = dbg.piConsoleStore.snapshot();
      const facts = dbg.getHostRuntimeFacts();
      return {
        hasActive: !!after.active,
        sessionId: after.active?.sessionId || null,
        projectPath: after.active?.projectPath || null,
        runtimeInstanceId: after.active?.runtimeInstanceId || facts.pi?.runtimeInstanceId || null,
        lifecycle: facts.pi?.lifecycle || after.runtime?.lifecycle || null,
      };
    })()`,
    120000,
  );

  if (report.observations.crash?.hasActive) {
    const kill = ps(`
$aster = Get-Process -Name aster -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $aster) { throw 'no aster' }
$kids = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $aster.Id }
$rpc = $kids | Where-Object { $_.CommandLine -match 'pi-coding-agent' -or $_.CommandLine -match '--mode rpc' } | Select-Object -First 1
if (-not $rpc) { $rpc = $kids | Where-Object { $_.Name -match 'node' } | Select-Object -First 1 }
if (-not $rpc) { Write-Output 'none'; exit 0 }
taskkill /PID $rpc.ProcessId /T /F | Out-Null
Write-Output ("killed|{0}" -f $rpc.ProcessId)
`);
    report.observations.crashKill = kill;
    await sleep(1500);
    report.observations.crashUi = await evalJs(
      ws,
      `(async () => {
        const dbg = globalThis.__asterDebug;
        await dbg.piConsoleStore.refreshRuntime();
        const snap = dbg.piConsoleStore.snapshot();
        const facts = dbg.getHostRuntimeFacts();
        return {
          sessionStatus: snap.sessionStatus,
          lifecycle: facts.pi?.lifecycle || snap.runtime?.lifecycle || null,
          hasActive: !!snap.active,
          state: document.querySelector('.state')?.textContent || null,
          crashedClass: document.querySelector('.state.crashed') != null,
          recover: [...document.querySelectorAll('.lifecycle button')].some((b) => (b.innerText || '').includes('重新打开')),
          closeSlot: [...document.querySelectorAll('.lifecycle button')].some((b) => (b.innerText || '').includes('关闭槽位')),
          err: document.querySelector('.err')?.textContent || snap.error || null,
        };
      })()`,
    );
    report.shots.crashed = await shot(ws, "m1-m3-wrap-crashed-2026-08-25.png");
    if (report.observations.crashUi?.recover) {
      report.observations.recover = await evalJs(
        ws,
        `(async () => {
          const dbg = globalThis.__asterDebug;
          const btn = [...document.querySelectorAll('.lifecycle button')]
            .find((b) => (b.innerText || '').includes('重新打开'));
          btn.click();
          await new Promise((r) => setTimeout(r, 8000));
          const snap = dbg.piConsoleStore.snapshot();
          const facts = dbg.getHostRuntimeFacts();
          return {
            sessionStatus: snap.sessionStatus,
            lifecycle: facts.pi?.lifecycle || snap.runtime?.lifecycle || null,
            hasActive: !!snap.active,
            state: document.querySelector('.state')?.textContent || null,
            err: snap.error || document.querySelector('.err')?.textContent || null,
          };
        })()`,
        120000,
      );
      report.shots.recovered = await shot(ws, "m1-m3-wrap-recovered-2026-08-25.png");
      await evalJs(
        ws,
        `(async () => {
          const btn = [...document.querySelectorAll('.lifecycle button')]
            .find((b) => (b.innerText || '').includes('停止 Session') || (b.innerText || '').includes('关闭槽位'));
          if (btn) btn.click();
          await new Promise((r) => setTimeout(r, 2000));
          return true;
        })()`,
      );
    }
  }

  // DSH running bar + min window. No 200% DPI.
  report.observations.dshOpen = await evalJs(ws, openModule("DeepSeek Harness"));
  await sleep(4000);
  report.observations.dshBefore = await evalJs(
    ws,
    `(async () => {
      const invoke = globalThis.__TAURI_INTERNALS__.invoke;
      const status = await invoke('dsh_status').catch((e) => String(e));
      const startBtn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('启动'));
      if ((!status || !status.running) && startBtn && !startBtn.disabled) {
        startBtn.click();
        await new Promise((r) => setTimeout(r, 5000));
      }
      const next = await invoke('dsh_status').catch((e) => String(e));
      const probe = ${overflowProbe};
      return {
        status: next,
        tag: document.querySelector('.dsh-bar .tag')?.textContent || null,
        iframe: !!document.querySelector('iframe'),
        overflow: probe,
      };
    })()`,
    60000,
  );
  report.shots.dsh = await shot(ws, "m1-m3-wrap-dsh-2026-08-25.png");

  try {
    report.observations.minResize = resizeAster(800, 500);
    await sleep(600);
    report.observations.dshMin = await evalJs(ws, overflowProbe);
    await evalJs(ws, openModule("Pi"));
    await sleep(400);
    report.observations.piMin = await evalJs(ws, overflowProbe);
    report.shots.minwin = await shot(ws, "m1-m3-wrap-minwin-800x500-2026-08-25.png");
  } catch (err) {
    report.observations.minResize = { error: String(err.message || err) };
  }

  console.log(JSON.stringify(tokenize(report), null, 2));
}

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});

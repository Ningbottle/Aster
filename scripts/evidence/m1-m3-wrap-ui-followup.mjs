#!/usr/bin/env node
// Follow-up: archive/unarchive UI, permission text, DSH running iframe, min window.
// Skip OS 200% DPI. Tokenize paths.
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
      try { ws.close(); } catch {}
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
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "js");
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ps(command) {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "powershell failed").trim());
  return (r.stdout || "").trim();
}

function resizeAsterPhysical(pw, ph) {
  const out = ps(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMove2 {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h, bool r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out int l, out int t, out int r, out int b);
}
"@
# GetWindowRect signature above is wrong; use RECT via user32 through this helper:
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMove3 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int h, bool r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rc);
}
"@
$p = Get-Process -Name aster -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
if (-not $p) { throw 'no aster hwnd' }
$h = $p.MainWindowHandle
$ok = [WinMove3]::MoveWindow($h, 80, 80, ${pw}, ${ph}, $true)
Start-Sleep -Milliseconds 500
$rc = New-Object WinMove3+RECT
[void][WinMove3]::GetWindowRect($h, [ref]$rc)
Write-Output ("{0}|{1}|{2}|{3}|{4}|{5}" -f $ok, $p.Id, ($rc.R-$rc.L), ($rc.B-$rc.T), $rc.L, $rc.T)
`);
  const [ok, pid, w, h, x, y] = out.split("|");
  return { ok: ok === "True", pid: Number(pid), w: Number(w), h: Number(h), x: Number(x), y: Number(y) };
}

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
      iframe: ir ? { w: Math.round(ir.width), h: Math.round(ir.height), has: true } : { has: false },
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
  const report = { phase: "m1-m3-wrap-followup", skipDpi200: true, observations: {} };

  await evalJs(ws, `(async () => {
    const pi = [...document.querySelectorAll('.tb-tab')].find((b) => (b.innerText || '').includes('Pi'));
    if (pi) pi.click();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  })()`);

  report.observations.archive = await evalJs(ws, `(async () => {
    const dbg = globalThis.__asterDebug;
    await dbg.piConsoleStore.refreshTree();
    await new Promise((r) => setTimeout(r, 400));
    const groups = [...document.querySelectorAll('.project-group')];
    let expanded = false;
    for (const g of groups) {
      const toggle = g.querySelector('.project-toggle');
      if (toggle && toggle.getAttribute('aria-expanded') !== 'true') {
        toggle.click();
        expanded = true;
        await new Promise((r) => setTimeout(r, 150));
      }
      const archiveBtn = [...g.querySelectorAll('button.forget')]
        .find((b) => (b.innerText || '').trim() === '归档' && !b.disabled);
      if (archiveBtn) {
        const name = g.querySelector('.session-name')?.textContent || '';
        archiveBtn.click();
        await new Promise((r) => setTimeout(r, 700));
        const un = [...g.querySelectorAll('button.forget')]
          .find((b) => (b.innerText || '').trim() === '取消归档');
        const label = [...g.querySelectorAll('.empty')].some((el) => (el.textContent || '').includes('已归档'));
        if (un) {
          un.click();
          await new Promise((r) => setTimeout(r, 700));
        }
        const unAfter = [...g.querySelectorAll('button.forget')]
          .some((b) => (b.innerText || '').trim() === '取消归档');
        const tree = dbg.piConsoleStore.snapshot().tree;
        return {
          expanded,
          archivedName: name.trim(),
          hadUnarchive: !!un,
          archivedLabel: label,
          unarchiveGone: !unAfter,
          treeArchived: tree.map((p) => ({ n: p.displayName, a: (p.archivedSessions || []).length, s: p.sessions.length })),
        };
      }
    }
    return {
      error: 'no enabled archive after expand',
      forget: [...document.querySelectorAll('.pi-project-tree button.forget')].slice(0, 12).map((b) => ({
        text: b.innerText.trim(), disabled: b.disabled, title: b.title,
      })),
    };
  })()`);
  report.shots = { archive: await shot(ws, "m1-m3-wrap-archive-2026-08-25.png") };

  report.observations.permission = await evalJs(ws, `(async () => {
    const dbg = globalThis.__asterDebug;
    const snap = dbg.piConsoleStore.snapshot();
    if (!snap.active) {
      const tree = snap.tree || [];
      for (const p of tree) {
        const s = (p.sessions || []).find((x) => x.availability === 'available' && !x.isActive);
        if (s) {
          await dbg.piConsoleStore.openSession(p.path, s.sessionId);
          await new Promise((r) => setTimeout(r, 8000));
          break;
        }
      }
    }
    const details = document.querySelector('details.perm');
    if (details) details.open = true;
    await new Promise((r) => setTimeout(r, 200));
    const after = dbg.piConsoleStore.snapshot();
    return {
      hasActive: !!after.active,
      ctx: document.querySelector('.ctx')?.textContent || null,
      permText: document.querySelector('.perm')?.innerText || null,
      archiveOnActive: (() => {
        const row = document.querySelector('.session-btn.active')?.parentElement;
        const btn = row?.querySelector('button.forget');
        return btn ? { text: btn.innerText.trim(), disabled: btn.disabled, title: btn.title } : null;
      })(),
    };
  })()`, 120000);
  report.shots.permission = await shot(ws, "m1-m3-wrap-permission-2026-08-25.png");

  if (report.observations.permission?.hasActive) {
    await evalJs(ws, `(async () => {
      const btn = [...document.querySelectorAll('.lifecycle button')].find((b) => (b.innerText || '').includes('停止 Session'));
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 2500));
      return true;
    })()`);
    report.observations.afterStopTree = await evalJs(ws, `(() => {
      const active = document.querySelector('.session-btn.active');
      return {
        empty: !!document.querySelector('.pi-empty'),
        activeHighlight: !!active,
        activeName: active?.innerText?.slice(0, 80) || null,
      };
    })()`);
    report.shots.afterStopTree = await shot(ws, "m1-m3-wrap-stop-tree-2026-08-25.png");
  }

  const add = await evalJs(ws, `(async () => {
    const add = document.querySelector('button.tb-add');
    add.click();
    await new Promise((r) => setTimeout(r, 200));
    const item = [...document.querySelectorAll('.tb-menu button')].find((b) => (b.innerText || '').includes('DeepSeek'));
    if (item) item.click();
    await new Promise((r) => setTimeout(r, 800));
    return true;
  })()`);
  report.observations.dshTab = add;

  const dshWait = await evalJs(ws, `(async () => {
    const invoke = globalThis.__TAURI_INTERNALS__.invoke;
    let last = null;
    for (let i = 0; i < 20; i++) {
      last = await invoke('dsh_status').catch((e) => ({ error: String(e) }));
      const iframe = document.querySelector('iframe');
      if (last && last.running && last.healthy && iframe) {
        return { i, status: last, iframe: true, tag: document.querySelector('.dsh-bar')?.innerText || null };
      }
      const start = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('启动') && !b.disabled && !(b.innerText || '').includes('启动中') && !(b.innerText || '').includes('正在启动'));
      if (start) start.click();
      await new Promise((r) => setTimeout(r, 1500));
    }
    return {
      i: 20,
      status: last,
      iframe: !!document.querySelector('iframe'),
      tag: document.querySelector('.dsh-bar')?.innerText || null,
    };
  })()`, 60000);
  report.observations.dshWait = dshWait;
  report.shots.dshReady = await shot(ws, "m1-m3-wrap-dsh-running-2026-08-25.png");

  const dpr = dshWait?.status ? await evalJs(ws, `window.devicePixelRatio`) : 1.25;
  const physW = Math.round(800 * (typeof dpr === "number" ? dpr : 1.25));
  const physH = Math.round(500 * (typeof dpr === "number" ? dpr : 1.25));
  try {
    report.observations.minResize = resizeAsterPhysical(physW, physH);
    await sleep(700);
    report.observations.dshMin = await evalJs(ws, overflowProbe);
    report.shots.dshMin = await shot(ws, "m1-m3-wrap-dsh-minwin-2026-08-25.png");
  } catch (err) {
    report.observations.minResize = { error: String(err.message || err) };
  }

  console.log(JSON.stringify(tokenize(report), null, 2));
}

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});

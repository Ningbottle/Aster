// After-session titlebar probe: idle RTT, open session, RTT during/after, real clicks.
// Does not print session text, keys, or raw user paths.
import { execFileSync } from "node:child_process";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve);
      this.ws.addEventListener("error", () => reject(new Error("cdp ws error")));
    });
  }

  send(method, params = {}, timeoutMs = 120000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timeout`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, timeoutMs = 120000) {
    const result = await this.send(
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

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

const PROBE = `(() => {
  const invoke =
    (globalThis.__TAURI_INTERNALS__ && globalThis.__TAURI_INTERNALS__.invoke) ||
    (globalThis.__TAURI__ && globalThis.__TAURI__.core && globalThis.__TAURI__.core.invoke);
  if (!invoke) return Promise.resolve({ error: "no tauri invoke" });

  async function timed(cmd, args) {
    const t0 = performance.now();
    try {
      const value = await invoke(cmd, args || {});
      return { cmd, ok: true, ms: Math.round(performance.now() - t0), value };
    } catch (err) {
      return {
        cmd,
        ok: false,
        ms: Math.round(performance.now() - t0),
        error: String(err && err.message ? err.message : err),
      };
    }
  }

  function chromeUi() {
    const err = document.querySelector(".chrome-error")?.textContent ?? null;
    const labels = ["最小化", "最大化", "关闭"];
    const buttons = {};
    for (const label of labels) {
      const el = document.querySelector(\`.caption-btns [aria-label="\${label}"]\`);
      if (!el) {
        buttons[label] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      buttons[label] = {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        w: r.width,
        h: r.height,
        hit: top ? (top.closest("button")?.getAttribute("aria-label") || top.tagName) : null,
      };
    }
    return { chromeError: err, buttons };
  }

  return (async () => {
    const idleMinQuery = await timed("plugin:window|is_minimized", { label: "main" });
    const idleSnap = await timed("pi_runtime_snapshot", {});
    const tree = await timed("pi_project_tree_refresh", {});
    const nodes = Array.isArray(tree.value) ? tree.value : [];
    const first = nodes.map((n) => ({
      sessionCount: Array.isArray(n.sessions) ? n.sessions.length : 0,
      firstAvail: (n.sessions || []).find((s) => s.availability === "available") || null,
    })).find((n) => n.firstAvail);
    if (!first || !first.firstAvail) {
      return { idleMinQuery, idleSnap, treeOk: tree.ok, treeMs: tree.ms, error: "no available session" };
    }
    const projectPath = nodes.find((n) => (n.sessions || []).some((s) => s.sessionId === first.firstAvail.sessionId))?.path;
    const sessionId = first.firstAvail.sessionId;
    const sessionMeta = {
      messageCount: first.firstAvail.messageCount ?? null,
      availability: first.firstAvail.availability,
    };

    const openStarted = performance.now();
    const openP = invoke("pi_session_open", { projectPath, sessionId });
    const duringQuery = await timed("plugin:window|is_minimized", { label: "main" });
    let open;
    try {
      const value = await openP;
      open = {
        ok: true,
        ms: Math.round(performance.now() - openStarted),
        returnedMessageCount: Array.isArray(value?.messages) ? value.messages.length : null,
        isStreaming: value?.isStreaming ?? null,
      };
    } catch (err) {
      open = {
        ok: false,
        ms: Math.round(performance.now() - openStarted),
        error: String(err && err.message ? err.message : err),
      };
    }
    const afterQuery = await timed("plugin:window|is_minimized", { label: "main" });
    const afterSnap = await timed("pi_runtime_snapshot", {});
    const ui = chromeUi();
    return {
      idleMinQuery: { ok: idleMinQuery.ok, ms: idleMinQuery.ms, value: idleMinQuery.value },
      idleSnap: { ok: idleSnap.ok, ms: idleSnap.ms, lifecycle: idleSnap.value && idleSnap.value.lifecycle },
      treeMs: tree.ms,
      sessionMeta,
      duringQuery: { ok: duringQuery.ok, ms: duringQuery.ms, value: duringQuery.value },
      open,
      afterQuery: { ok: afterQuery.ok, ms: afterQuery.ms, value: afterQuery.value },
      afterSnap: { ok: afterSnap.ok, ms: afterSnap.ms, lifecycle: afterSnap.value && afterSnap.value.lifecycle },
      ui,
    };
  })();
})()`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function restoreAsterWindow() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AsterWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$p = Get-Process -Name aster -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
if (-not $p) { throw "no aster window" }
[AsterWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
"ok"
`;
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
  }).trim();
}

const WIN_STATE = `(() => {
  const invoke = (globalThis.__TAURI_INTERNALS__ && globalThis.__TAURI_INTERNALS__.invoke) ||
    (globalThis.__TAURI__ && globalThis.__TAURI__.core && globalThis.__TAURI__.core.invoke);
  return Promise.all([
    invoke("plugin:window|is_minimized", { label: "main" }),
    invoke("plugin:window|is_maximized", { label: "main" }),
  ]).then(([minimized, maximized]) => ({
    minimized,
    maximized,
    chromeError: document.querySelector(".chrome-error")?.textContent ?? null,
  }));
})()`;

async function clickAt(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

const targets = await listTargets();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no CDP page");
const cdp = new CdpSession(page.webSocketDebuggerUrl);
await cdp.open();
const report = await cdp.eval(PROBE, 180000);
if (report?.ui?.buttons?.["最小化"]) {
  const b = report.ui.buttons["最小化"];
  const t0 = Date.now();
  await clickAt(cdp, b.x, b.y);
  await sleep(800);
  const afterClick = await cdp.eval(
    `(() => {
      const invoke = (globalThis.__TAURI_INTERNALS__ && globalThis.__TAURI_INTERNALS__.invoke) ||
        (globalThis.__TAURI__ && globalThis.__TAURI__.core && globalThis.__TAURI__.core.invoke);
      return invoke("plugin:window|is_minimized", { label: "main" }).then((v) => ({
        minimized: v,
        chromeError: document.querySelector(".chrome-error")?.textContent ?? null,
        clickMs: null
      }));
    })()`,
  );
  report.clickMinimize = { ...afterClick, clickWallMs: Date.now() - t0 };
  if (afterClick?.minimized) {
    report.restore = restoreAsterWindow();
    await sleep(700);
  }
  const maxBtn = report.ui.buttons["最大化"];
  if (maxBtn) {
    await clickAt(cdp, maxBtn.x, maxBtn.y);
    await sleep(700);
    report.clickMaximize = await cdp.eval(WIN_STATE);
    await clickAt(cdp, maxBtn.x, maxBtn.y);
    await sleep(700);
    report.clickMaximizeRestore = await cdp.eval(WIN_STATE);
  }
}
cdp.close();
console.log(JSON.stringify(report, null, 2));

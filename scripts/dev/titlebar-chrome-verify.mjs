// Real-mouse titlebar chrome: min / restore / max / restore / close. Idle window only.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const LOCAL = process.env.LOCALAPPDATA || "";
const DIAG = path.join(LOCAL, "Aster", "logs", "diag.jsonl");

function tokenize(p) {
  if (p == null) return p;
  return String(p).replaceAll(LOCAL, "%LOCALAPPDATA%");
}

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

  send(method, params = {}, timeoutMs = 30000) {
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

  async eval(expression, timeoutMs = 30000) {
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

const INVOKE = `(() => {
  const invoke =
    (globalThis.__TAURI_INTERNALS__ && globalThis.__TAURI_INTERNALS__.invoke) ||
    (globalThis.__TAURI__ && globalThis.__TAURI__.core && globalThis.__TAURI__.core.invoke);
  if (!invoke) return Promise.resolve({ ok: false, error: "no tauri invoke" });
  async function tryCmd(cmd) {
    try {
      const value = await invoke(cmd, { label: "main" });
      return { ok: true, value: value === undefined ? null : value };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }
  return (async () => ({
    minimized: await tryCmd("plugin:window|is_minimized"),
    maximized: await tryCmd("plugin:window|is_maximized"),
  }))();
})()`;

const BOX = `(() => {
  const chromeError = document.querySelector(".chrome-error")?.textContent ?? null;
  const labels = ["最小化", "最大化", "关闭"];
  const buttons = {};
  for (const label of labels) {
    const el = document.querySelector(\`.caption-btns [aria-label="\${label}"]\`);
    if (!el) {
      buttons[label] = null;
      continue;
    }
    const r = el.getBoundingClientRect();
    buttons[label] = {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      w: r.width,
      h: r.height,
      dragAttr: el.getAttribute("data-tauri-drag-region"),
    };
  }
  return { chromeError, dpr: window.devicePixelRatio, buttons };
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
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$procs = @(Get-Process -Name aster -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) { throw "no aster.exe" }
foreach ($p in $procs) {
  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
    [AsterWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
    [AsterWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    "restored handle=$($p.MainWindowHandle) pid=$($p.Id)"
    exit 0
  }
}
throw "aster.exe has no MainWindowHandle"
`;
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
  }).trim();
}

function tailDiag(n) {
  if (!fs.existsSync(DIAG)) return [];
  const lines = fs.readFileSync(DIAG, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.slice(-n);
}

function parseKinds(lines) {
  const out = [];
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      out.push({
        kind: j.kind || null,
        event: j.detail?.event || null,
        name: j.detail?.name || null,
        window: j.detail?.window || null,
      });
    } catch {
      out.push({ kind: "unparsed" });
    }
  }
  return out;
}

const report = { steps: [], diagPath: tokenize(DIAG) };

try {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no CDP page");
  report.pageTitle = page.title || "";

  const cdp = new CdpSession(page.webSocketDebuggerUrl);
  await cdp.open();

  const before = await cdp.eval(INVOKE);
  const box = await cdp.eval(BOX);
  report.before = before;
  report.box = box;
  const diagBefore = fs.existsSync(DIAG) ? fs.statSync(DIAG).size : 0;
  report.diagBytesBefore = diagBefore;

  async function clickLabel(label) {
    const live = await cdp.eval(BOX);
    const b = live.buttons[label];
    if (!b) throw new Error(`missing button ${label}`);
    await clickAt(cdp, b.x, b.y);
    await sleep(700);
    const state = await cdp.eval(INVOKE);
    const ui = await cdp.eval(BOX);
    return { label, click: { x: b.x, y: b.y }, state, chromeError: ui.chromeError };
  }

  const minClick = await clickLabel("最小化");
  report.steps.push({ name: "click-minimize", ...minClick });

  if (!minClick.state?.minimized?.ok || minClick.state.minimized.value !== true) {
    report.restore = { skipped: true, reason: "minimize click did not minimize" };
  } else {
    report.restore = { os: restoreAsterWindow() };
    await sleep(700);
    report.afterRestore = await cdp.eval(INVOKE);
  }

  const maxClick = await clickLabel("最大化");
  report.steps.push({ name: "click-maximize", ...maxClick });
  const maxBack = await clickLabel("最大化");
  report.steps.push({ name: "click-maximize-restore", ...maxBack });

  const chromeAfter = await cdp.eval(BOX);
  report.chromeErrorAfterMax = chromeAfter.chromeError;

  const closeBtn = chromeAfter.buttons["关闭"] || box.buttons["关闭"];
  await clickAt(cdp, closeBtn.x, closeBtn.y);
  cdp.close();

  let gone = false;
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    try {
      const t = await listTargets();
      gone = !t.some((x) => x.type === "page" && /aster/i.test(x.title || ""));
      if (gone) break;
    } catch {
      gone = true;
      break;
    }
  }
  report.close = { clicked: true, pageGone: gone };

  await sleep(800);
  const tail = tailDiag(40);
  const kinds = parseKinds(tail);
  report.diagTailKinds = kinds.filter(
    (k) =>
      k.kind === "window" ||
      k.kind === "runevent" ||
      (k.kind === "shutdown" && String(k.name || "").includes("exit")),
  );
  report.diagHasCloseRequested = kinds.some(
    (k) => k.kind === "window" && k.event === "close_requested",
  );
  report.diagHasExit = kinds.some((k) => k.kind === "runevent" && k.event === "exit");

  const verdict =
    minClick.state?.minimized?.value === true &&
    maxClick.state?.maximized?.value === true &&
    maxBack.state?.maximized?.value === false &&
    !chromeAfter.chromeError &&
    gone &&
    report.diagHasCloseRequested;
  report.ok = Boolean(verdict);
} catch (e) {
  report.ok = false;
  report.error = String(e && e.message ? e.message : e);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

#!/usr/bin/env node
// M0 crash-without-stop UI: after external crash, click 停止 Session 后切换 must
// release the slot and switch to the target project. Driver-only via CDP.
// Usage: node scripts/evidence/m0-crash-stop-after.mjs <targetProjectPath>
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const SHOT_DIR = path.join("docs", "evidence");

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
}
function callCdp(wsUrl, method, params = {}, timeoutMs = 60000) {
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error(`CDP ${method} timeout`)); }, timeoutMs);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === 1) { clearTimeout(timer); ws.close(); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); }
    });
    ws.addEventListener("error", (e) => { clearTimeout(timer); reject(new Error(String(e.message || e))); });
  });
}
async function evalJs(wsUrl, expression, timeoutMs = 90000) {
  const r = await callCdp(wsUrl, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "js");
  return r.result?.value;
}
async function shot(wsUrl, name) {
  await callCdp(wsUrl, "Page.enable").catch(() => {});
  const r = await callCdp(wsUrl, "Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const out = path.join(SHOT_DIR, name);
  fs.writeFileSync(out, Buffer.from(r.data, "base64"));
  return out;
}

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page") || targets[0];
  const ws = page.webSocketDebuggerUrl;
  const p = process.argv[2];
  if (!p) throw new Error("usage: node m0-crash-stop-after.mjs <targetProjectPath>");
  const expr = `(async () => {
    const invoke = globalThis.__TAURI_INTERNALS__.invoke;
    const dbg = globalThis.__asterDebug;
    const p = ${JSON.stringify(p)};
    if (!dbg) return { err: 'no __asterDebug' };
    await dbg.piConsoleStore.refreshRuntime();
    const blocked = dbg.piProjectBlocksChange(dbg.getHostRuntimeFacts(), p);
    dbg.piConsoleStore.offerProjectBlock(p, blocked || '当前存在活动 Pi Session');
    await new Promise((r) => setTimeout(r, 250));
    const dialog = document.querySelector('[role="alertdialog"]');
    const stopBtn = [...(dialog ? dialog.querySelectorAll('button') : [])].find((b) =>
      (b.innerText || '').includes('停止 Session 后切换'),
    );
    if (!stopBtn) return { err: 'no stop-switch button', hasDialog: !!dialog };
    stopBtn.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      if (!document.querySelector('[role="alertdialog"]')) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const active = await invoke('project_get_active');
    const snap = await invoke('pi_runtime_snapshot');
    const cwd = document.querySelector('.session-header .cwd');
    return {
      dialogGone: !document.querySelector('[role="alertdialog"]'),
      active,
      lifecycle: snap && snap.lifecycle,
      projectPath: snap && snap.projectPath,
      headerCwd: cwd ? (cwd.getAttribute('title') || cwd.textContent) : null,
      emptyState: document.querySelector('.empty-state') ? document.querySelector('.empty-state').textContent.trim() : null,
    };
  })()`;
  const out = await evalJs(ws, expr);
  const shotPath = await shot(ws, "m0-crash-after-stop-2026-08-21.png");
  console.log(JSON.stringify({ ...out, shot: shotPath }, null, 2));
  const o = out;
  if (o.err) process.exit(1);
  if (!o.dialogGone) { console.error("FAILED: dialog not gone"); process.exit(1); }
  const target = String(p).toLowerCase().replace(/\\\\/g, "/");
  const active = String(o.active || "").toLowerCase().replace(/\\\\/g, "/");
  if (!active.includes(target.split("/").pop())) { console.error("FAILED: active not switched"); process.exit(1); }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
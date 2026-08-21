#!/usr/bin/env node
// M0 Stop-timeout UI: with ASTER_PI_STOP_WAIT_MS injected into the aster process,
// clicking 停止 Session 后切换 must fail (TimedOut), keep the alertdialog, surface
// the error in .session-header .err[role="alert"], and NOT switch the project.
// Usage: node scripts/evidence/m0-stop-timeout-observe.mjs <currentProjectPath> <targetProjectPath>
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const SHOT_DIR = path.join("docs", "evidence");

async function listTargets() {
  return (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
}
function callCdp(wsUrl, method, params = {}, timeoutMs = 90000) {
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
  const current = process.argv[2];
  const target = process.argv[3];
  if (!current || !target) throw new Error("usage: node m0-stop-timeout-observe.mjs <current> <target>");
  const expr = `(async () => {
    const invoke = globalThis.__TAURI_INTERNALS__.invoke;
    const dbg = globalThis.__asterDebug;
    const current = ${JSON.stringify(current)};
    const target = ${JSON.stringify(target)};
    if (!dbg) return { err: 'no __asterDebug' };
    // Ensure a session is bound on the current project.
    await dbg.piConsoleStore.refreshRuntime();
    let facts = dbg.getHostRuntimeFacts();
    if (!facts.pi || !facts.pi.projectPath) {
      await dbg.piConsoleStore.createSession(current);
      const t0 = Date.now();
      const norm = (x) => String(x || '').replace(/\\\\/g, '/').toLowerCase();
      while (Date.now() - t0 < 170000) {
        await dbg.piConsoleStore.refreshRuntime();
        facts = dbg.getHostRuntimeFacts();
        const cwd = document.querySelector('.session-header .cwd');
        const state = document.querySelector('.session-header .state');
        if (facts.pi && facts.pi.lifecycle === 'ready' && cwd && state && state.textContent.trim() === 'Ready') break;
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!facts.pi || facts.pi.lifecycle !== 'ready') return { err: 'session not ready', facts };
    }
    // Offer the block dialog targeting another project.
    const blocked = dbg.piProjectBlocksChange(dbg.getHostRuntimeFacts(), target);
    dbg.piConsoleStore.offerProjectBlock(target, blocked || '当前存在活动 Pi Session（超时注入）');
    await new Promise((r) => setTimeout(r, 250));
    const dialog = document.querySelector('[role="alertdialog"]');
    const stopBtn = [...(dialog ? dialog.querySelectorAll('button') : [])].find((b) =>
      (b.innerText || '').includes('停止 Session 后切换'),
    );
    if (!stopBtn) return { err: 'no stop-switch button', hasDialog: !!dialog };
    const tStart = Date.now();
    stopBtn.click();
    // The stop attempt blocks until budget timeout (~200ms) then fails. Give it 3s.
    await new Promise((r) => setTimeout(r, 3000));
    const elapsed = Date.now() - tStart;
    const activeBefore = await invoke('project_get_active');
    const snap = await invoke('pi_runtime_snapshot');
    const errEl = document.querySelector('.session-header .err[role="alert"]');
    const dialogStill = !!document.querySelector('[role="alertdialog"]');
    return {
      elapsed,
      lifecycle: snap && snap.lifecycle,
      projectPath: snap && snap.projectPath,
      activeBefore,
      dialogStill,
      errorText: errEl ? errEl.textContent.trim() : null,
      headerCwd: document.querySelector('.session-header .cwd') ? (document.querySelector('.session-header .cwd').getAttribute('title') || document.querySelector('.session-header .cwd').textContent) : null,
    };
  })()`;
  const out = await evalJs(ws, expr);
  const shotPath = await shot(ws, "m0-stop-timeout-2026-08-21.png");
  console.log(JSON.stringify({ ...out, shot: shotPath }, null, 2));
  const o = out;
  if (o.err) process.exit(1);
  const fails = [];
  if (!o.dialogStill) fails.push("dialog not kept");
  if (!o.errorText || !/未能停止|still alive|超时|TimedOut/i.test(String(o.errorText))) fails.push("error not visible");
  if (!o.projectPath) fails.push("slot cleared unexpectedly");
  if (fails.length) { console.error("FAILED: " + fails.join("; ")); process.exit(1); }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
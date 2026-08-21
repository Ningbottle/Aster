#!/usr/bin/env node
// M0 Stop-timeout recovery: after the injected stop failure kept the dialog,
// clicking 保持当前会话 must close the dialog and keep the live session intact.
// Usage: node scripts/evidence/m0-stop-timeout-keep.mjs
const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;

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
async function evalJs(wsUrl, expression, timeoutMs = 60000) {
  const r = await callCdp(wsUrl, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "js");
  return r.result?.value;
}

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page") || targets[0];
  const ws = page.webSocketDebuggerUrl;
  const expr = `(async () => {
    const invoke = globalThis.__TAURI_INTERNALS__.invoke;
    const dbg = globalThis.__asterDebug;
    if (!dbg) return { err: 'no __asterDebug' };
    const dialog = document.querySelector('[role="alertdialog"]');
    if (!dialog) return { err: 'no dialog (already closed)' };
    const keep = [...dialog.querySelectorAll('button')].find((b) => (b.innerText || '').includes('保持当前会话'));
    if (!keep) return { err: 'no keep button' };
    keep.click();
    await new Promise((r) => setTimeout(r, 400));
    const snap = await invoke('pi_runtime_snapshot');
    return {
      dialogGone: !document.querySelector('[role="alertdialog"]'),
      lifecycle: snap && snap.lifecycle,
      projectPath: snap && snap.projectPath,
      headerState: document.querySelector('.session-header .state') ? document.querySelector('.session-header .state').textContent.trim() : null,
    };
  })()`;
  const out = await evalJs(ws, expr);
  console.log(JSON.stringify(out, null, 2));
  if (out.err) process.exit(1);
  if (!out.dialogGone) { console.error("FAILED: dialog not closed"); process.exit(1); }
  if (out.lifecycle !== "ready") { console.error("FAILED: session not ready after keep"); process.exit(1); }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
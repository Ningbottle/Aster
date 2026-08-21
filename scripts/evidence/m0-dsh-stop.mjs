#!/usr/bin/env node
// M0 DSH stop: click 停止服务, expect Closed tag, no 38472 listener, dsh_status null.
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
    const tag = () => { const t = document.querySelector('.dsh-bar-left .tag'); return t ? t.textContent.trim() : null; };
    const stopBtn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('停止服务'));
    if (!stopBtn) return { err: 'no stop button', tag: tag() };
    stopBtn.click();
    const t0 = Date.now();
    let afterStop = tag();
    while (Date.now() - t0 < 40000) {
      afterStop = tag();
      if (afterStop === 'Closed') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const status = await invoke('dsh_status').then((s) => s, (e) => ({ err: String(e && e.message ? e.message : e) }));
    return { afterStop, status };
  })()`;
  const out = await evalJs(ws, expr);
  console.log(JSON.stringify(out, null, 2));
  if (out.err) process.exit(1);
  if (out.afterStop !== "Closed") { console.error("FAILED: not Closed: " + out.afterStop); process.exit(1); }
  if (out.status && !out.status.err && out.status.running) { console.error("FAILED: still running after stop"); process.exit(1); }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
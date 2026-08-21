#!/usr/bin/env node
// Observe current DSH module state and wait for transition to Ready or Closed.
const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;

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

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page") || targets[0];
  const ws = page.webSocketDebuggerUrl;
  const expr = `(async () => {
    const invoke = globalThis.__TAURI_INTERNALS__.invoke;
    const tag = () => { const t = document.querySelector('.dsh-bar-left .tag'); return t ? t.textContent.trim() : null; };
    const btnTexts = () => [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean).slice(0, 12);
    const t0 = Date.now();
    let seen = [];
    const samples = [];
    for (let i = 0; i < 400; i++) {
      const t = tag();
      if (t && !seen.includes(t)) { seen.push(t); samples.push({ t, ms: Date.now() - t0, btns: btnTexts() }); }
      if (t === 'Ready' || t === 'Closed') break;
      if (Date.now() - t0 > 90000) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const status = await invoke('dsh_status').then((s) => s, (e) => ({ err: String(e && e.message ? e.message : e) }));
    return { seen, samples, final: tag(), status };
  })()`;
  const out = await evalJs(ws, expr);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
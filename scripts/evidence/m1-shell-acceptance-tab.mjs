#!/usr/bin/env node
// M1 acceptance — Task 4 final: Tab focus traversal via CDP Input.dispatchKeyEvent
// (WebView-internal real input pipeline, immune to OS foreground locking).
// Records full forward focus chain and a backward (Shift+Tab) chain.

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}
function callCdp(wsUrl, method, params = {}, timeoutMs = 15000) {
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error(`CDP ${method} timeout`)); }, timeoutMs);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener("message", (ev) => { const msg = JSON.parse(String(ev.data)); if (msg.id === 1) { clearTimeout(timer); ws.close(); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); } });
    ws.addEventListener("error", (e) => reject(new Error(String(e.message || e))));
  });
}
async function evalJs(wsUrl, expression, timeoutMs = 20000) {
  const result = await callCdp(wsUrl, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "js");
  return result.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pressTab(wsUrl, shift = false) {
  const mods = shift ? 8 : 0; // Alt=1 Ctrl=2 Meta=4 Shift=8
  await callCdp(wsUrl, "Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: mods });
  await callCdp(wsUrl, "Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: mods });
}

const activeElement = `
  (() => {
    const el = document.activeElement;
    if (!el) return { tag: null };
    return {
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : String(el.className||'')).slice(0, 34),
      text: (el.textContent || '').trim().slice(0, 18),
      aria: el.getAttribute('aria-label') || '',
      title: (el.getAttribute('title') || '').slice(0, 14),
      placeholder: el.getAttribute('placeholder') || '',
    };
  })()
`;

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page" && /aster/i.test(t.title || "")) || targets.find((t) => t.type === "page");
  const wsUrl = page.webSocketDebuggerUrl;
  const report = { phase: "tab-traversal", observations: {} };

  // Reset focus to body by clicking an empty main area (CDP), ensure Pi active.
  await evalJs(wsUrl, `(async () => { const t=[...document.querySelectorAll('button.tb-tab')].find(b=>(b.innerText||'').trim()==='Pi'); if(t) t.click(); await new Promise(r=>setTimeout(r,400)); return true; })()`);
  // Forward chain: walk 20 tabs from current focus
  const forward = [];
  for (let i = 0; i < 20; i++) {
    await pressTab(wsUrl, false);
    await sleep(160);
    const el = await evalJs(wsUrl, activeElement);
    forward.push(el);
    // stop when we cycle back to body
    if (i > 0 && el.tag === "body") break;
  }
  report.observations.forwardChain = forward;
  report.observations.forwardUnique = new Set(forward.map((e) => `${e.tag}|${e.cls}|${e.text}|${e.aria}`)).size;

  // Backward chain (Shift+Tab) from last element
  const backward = [];
  for (let i = 0; i < 8; i++) {
    await pressTab(wsUrl, true);
    await sleep(160);
    const el = await evalJs(wsUrl, activeElement);
    backward.push(el);
    if (i > 0 && el.tag === "body") break;
  }
  report.observations.backwardChain = backward;

  // Skills simplified traversal
  await evalJs(wsUrl, `(async () => { const add=document.querySelector('button.tb-add'); add.click(); await new Promise(r=>setTimeout(r,150)); const item=[...(document.querySelector('.tb-menu')?.querySelectorAll('button')||[])].find(b=>(b.innerText||'').includes('Skills-Hub')); if(item) item.click(); await new Promise(r=>setTimeout(r,500)); return true; })()`);
  const skillsFwd = [];
  for (let i = 0; i < 10; i++) {
    await pressTab(wsUrl, false);
    await sleep(160);
    const el = await evalJs(wsUrl, activeElement);
    skillsFwd.push(el);
    if (i > 0 && el.tag === "body") break;
  }
  report.observations.skillsForwardChain = skillsFwd;
  report.observations.skillsForwardUnique = new Set(skillsFwd.map((e) => `${e.tag}|${e.cls}|${e.text}|${e.aria}`)).size;

  console.log(JSON.stringify(report, null, 2));
}
main().catch((e) => { console.error(JSON.stringify({ error: String(e.message || e) })); process.exit(1); });
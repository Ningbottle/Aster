#!/usr/bin/env node
// M0 DSH Starting/Ready observation: click 启动服务, capture the Starting tag
// while dsh_start is in flight, then Ready from backend lifecycle, then stop back to Closed.
// Usage: node scripts/evidence/m0-dsh-start-ready.mjs
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
  const expr = `(async () => {
    const invoke = globalThis.__TAURI_INTERNALS__.invoke;
    const tab = [...document.querySelectorAll('button.tb-tab')].find((b) => (b.innerText || '').includes('DeepSeek'));
    if (!tab) return { err: 'no DeepSeek tab' };
    tab.click();
    await new Promise((r) => setTimeout(r, 400));
    const idleTag = () => { const t = document.querySelector('.dsh-bar-left .tag'); return t ? t.textContent.trim() : null; };
    const idle = idleTag();
    const startBtn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('启动服务'));
    if (!startBtn) return { err: 'no start button', idle };
    startBtn.click();
    // Poll every 30ms to catch the transient Starting tag (only while dsh_start in flight).
    let seenStarting = false;
    let startingText = null;
    let startingFrames = 0;
    const t0 = Date.now();
    for (let i = 0; i < 400; i++) {
      const t = idleTag();
      if (t === 'Starting') {
        seenStarting = true;
        startingFrames++;
        if (!startingText) { startingText = t; await shotAt(ws); }
      }
      if (seenStarting && t && t !== 'Starting') break;
      if (Date.now() - t0 > 60000) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    // Wait for Ready.
    let final = idleTag();
    const t1 = Date.now();
    for (let i = 0; i < 300; i++) {
      final = idleTag();
      if (final === 'Ready') break;
      if (Date.now() - t1 > 60000) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const status = await invoke('dsh_status').then((s) => s, (e) => ({ err: String(e && e.message ? e.message : e) }));
    const stopBtn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('停止服务'));
    let afterStop = null;
    if (stopBtn) {
      stopBtn.click();
      const t2 = Date.now();
      for (let i = 0; i < 200; i++) {
        afterStop = idleTag();
        if (afterStop === 'Closed') break;
        if (Date.now() - t2 > 40000) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return { idle, seenStarting, startingText, startingFrames, final, status, afterStop };
    async function shotAt(wsRef) {
      try { await shot(wsRef, 'm0-dsh-starting-2026-08-21.png'); } catch {}
    }
  })()`;
  const out = await evalJs(ws, expr);
  const readyShot = await shot(ws, "m0-dsh-ready-2026-08-21.png");
  console.log(JSON.stringify({ ...out, readyShot }, null, 2));
  const o = out;
  if (o.err) process.exit(1);
  const fails = [];
  if (!o.seenStarting) fails.push("Starting tag not seen");
  if (o.final !== "Ready") fails.push("not Ready: " + String(o.final));
  if (o.status && o.status.err) fails.push("dsh_status err");
  if (fails.length) { console.error("FAILED: " + fails.join("; ")); process.exit(1); }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
#!/usr/bin/env node
// Real Pi tool-call observation. Does not print prompt text or absolute user paths.
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const SHOT_DIR = path.join("docs", "evidence");

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}
function callCdp(wsUrl, method, params = {}, timeoutMs = 180000) {
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error(`CDP ${method} timeout`)); }, timeoutMs);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === 1) {
        clearTimeout(timer); ws.close();
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      }
    });
    ws.addEventListener("error", (e) => { clearTimeout(timer); reject(new Error(String(e.message || e))); });
  });
}
async function evalJs(wsUrl, expression, timeoutMs = 180000) {
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
  return out.replaceAll("\\", "/");
}

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page") || targets[0];
  const ws = page.webSocketDebuggerUrl;
  await callCdp(ws, "Emulation.clearDeviceMetricsOverride", {}).catch(() => {});
  const out = await evalJs(ws, `(async () => {
    const pi = [...document.querySelectorAll('.tb-tab')].find((b) => (b.innerText || '').includes('Pi'));
    if (pi) pi.click();
    await new Promise((r) => setTimeout(r, 400));
    const dbg = globalThis.__asterDebug;
    let snap = dbg.piConsoleStore.snapshot();
    if (!snap.active) {
      const tree = snap.tree || [];
      for (const p of tree) {
        const s = (p.sessions || []).find((x) => x.availability === 'available');
        if (s) {
          await dbg.piConsoleStore.openSession(p.path, s.sessionId);
          await new Promise((r) => setTimeout(r, 8000));
          break;
        }
      }
    }
    snap = dbg.piConsoleStore.snapshot();
    if (!snap.active) return { error: 'no session' };
    await dbg.piConsoleStore.prompt('Use the bash tool to run exactly: echo aster-wrap-test then reply with just: DONE');
    const saw = { live: 0, thinking: false, toolDom: 0, thinkingDom: 0 };
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = dbg.piConsoleStore.snapshot();
      if (s.liveTools.length) saw.live = s.liveTools.length;
      if (s.streamingThinking) saw.thinking = true;
      saw.toolDom = document.querySelectorAll('details.tool').length;
      saw.thinkingDom = document.querySelectorAll('details.thinking').length;
      if (s.sessionStatus === 'idle' && i > 2) break;
    }
    const s = dbg.piConsoleStore.snapshot();
    const tools = [...document.querySelectorAll('details.tool')].map((d) => ({
      summary: d.querySelector('summary')?.textContent || '',
      err: d.classList.contains('err'),
    }));
    return {
      sessionStatus: s.sessionStatus,
      saw,
      liveTools: s.liveTools.map((t) => ({
        name: t.name,
        status: t.status,
        isError: t.isError,
        hasArgs: !!t.args,
        hasResult: !!t.result,
      })),
      toolDom: tools,
      thinkingDom: document.querySelectorAll('details.thinking').length,
      err: s.error,
    };
  })()`);
  const shotPath = await shot(ws, "m1-m3-wrap-toolcall-2026-08-25.png");
  console.log(JSON.stringify({ ...out, shot: shotPath }, null, 2));
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });

#!/usr/bin/env node
// Force CSS viewport 800x500 via CDP (OS HWND for aster is not the visible frame).
// Skip OS 200% DPI. DSH should already be running.
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const SHOT_DIR = path.join("docs", "evidence");

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}
function callCdp(wsUrl, method, params = {}, timeoutMs = 20000) {
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
async function evalJs(wsUrl, expression) {
  const r = await callCdp(wsUrl, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
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

const overflowProbe = `(() => {
  const overflow = (el) => el ? { sw: el.scrollWidth, cw: el.clientWidth, over: el.scrollWidth > el.clientWidth + 1 } : null;
  const bar = document.querySelector('.dsh-bar');
  const iframe = document.querySelector('iframe');
  const ir = iframe ? iframe.getBoundingClientRect() : null;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    body: overflow(document.body),
    main: overflow(document.querySelector('.main')),
    dshBar: overflow(bar),
    dshBarWrap: bar ? getComputedStyle(bar).flexWrap : null,
    dshBarText: bar ? bar.innerText.slice(0, 240) : null,
    iframe: ir ? { w: Math.round(ir.width), h: Math.round(ir.height), has: true } : { has: false },
  };
})()`;

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page") || targets[0];
  const ws = page.webSocketDebuggerUrl;
  const report = { phase: "minwin-css-800x500", skipDpi200: true, method: "CDP Emulation.setDeviceMetricsOverride" };

  await evalJs(ws, `(async () => {
    const add = document.querySelector('button.tb-add');
    if (add) { add.click(); await new Promise((r) => setTimeout(r, 150)); }
    const item = [...(document.querySelectorAll('.tb-menu button') || [])].find((b) => (b.innerText || '').includes('DeepSeek'));
    if (item) item.click();
    await new Promise((r) => setTimeout(r, 500));
    return true;
  })()`);

  report.before = await evalJs(ws, overflowProbe);
  await callCdp(ws, "Emulation.setDeviceMetricsOverride", {
    width: 800,
    height: 500,
    deviceScaleFactor: 0,
    mobile: false,
  });
  report.dsh800 = await evalJs(ws, overflowProbe);
  report.shotDsh = await shot(ws, "m1-m3-wrap-dsh-css800-2026-08-25.png");

  await evalJs(ws, `(async () => {
    const pi = [...document.querySelectorAll('.tb-tab')].find((b) => (b.innerText || '').includes('Pi'));
    if (pi) pi.click();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  })()`);
  report.pi800 = await evalJs(ws, overflowProbe);
  report.shotPi = await shot(ws, "m1-m3-wrap-pi-css800-2026-08-25.png");

  await callCdp(ws, "Emulation.clearDeviceMetricsOverride", {});
  report.afterClear = await evalJs(ws, overflowProbe);
  console.log(JSON.stringify(report, null, 2));
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });

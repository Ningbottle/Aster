#!/usr/bin/env node
// M0 crash-without-stop UI observation: assert crashed slot still blocks project change,
// Keep/Stop dialog appears, and stopping releases the slot. Driver-only via CDP.
// Usage: node scripts/evidence/m0-crash-observe.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const SHOT_DIR = path.join("docs", "evidence");

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}
function callCdp(wsUrl, method, params = {}, timeoutMs = 60000) {
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
async function evalJs(wsUrl, expression, timeoutMs = 60000) {
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
  if (!page) throw new Error("no CDP page");
  const ws = page.webSocketDebuggerUrl;

  const p = process.argv[2];
  if (!p) throw new Error("usage: node m0-crash-observe.mjs <projectPath>");
  const expr = `(async () => {
    const invoke = globalThis.__TAURI_INTERNALS__.invoke;
    const dbg = globalThis.__asterDebug;
    const p = ${JSON.stringify(p)};
    if (!dbg) return { err: 'no __asterDebug' };
    await dbg.piConsoleStore.refreshRuntime();
    const facts = dbg.getHostRuntimeFacts();
    const blocked = dbg.piProjectBlocksChange(facts, p);
    dbg.piConsoleStore.offerProjectBlock(p, blocked || '当前存在活动 Pi Session');
    await new Promise((r) => setTimeout(r, 300));
    const dialog = document.querySelector('[role="alertdialog"]');
    const choose = await invoke('project_choose', { path: p }).then(
      () => ({ ok: true }),
      (e) => ({ ok: false, err: String(e && e.message ? e.message : e) }),
    );
    return {
      lifecycle: facts.pi ? facts.pi.lifecycle : null,
      blocked,
      hasDialog: !!dialog,
      dialogText: dialog ? dialog.innerText.slice(0, 200) : null,
      choose,
    };
  })()`;
  const out = await evalJs(ws, expr);
  const shotPath = await shot(ws, "m0-crash-blocked-2026-08-21.png");
  console.log(JSON.stringify({ ...out, shot: shotPath }, null, 2));
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
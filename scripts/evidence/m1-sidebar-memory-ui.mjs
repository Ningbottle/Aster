#!/usr/bin/env node
// M1 Sidebar memory narrow slice — Phase B persistence verification.
// Fresh launch; open each module via the "+" tab menu, then verify:
//  - Pi: restored width/hidden
//  - Skills: restored width (sideWidths.slim) and hidden
//  - DSH: never has a sidebar, Ctrl+B must not create one

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}

function callCdp(wsUrl, method, params = {}, timeoutMs = 15000) {
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`CDP ${method} timeout`));
    }, timeoutMs);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
    ws.addEventListener("error", (e) => reject(new Error(String(e.message || e))));
  });
}

async function evalJs(wsUrl, expression, timeoutMs = 20000) {
  const result = await callCdp(wsUrl, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "js");
  }
  return result.result?.value;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const sidebarState = `
  (() => {
    const aside = document.querySelector('.sidebar');
    const resize = document.querySelector('.side-resize');
    return {
      asideExists: !!aside,
      asideVisible: !!(aside && aside.offsetParent !== null),
      resizeVisible: !!(resize && resize.offsetParent !== null),
      width: aside ? aside.getBoundingClientRect().width : null,
      storedPiHidden: localStorage.getItem('aster.sidebar.pi.hidden'),
      storedPiWidth: localStorage.getItem('aster.sidebar.pi.width'),
      storedSkillsHidden: localStorage.getItem('aster.sidebar.skills.hidden'),
      storedSideWidths: localStorage.getItem('aster.sideWidths'),
    };
  })()
`;

const openModule = (label) => `
  (async () => {
    const add = document.querySelector('button.tb-add');
    if (!add) return { ok: false, error: 'no tb-add button' };
    add.click();
    await new Promise((r) => setTimeout(r, 150));
    const menu = document.querySelector('.tb-menu');
    if (!menu) return { ok: false, error: 'no tb-menu' };
    const item = [...menu.querySelectorAll('button')].find((b) => (b.innerText || '').trim().includes(${JSON.stringify(label)}));
    if (!item) return { ok: false, error: 'menu item not found: ' + ${JSON.stringify(label)} };
    item.click();
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true };
  })()
`;

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page" && /aster/i.test(t.title || "")) || targets.find((t) => t.type === "page");
  if (!page) throw new Error("no CDP page");
  const wsUrl = page.webSocketDebuggerUrl;
  const report = { phase: "B", observations: {} };

  report.observations.storage = await evalJs(wsUrl, `(() => ({
    piHidden: localStorage.getItem('aster.sidebar.pi.hidden'),
    piWidth: localStorage.getItem('aster.sidebar.pi.width'),
    skillsHidden: localStorage.getItem('aster.sidebar.skills.hidden'),
    sideWidths: localStorage.getItem('aster.sideWidths'),
    activeView: localStorage.getItem('aster.activeView'),
    openTabs: localStorage.getItem('aster.openTabs'),
  }))()`);

  // Pi (already active on launch)
  await sleep(500);
  report.observations.piRestored = await evalJs(wsUrl, sidebarState);
  // Ctrl+B on Pi should hide; Ctrl+B again restore (regression check)
  await evalJs(wsUrl, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })); true`);
  await sleep(200);
  report.observations.piCtrlBHide = await evalJs(wsUrl, sidebarState);
  await evalJs(wsUrl, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })); true`);
  await sleep(200);
  report.observations.piCtrlBRestore = await evalJs(wsUrl, sidebarState);

  // Skills
  report.observations.skillsOpen = await evalJs(wsUrl, openModule("Skills-Hub"));
  await sleep(300);
  report.observations.skillsRestored = await evalJs(wsUrl, sidebarState);
  // Ctrl+B on Skills should hide and restore
  await evalJs(wsUrl, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })); true`);
  await sleep(200);
  report.observations.skillsCtrlBHide = await evalJs(wsUrl, sidebarState);
  await evalJs(wsUrl, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })); true`);
  await sleep(200);
  report.observations.skillsCtrlBRestore = await evalJs(wsUrl, sidebarState);

  // DSH
  report.observations.dshOpen = await evalJs(wsUrl, openModule("DeepSeek Harness"));
  await sleep(300);
  report.observations.dshRestored = await evalJs(wsUrl, sidebarState);
  await evalJs(wsUrl, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })); true`);
  await sleep(200);
  report.observations.dshAfterCtrlB = await evalJs(wsUrl, sidebarState);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
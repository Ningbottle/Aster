#!/usr/bin/env node
// M1 acceptance — Task 1: real pointer drag resize of Pi and Skills sidebars.
// Uses CDP Input.dispatchMouseEvent (real browser input pipeline) on .side-resize.
// Verifies: width change, clamping at min/max, localStorage write, persistence after reload.

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

async function getPage() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page" && /aster/i.test(t.title || "")) || targets.find((t) => t.type === "page");
  if (!page) throw new Error("no CDP page");
  return page.webSocketDebuggerUrl;
}

const openModule = (label) => `
  (async () => {
    const add = document.querySelector('button.tb-add');
    if (!add) return { ok: false, error: 'no tb-add' };
    add.click();
    await new Promise((r) => setTimeout(r, 150));
    const item = [...(document.querySelector('.tb-menu')?.querySelectorAll('button') || [])].find((b) => (b.innerText || '').includes(${JSON.stringify(label)}));
    if (!item) return { ok: false, error: 'no menu item' };
    item.click();
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true };
  })()
`;

const sidebarInfo = `
  (() => {
    const aside = document.querySelector('.sidebar');
    const resize = document.querySelector('.side-resize');
    return {
      width: aside ? aside.getBoundingClientRect().width : null,
      resizeX: resize ? resize.getBoundingClientRect().x + resize.getBoundingClientRect().width / 2 : null,
      resizeY: resize ? resize.getBoundingClientRect().y + resize.getBoundingClientRect().height / 2 : null,
      storedPiWidth: localStorage.getItem('aster.sidebar.pi.width'),
      storedSkillsWidth: localStorage.getItem('aster.sidebar.skills.width'),
    };
  })()
`;

async function drag(wsUrl, startX, startY, dx) {
  // Real pointer pipeline: press, several moves, release.
  await callCdp(wsUrl, "Input.dispatchMouseEvent", { type: "mousePressed", x: startX, y: startY, button: "left", buttons: 1, clickCount: 1 });
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await callCdp(wsUrl, "Input.dispatchMouseEvent", { type: "mouseMoved", x: startX + (dx * i) / steps, y: startY, button: "left", buttons: 1 });
    await sleep(30);
  }
  await callCdp(wsUrl, "Input.dispatchMouseEvent", { type: "mouseReleased", x: startX + dx, y: startY, button: "left", buttons: 0, clickCount: 1 });
}

async function main() {
  const wsUrl = await getPage();
  const report = { phase: "drag", observations: {} };

  // --- Pi: reset to a known clean state first ---
  await evalJs(wsUrl, `localStorage.removeItem('aster.sidebar.pi.width'); localStorage.removeItem('aster.sidebar.pi.hidden'); location.reload(); 'ok'`);
  await sleep(1500);
  report.observations.piBaseline = await evalJs(wsUrl, sidebarInfo);

  // drag wider by +80 (280 -> 360)
  let s = await evalJs(wsUrl, sidebarInfo);
  await drag(wsUrl, s.resizeX, s.resizeY, 80);
  await sleep(250);
  report.observations.piAfterDragWider = await evalJs(wsUrl, sidebarInfo);

  // drag narrower by -140 (360 -> 220, hits min clamp 220)
  s = await evalJs(wsUrl, sidebarInfo);
  await drag(wsUrl, s.resizeX, s.resizeY, -140);
  await sleep(250);
  report.observations.piAfterDragMinClamp = await evalJs(wsUrl, sidebarInfo);

  // drag far beyond max by +500 (should clamp at 420)
  s = await evalJs(wsUrl, sidebarInfo);
  await drag(wsUrl, s.resizeX, s.resizeY, 500);
  await sleep(250);
  report.observations.piAfterDragMaxClamp = await evalJs(wsUrl, sidebarInfo);

  // leave Pi at a distinctive width and reload to confirm persistence
  s = await evalJs(wsUrl, sidebarInfo);
  await drag(wsUrl, s.resizeX, s.resizeY, -80); // 420 -> 340
  await sleep(250);
  report.observations.piFinalWidth = await evalJs(wsUrl, sidebarInfo);
  await evalJs(wsUrl, `location.reload(); 'reload'`);
  await sleep(1500);
  report.observations.piAfterReload = await evalJs(wsUrl, sidebarInfo);

  // --- Skills ---
  await evalJs(wsUrl, openModule("Skills-Hub"));
  await sleep(400);
  // ensure visible (in case hidden persisted)
  await evalJs(wsUrl, `(() => { if (!document.querySelector('.sidebar')) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true })); } return true; })()`);
  await sleep(300);
  report.observations.skillsBaseline = await evalJs(wsUrl, sidebarInfo);

  // drag wider by +60 (176 -> 236)
  s = await evalJs(wsUrl, sidebarInfo);
  await drag(wsUrl, s.resizeX, s.resizeY, 60);
  await sleep(250);
  report.observations.skillsAfterDragWider = await evalJs(wsUrl, sidebarInfo);

  // drag far beyond max by +400 (should clamp at 300)
  s = await evalJs(wsUrl, sidebarInfo);
  await drag(wsUrl, s.resizeX, s.resizeY, 400);
  await sleep(250);
  report.observations.skillsAfterDragMaxClamp = await evalJs(wsUrl, sidebarInfo);

  // drag far below min by -300 (should clamp at 140)
  s = await evalJs(wsUrl, sidebarInfo);
  await drag(wsUrl, s.resizeX, s.resizeY, -300);
  await sleep(250);
  report.observations.skillsAfterDragMinClamp = await evalJs(wsUrl, sidebarInfo);

  // leave Skills at 200 and reload to confirm persistence
  s = await evalJs(wsUrl, sidebarInfo);
  await drag(wsUrl, s.resizeX, s.resizeY, 60); // 140 -> 200
  await sleep(250);
  report.observations.skillsFinalWidth = await evalJs(wsUrl, sidebarInfo);
  await evalJs(wsUrl, `location.reload(); 'reload'`);
  await sleep(1500);
  report.observations.skillsAfterReload = await evalJs(wsUrl, sidebarInfo);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
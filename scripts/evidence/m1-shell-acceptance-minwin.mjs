#!/usr/bin/env node
// M1 acceptance — Task 2: minimum-window overflow check per module.
// Expects the real window already at the configured min size (800x500).
// For each module: measure horizontal overflow (scrollWidth vs clientWidth) on body/main/sidebar.

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
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true };
  })()
`;

const overflowProbe = `
  (() => {
    const doc = document.documentElement;
    const body = document.body;
    const main = document.querySelector('.main');
    const aside = document.querySelector('.sidebar');
    const overflow = (el) => el ? { sw: el.scrollWidth, cw: el.clientWidth, over: el.scrollWidth > el.clientWidth + 1 } : null;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      doc: overflow(doc),
      body: overflow(body),
      main: overflow(main),
      aside: overflow(aside),
      anyOverflow: [doc, body, main, aside].some((e) => e && e.over),
      sidebarVisible: !!(aside && aside.offsetParent !== null),
      viewportActive: !!document.querySelector('.view.active'),
    };
  })()
`;

async function main() {
  const wsUrl = await getPage();
  const report = { phase: "minwin-800x500", observations: {} };

  // Pi
  report.observations.pi = await evalJs(wsUrl, overflowProbe);
  // Skills
  report.observations.skillsOpen = await evalJs(wsUrl, openModule("Skills-Hub"));
  await sleep(400);
  report.observations.skills = await evalJs(wsUrl, overflowProbe);
  // DSH
  report.observations.dshOpen = await evalJs(wsUrl, openModule("DeepSeek Harness"));
  await sleep(800);
  report.observations.dsh = await evalJs(wsUrl, overflowProbe);
  report.observations.dshIframe = await evalJs(wsUrl, `(() => {
    const f = document.querySelector('iframe');
    if (!f) return { hasIframe: false };
    const r = f.getBoundingClientRect();
    return { hasIframe: true, x: r.x, y: r.y, w: r.width, h: r.height, viewportW: window.innerWidth, viewportH: window.innerHeight, fullWidth: Math.abs(r.width - window.innerWidth) < 4, fullHeight: Math.abs(r.height - window.innerHeight) < 4 };
  })()`);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
// One-shot H1 probe: invoke window chrome commands via CDP. Do not click titlebar.

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const SKIP_CLOSE = process.env.ASTER_H1_SKIP_CLOSE === "1";

const EXPR = `(() => {
  const invoke =
    (globalThis.__TAURI_INTERNALS__ && globalThis.__TAURI_INTERNALS__.invoke) ||
    (globalThis.__TAURI__ && globalThis.__TAURI__.core && globalThis.__TAURI__.core.invoke);
  if (!invoke) return Promise.resolve({ ok: false, error: "no tauri invoke" });
  async function tryCmd(cmd) {
    try {
      const value = await invoke(cmd, { label: "main" });
      return { cmd, ok: true, value: value === undefined ? null : value };
    } catch (err) {
      return {
        cmd,
        ok: false,
        error: String(err && err.message ? err.message : err),
        name: err && err.name ? String(err.name) : null
      };
    }
  }
  return (async () => {
    const skipClose = ${SKIP_CLOSE ? "true" : "false"};
    const isMinBefore = await tryCmd("plugin:window|is_minimized");
    const minimize = await tryCmd("plugin:window|minimize");
    const isMinAfterMinimize = await tryCmd("plugin:window|is_minimized");
    const unminimize = await tryCmd("plugin:window|unminimize");
    const isMinAfterUnminimize = await tryCmd("plugin:window|is_minimized");
    const toggleMaximize = await tryCmd("plugin:window|toggle_maximize");
    const isMaxAfterToggle = await tryCmd("plugin:window|is_maximized");
    const toggleMaximizeBack = await tryCmd("plugin:window|toggle_maximize");
    const isMaxAfterToggleBack = await tryCmd("plugin:window|is_maximized");
    const close = skipClose
      ? { cmd: "plugin:window|close", ok: null, skipped: true }
      : await tryCmd("plugin:window|close");
    return {
      isMinBefore,
      minimize,
      isMinAfterMinimize,
      unminimize,
      isMinAfterUnminimize,
      toggleMaximize,
      isMaxAfterToggle,
      toggleMaximizeBack,
      isMaxAfterToggleBack,
      close,
    };
  })();
})()`;

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}

function callCdp(wsUrl, method, params = {}, timeoutMs = 30000) {
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error(`CDP ${method} timeout`));
    }, timeoutMs);
    const id = 1;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === id) {
        clearTimeout(timer);
        ws.close();
        if (msg.error) reject(new Error(`CDP ${method}: ${msg.error.message}`));
        else resolve(msg.result);
      }
    });
    ws.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`CDP ws error: ${e.message || "unknown"}`));
    });
  });
}

const targets = await listTargets();
const page = targets.find((t) => t.type === "page") || targets[0];
if (!page) throw new Error("no CDP page");
const result = await callCdp(page.webSocketDebuggerUrl, "Runtime.evaluate", {
  expression: EXPR,
  returnByValue: true,
  awaitPromise: true,
});
if (result.exceptionDetails) {
  console.error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  process.exit(3);
}
console.log(JSON.stringify(result.result?.value ?? result.result, null, 2));

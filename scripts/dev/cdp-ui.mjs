#!/usr/bin/env node
// 通过 WebView2 远程调试端口（CDP）驱动 Aster 窗口，用于真实 UI 人工验证留证。
// 前置：启动应用前设置环境变量
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// 用法：
//   node scripts/dev/cdp-ui.mjs list                          列出所有可调试目标（窗口/iframe）
//   node scripts/dev/cdp-ui.mjs eval --target <子串> --expr <JS>   在匹配目标中执行表达式（awaitPromise）
//   node scripts/dev/cdp-ui.mjs shot --target <子串> --out <png>   对匹配目标截屏
// --target 按 url 再 title 包含匹配；省略时取第一个 page 目标。
// 退出码：0 成功；2 找不到目标；3 CDP 调用失败。

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list HTTP ${res.status}`);
  return res.json();
}

function pickTarget(targets, needle) {
  const pages = targets.filter((t) => t.type === "page");
  if (!needle) return pages[0];
  return (
    pages.find((t) => (t.url || "").includes(needle)) ||
    pages.find((t) => (t.title || "").includes(needle)) ||
    // iframe 在 WebView2 中也可能以独立 page 目标出现；最后放宽到全部类型
    targets.find((t) => (t.url || "").includes(needle))
  );
}

async function callCdp(wsUrl, method, params = {}, timeoutMs = 15000) {
  const ws = new WebSocket(wsUrl);
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP ${method} timeout`)), timeoutMs);
    let id = 1;
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
  return done;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === "list") {
    const targets = await listTargets();
    for (const t of targets) {
      console.log(`${t.type}\t${t.id}\t${t.title || ""}\t${t.url || ""}`);
    }
    return;
  }

  const targets = await listTargets();
  const target = pickTarget(targets, args.target);
  if (!target) {
    console.error(`no target matches: ${args.target || "(first page)"}`);
    process.exit(2);
  }

  if (cmd === "eval") {
    const timeoutMs = args.timeout ? Number(args.timeout) : 120000;
    const result = await callCdp(
      target.webSocketDebuggerUrl,
      "Runtime.evaluate",
      {
        expression: args.expr,
        returnByValue: true,
        awaitPromise: true,
      },
      timeoutMs,
    );
    if (result.exceptionDetails) {
      console.error(`JS exception: ${JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails.text)}`);
      process.exit(3);
    }
    console.log(JSON.stringify(result.result?.value ?? result.result));
    return;
  }

  if (cmd === "shot") {
    await callCdp(target.webSocketDebuggerUrl, "Page.enable").catch(() => {});
    const result = await callCdp(target.webSocketDebuggerUrl, "Page.captureScreenshot", {
      format: "png",
    });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(args.out, Buffer.from(result.data, "base64"));
    console.log(`saved: ${args.out} (${target.url})`);
    return;
  }

  // probe <url>: 通过浏览器级端点新建一个目标加载 url，收集网络/控制台事件，
  // 用于诊断“页面在本 WebView2 浏览器进程中能否真实加载”（绕过 Tauri 建窗路径）。
  if (cmd === "probe") {
    const url = args._[1];
    const waitMs = args.timeout ? Number(args.timeout) : 12000;
    if (!url) {
      console.error("probe 需要 url 参数");
      process.exit(2);
    }
    const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    const events = [];
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", () => reject(new Error("browser ws error")));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId).catch(() => {});
    await send("Network.enable", {}, sessionId).catch(() => {});
    await send("Page.enable", {}, sessionId).catch(() => {});
    await send("Page.navigate", { url }, sessionId);
    await new Promise((r) => setTimeout(r, waitMs));
    let state;
    try {
      const r = await send(
        "Runtime.evaluate",
        {
          expression:
            "JSON.stringify({href:location.href,readyState:document.readyState,title:document.title,bodyTextLen:(document.body&&document.body.innerText||'').length,rootChildren:document.getElementById('root')?.childElementCount??null})",
          returnByValue: true,
        },
        sessionId
      );
      state = JSON.parse(r.result.value);
    } catch (e) {
      state = { evaluateFailed: String(e.message || e) };
    }
    const netSummary = {};
    for (const e of events) {
      if (e.method === "Network.requestWillBeSent") {
        netSummary[e.params.requestId] = { url: e.params.request.url, status: "pending" };
      } else if (e.method === "Network.responseReceived") {
        if (netSummary[e.params.requestId]) {
          netSummary[e.params.requestId].status = e.params.response.status;
        }
      } else if (e.method === "Network.loadingFailed") {
        if (netSummary[e.params.requestId]) {
          netSummary[e.params.requestId].status = "failed:" + (e.params.errorText || "?");
        }
      }
    }
    const consoleMsgs = events
      .filter((e) => e.method === "Runtime.consoleAPICalled")
      .map((e) => e.params.type + ": " + e.params.args.map((a) => a.value ?? a.description ?? "").join(" "))
      .slice(0, 20);
    console.log(JSON.stringify({ state, requests: Object.values(netSummary), consoleMsgs }, null, 1));
    await send("Target.closeTarget", { targetId }).catch(() => {});
    ws.close();
    return;
  }

  console.error("unknown command; expect list | eval | shot | probe");
  process.exit(2);
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(3);
});

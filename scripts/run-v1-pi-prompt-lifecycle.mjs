#!/usr/bin/env node
// Drive Aster via CDP invoke: create session, pin ark-coding/deepseek-v4-flash,
// prompt, busy-switch, abort, settle. Does not print prompt text, keys, or raw user paths.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const HOME = os.homedir();
const LOCAL = process.env.LOCALAPPDATA || "";

function tokenize(p) {
  if (p == null) return p;
  return String(p)
    .replaceAll(HOME, "%USERPROFILE%")
    .replaceAll(LOCAL, "%LOCALAPPDATA%");
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}

function pickPage(targets) {
  return (
    targets.find((t) => t.type === "page" && /aster/i.test(t.title || "")) ||
    targets.find((t) => t.type === "page")
  );
}

function callCdp(wsUrl, method, params = {}, timeoutMs = 180000) {
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error(`CDP ${method} timeout`));
    }, timeoutMs);
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
}

async function evalJs(wsUrl, expression, timeoutMs = 180000) {
  const result = await callCdp(
    wsUrl,
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    timeoutMs,
  );
  if (result.exceptionDetails) {
    const d =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "js exception";
    throw new Error(d);
  }
  return result.result?.value;
}

function invokeExpr(cmd, args) {
  const payload = JSON.stringify({ cmd, args: args || {} });
  return `(() => {
    const spec = ${payload};
    const invoke =
      (globalThis.__TAURI_INTERNALS__ && globalThis.__TAURI_INTERNALS__.invoke) ||
      (globalThis.__TAURI__ && globalThis.__TAURI__.core && globalThis.__TAURI__.core.invoke);
    if (!invoke) return Promise.resolve({ ok: false, error: "no tauri invoke" });
    return invoke(spec.cmd, spec.args)
      .then((value) => ({ ok: true, value }))
      .catch((err) => ({
        ok: false,
        error: String(err && err.message ? err.message : err),
      }));
  })()`;
}

function modelMeta(active) {
  if (!active || !active.model) return { provider: null, id: null };
  return { provider: active.model.provider || null, id: active.model.id || null };
}

async function main() {
  const projectA = fs.mkdtempSync(path.join(os.tmpdir(), "aster-v1-a-"));
  const projectB = fs.mkdtempSync(path.join(os.tmpdir(), "aster-v1-b-"));
  const report = {
    projectA: tokenize(projectA),
    projectB: tokenize(projectB),
    steps: [],
  };

  const targets = await listTargets();
  const page = pickPage(targets);
  if (!page) throw new Error("no CDP page target");
  const wsUrl = page.webSocketDebuggerUrl;
  report.pageTitle = page.title || "";

  async function step(name, cmd, args, timeoutMs) {
    const t0 = Date.now();
    const raw = await evalJs(wsUrl, invokeExpr(cmd, args), timeoutMs);
    const row = {
      name,
      cmd,
      ms: Date.now() - t0,
      ok: !!(raw && raw.ok),
      error: raw && raw.ok ? null : tokenize(raw && raw.error),
    };
    if (raw && raw.ok && raw.value && typeof raw.value === "object") {
      const v = raw.value;
      if (v.sessionId) row.sessionId = v.sessionId;
      if (v.sessionName != null) row.hasName = !!v.sessionName;
      if (typeof v.isStreaming === "boolean") row.isStreaming = v.isStreaming;
      if (typeof v.isCompacting === "boolean") row.isCompacting = v.isCompacting;
      if (typeof v.messageCount === "number") row.messageCount = v.messageCount;
      if (Array.isArray(v.messages)) row.messagesLen = v.messages.length;
      if (v.model || v.thinkingLevel) {
        row.model = modelMeta(v);
        row.thinkingLevel = v.thinkingLevel || null;
      }
      if (Array.isArray(v) && v[0] && v[0].id && v[0].provider) {
        row.modelIds = v.map((m) => `${m.provider}/${m.id}`);
      }
    }
    report.steps.push(row);
    return raw;
  }

  const chooseA = await step("choose_project_a", "project_choose", { path: projectA });
  if (!chooseA.ok) throw new Error(`project_choose A failed: ${chooseA.error}`);

  const created = await step("create_session_a", "pi_session_create", {
    projectPath: projectA,
  }, 180000);
  if (!created.ok) throw new Error(`create failed: ${created.error}`);
  const sessionA = created.value && created.value.sessionId;

  const models = await step("list_models", "pi_get_available_models", {});
  const arkListed =
    models.ok &&
    Array.isArray(models.value) &&
    models.value.some((m) => m.provider === "ark-coding" && m.id === "deepseek-v4-flash");
  report.arkListed = !!arkListed;
  report.uninerListed =
    models.ok &&
    Array.isArray(models.value) &&
    models.value.some((m) => m.provider === "uniner");

  const pinned = await step("pin_ark_flash", "pi_session_set_model", {
    provider: "ark-coding",
    modelId: "deepseek-v4-flash",
  });
  if (!pinned.ok) throw new Error(`set_model failed: ${pinned.error}`);
  report.pinned = modelMeta(pinned.value);
  if (report.pinned.provider !== "ark-coding" || report.pinned.id !== "deepseek-v4-flash") {
    throw new Error("active model is not ark-coding/deepseek-v4-flash; refusing to prompt");
  }

  const shortPrompt = "Reply with only the single word pong. Do not use tools.";
  const prompted = await step("prompt_short", "pi_session_prompt", {
    message: shortPrompt,
  });
  report.promptAccepted = prompted.ok;

  let sawStreaming = false;
  let settleIdle = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const snap = await step(`poll_after_prompt_${i}`, "pi_session_snapshot", {});
    if (snap.ok && snap.value && snap.value.isStreaming) sawStreaming = true;
    if (snap.ok && snap.value && !snap.value.isStreaming && !snap.value.isCompacting) {
      settleIdle = true;
      report.shortTurnMessages = snap.value.messages ? snap.value.messages.length : snap.value.messageCount;
      report.shortTurnModel = modelMeta(snap.value);
      break;
    }
  }
  report.sawStreaming = sawStreaming;
  report.shortTurnSettled = settleIdle;

  const longPrompt =
    "Count from 1 to 80, one integer per line, no tools, no extra commentary.";
  const longP = await step("prompt_long", "pi_session_prompt", { message: longPrompt });
  report.longPromptAccepted = longP.ok;

  await new Promise((r) => setTimeout(r, 400));
  const chooseB = await step("choose_project_b", "project_choose", { path: projectB });
  report.chooseBOk = chooseB.ok;
  const busy = await step("busy_create_b", "pi_session_create", { projectPath: projectB }, 60000);
  report.busyRejected = !busy.ok && /busy/i.test(String(busy.error || ""));
  report.busyError = busy.ok ? null : busy.error;

  const aborted = await step("abort", "pi_session_abort", {}, 60000);
  report.abortOk = aborted.ok;
  if (aborted.ok && aborted.value) {
    report.abortStreaming = aborted.value.isStreaming;
    report.abortMessages = aborted.value.messages
      ? aborted.value.messages.length
      : aborted.value.messageCount;
    report.abortModel = modelMeta(aborted.value);
  }

  const after = await step("snapshot_after_abort", "pi_session_snapshot", {});
  if (after.ok && after.value) {
    report.afterAbortStreaming = after.value.isStreaming;
    report.afterAbortModel = modelMeta(after.value);
  }

  const stopped = await step("stop", "pi_session_stop", {});
  report.stopOk = stopped.ok;
  report.sessionA = sessionA || null;

  console.log(JSON.stringify(report, null, 2));
  const failed =
    !report.promptAccepted ||
    report.pinned.provider !== "ark-coding" ||
    !report.shortTurnSettled ||
    !report.abortOk ||
    !report.stopOk;
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});

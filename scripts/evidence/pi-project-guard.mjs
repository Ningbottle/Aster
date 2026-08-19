#!/usr/bin/env node
// M0.1: live invoke proof that project mutations cannot retarget an active Pi binding.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const HOME = os.homedir();
const LOCAL = process.env.LOCALAPPDATA || "";

function tokenize(p) {
  if (p == null) return p;
  return String(p).replaceAll(HOME, "%USERPROFILE%").replaceAll(LOCAL, "%LOCALAPPDATA%");
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
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
    ws.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(new Error(String(e.message || e)));
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
    throw new Error(
      result.exceptionDetails.exception?.description || result.exceptionDetails.text || "js",
    );
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
      .catch((err) => ({ ok: false, error: String(err && err.message ? err.message : err) }));
  })()`;
}

async function main() {
  const targets = await listTargets();
  const page =
    targets.find((t) => t.type === "page" && /aster/i.test(t.title || "")) ||
    targets.find((t) => t.type === "page");
  if (!page) throw new Error("no CDP page");
  const wsUrl = page.webSocketDebuggerUrl;
  const steps = [];
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
    const v = raw && raw.value;
    if (v && typeof v === "object") {
      if (v.projectPath) row.projectPath = tokenize(v.projectPath);
      if (v.sessionId) row.sessionId = v.sessionId;
      if (v.lifecycle) row.lifecycle = v.lifecycle;
      if (v.isStreaming != null) row.isStreaming = v.isStreaming;
      if (typeof v === "string") row.active = tokenize(v);
    }
    if (typeof v === "string") row.active = tokenize(v);
    steps.push(row);
    return raw;
  }

  const projectA = fs.mkdtempSync(path.join(os.tmpdir(), "aster-m0-a-"));
  const projectB = fs.mkdtempSync(path.join(os.tmpdir(), "aster-m0-b-"));
  const report = { projectA: tokenize(projectA), projectB: tokenize(projectB), steps };

  const seedB = await step("seed_b_recent", "project_choose", { path: projectB });
  if (!seedB.ok) throw new Error(seedB.error);
  const chooseA = await step("choose_a", "project_choose", { path: projectA });
  if (!chooseA.ok) throw new Error(chooseA.error);
  const created = await step("create_a", "pi_session_create", { projectPath: projectA }, 180000);
  if (!created.ok) throw new Error(created.error);
  const bound = created.value.projectPath;

  const same = await step("choose_same", "project_choose", { path: projectA });
  report.sameProjectNoop = same.ok;

  const otherChoose = await step("choose_other", "project_choose", { path: projectB });
  report.idleChooseOtherRejected = !otherChoose.ok && /活动 Pi Session/.test(String(otherChoose.error || ""));
  report.idleChooseOtherError = otherChoose.error;

  const otherSet = await step("set_active_other", "project_set_active", { path: projectB });
  report.idleSetOtherRejected = !otherSet.ok && /活动 Pi Session/.test(String(otherSet.error || ""));

  const removeBound = await step("remove_bound", "project_remove", { path: projectA });
  report.removeBoundRejected = !removeBound.ok && /活动 Pi Session/.test(String(removeBound.error || ""));

  const removeOther = await step("remove_unrelated", "project_remove", { path: projectB });
  report.removeUnrelatedOk = removeOther.ok;

  const snap = await step("runtime_snapshot", "pi_runtime_snapshot", {});
  const active = await step("get_active", "project_get_active", {});
  report.afterReject = {
    headerProject: tokenize(created.value.projectPath),
    snapshotProject: snap.ok ? tokenize(snap.value && snap.value.projectPath) : null,
    snapshotLifecycle: snap.ok ? snap.value.lifecycle : null,
    dbActive: active.ok ? tokenize(active.value) : tokenize(active.error),
  };
  report.consistent =
    tokenize(bound) === report.afterReject.snapshotProject &&
    tokenize(bound) === report.afterReject.dbActive;

  await step("pin", "pi_session_set_model", {
    provider: "ark-coding",
    modelId: "deepseek-v4-flash",
  });
  const prompted = await step("prompt", "pi_session_prompt", {
    message: "Count from 1 to 40, one integer per line, no tools.",
  });
  report.promptOk = prompted.ok;
  await new Promise((r) => setTimeout(r, 400));
  const busySnap = await step("busy_snapshot", "pi_session_snapshot", {});
  report.wasStreaming = !!(busySnap.ok && busySnap.value && busySnap.value.isStreaming);
  const busyChoose = await step("busy_choose_other", "project_choose", { path: projectB });
  report.busyChooseRejected = !busyChoose.ok && /活动 Pi Session/.test(String(busyChoose.error || ""));
  await step("abort", "pi_session_abort", {});
  await step("stop", "pi_session_stop", {});

  const afterStop = await step("choose_b_after_stop", "project_choose", { path: projectB });
  report.chooseAfterStopOk = afterStop.ok;
  const activeAfter = await step("active_after_stop", "project_get_active", {});
  report.dbActiveAfterStop = activeAfter.ok ? tokenize(activeAfter.value) : null;
  const rtAfter = await step("runtime_after_stop", "pi_runtime_snapshot", {});
  report.lifecycleAfterStop = rtAfter.ok ? rtAfter.value.lifecycle : null;

  const skillsText = await evalJs(
    wsUrl,
    `(() => {
      const tabs = [...document.querySelectorAll('button.tb-tab')];
      const skills = tabs.find((b) => (b.innerText || '').includes('Skills'));
      if (skills) skills.click();
      return {
        hasM1: document.body.innerText.includes('运行 M1 示例流水线'),
        hasRollback: document.body.innerText.includes('回滚最新部署'),
      };
    })()`,
  );
  report.skillsUi = skillsText;

  console.log(JSON.stringify(report, null, 2));
  const failed =
    !report.sameProjectNoop ||
    !report.idleChooseOtherRejected ||
    !report.idleSetOtherRejected ||
    !report.removeBoundRejected ||
    !report.removeUnrelatedOk ||
    !report.consistent ||
    !report.busyChooseRejected ||
    !report.chooseAfterStopOk;
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});

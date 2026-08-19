#!/usr/bin/env node
// V0/V2/V3/V4 live Aster acceptance via CDP invoke.
// No prompt text, credentials, or raw user paths in output.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9222;
const HOME = os.homedir();
const LOCAL = process.env.LOCALAPPDATA || "";
const HANDSHAKE = path.join(os.tmpdir(), "aster-v2-handshake.json");
const SESSION_ROOT = path.join(HOME, ".pi", "agent", "sessions");
const PHASE = process.argv[2] || "before-restart";

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
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id === 1) {
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
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "js exception",
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

function findSessionJsonl(sessionId) {
  const stack = [SESSION_ROOT];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          const fd = fs.openSync(full, "r");
          const buf = Buffer.alloc(8 * 1024);
          const n = fs.readSync(fd, buf, 0, buf.length, 0);
          fs.closeSync(fd);
          const line = buf.slice(0, n).toString("utf8").split("\n")[0];
          const header = JSON.parse(line);
          if (header && header.id === sessionId) return full;
        } catch {
          /* skip */
        }
      }
    }
  }
  return null;
}

function treeFind(tree, sessionId) {
  for (const p of tree || []) {
    for (const s of p.sessions || []) {
      if (s.sessionId === sessionId) {
        return { projectPath: p.path, availability: s.availability, name: s.name, isActive: s.isActive };
      }
    }
  }
  return null;
}

async function connect() {
  const targets = await listTargets();
  const page = pickPage(targets);
  if (!page) throw new Error("no CDP page");
  return page.webSocketDebuggerUrl;
}

async function main() {
  const wsUrl = await connect();
  const steps = [];
  const report = { phase: PHASE, steps };

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
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (v.sessionId) row.sessionId = v.sessionId;
      if (v.runtimeInstanceId != null) row.runtimeInstanceId = v.runtimeInstanceId;
      if (v.sessionName != null) row.sessionName = v.sessionName;
      if (typeof v.isStreaming === "boolean") row.isStreaming = v.isStreaming;
      if (typeof v.messageCount === "number") row.messageCount = v.messageCount;
      if (Array.isArray(v.messages)) row.messagesLen = v.messages.length;
      if (v.thinkingLevel) row.thinkingLevel = v.thinkingLevel;
      if (v.model) row.model = modelMeta(v);
    }
    if (Array.isArray(v) && v[0] && v[0].sessions) {
      row.projectCount = v.length;
    }
    steps.push(row);
    return raw;
  }

  async function waitIdle(label, maxSec = 40) {
    for (let i = 0; i < maxSec; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const snap = await step(`${label}_${i}`, "pi_session_snapshot", {});
      if (snap.ok && snap.value && !snap.value.isStreaming && !snap.value.isCompacting) {
        return snap;
      }
    }
    return null;
  }

  if (PHASE === "before-restart") {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "aster-acc-"));
    report.project = tokenize(project);
    const choose = await step("choose_project", "project_choose", { path: project });
    if (!choose.ok) throw new Error(`choose failed: ${choose.error}`);

    const created = await step("create_session", "pi_session_create", { projectPath: project }, 180000);
    if (!created.ok) throw new Error(`create failed: ${created.error}`);
    const sessionId = created.value.sessionId;
    const instanceBeforeRename = created.value.runtimeInstanceId;

    const pin = await step("pin_ark", "pi_session_set_model", {
      provider: "ark-coding",
      modelId: "deepseek-v4-flash",
    });
    if (!pin.ok) throw new Error(`set_model failed: ${pin.error}`);
    if (modelMeta(pin.value).provider !== "ark-coding") {
      throw new Error("refusing to continue: active model is not ark-coding");
    }

    const think = await step("set_thinking_medium", "pi_session_set_thinking_level", {
      level: "medium",
    });

    const name1 = `aster-v0-${Date.now()}`;
    const renamed = await step("rename_warm", "pi_session_set_name", { name: name1 }, 120000);
    report.v0 = {
      renameOk: renamed.ok,
      renameMs: renamed.ms,
      timeout: !renamed.ok && /timed out|timeout/i.test(String(renamed.error || "")),
      name: renamed.ok ? renamed.value && renamed.value.sessionName : null,
      instanceUnchanged: renamed.ok && renamed.value.runtimeInstanceId === instanceBeforeRename,
    };

    const name2 = `${name1}-b`;
    const renamed2 = await step("rename_second", "pi_session_set_name", { name: name2 }, 120000);
    report.v0.secondOk = renamed2.ok;
    report.v0.secondMs = renamed2.ms;
    report.v0.secondName = renamed2.ok ? renamed2.value && renamed2.value.sessionName : null;

    const tree = await step("tree_after_rename", "pi_project_tree_refresh", {});
    const row = tree.ok ? treeFind(tree.value, sessionId) : null;
    report.v0.treeHasName = !!(row && row.name === name2);

    const prompted = await step("seed_prompt", "pi_session_prompt", {
      message: "Reply with only the single word pong. Do not use tools.",
    });
    report.seedPromptOk = prompted.ok;
    const settled = await waitIdle("seed_settle");
    report.seedSettled = !!(settled && settled.ok);
    const snap = settled && settled.ok ? settled.value : null;

    const handshake = {
      projectPath: project,
      sessionId,
      sessionName: name2,
      thinkingLevel: (snap && snap.thinkingLevel) || (think.ok && think.value.thinkingLevel) || null,
      model: modelMeta(snap || (pin.ok && pin.value)),
      messageCount: snap ? snap.messageCount : 0,
      messagesLen: snap && snap.messages ? snap.messages.length : 0,
      runtimeInstanceId: snap ? snap.runtimeInstanceId : null,
      renameMs: report.v0.renameMs,
      secondRenameMs: report.v0.secondMs,
    };
    fs.writeFileSync(HANDSHAKE, JSON.stringify(handshake, null, 2));
    report.handshake = {
      sessionId,
      sessionName: name2,
      thinkingLevel: handshake.thinkingLevel,
      model: handshake.model,
      messageCount: handshake.messageCount,
      runtimeInstanceId: handshake.runtimeInstanceId,
    };

    await step("stop_before_restart", "pi_session_stop", {});
  }

  if (PHASE === "after-restart") {
    if (!fs.existsSync(HANDSHAKE)) throw new Error("missing v2 handshake");
    const hs = JSON.parse(fs.readFileSync(HANDSHAKE, "utf8"));
    report.handshake = {
      sessionId: hs.sessionId,
      sessionName: hs.sessionName,
      thinkingLevel: hs.thinkingLevel,
      model: hs.model,
      messageCount: hs.messageCount,
      runtimeInstanceId: hs.runtimeInstanceId,
    };

    await step("choose_project", "project_choose", { path: hs.projectPath });
    const tree = await step("tree_rebuild", "pi_project_tree_refresh", {});
    const found = tree.ok ? treeFind(tree.value, hs.sessionId) : null;
    report.v2 = {
      treeFound: !!found,
      treeAvailability: found && found.availability,
      treeName: found && found.name,
    };

    const opened = await step(
      "open_restored",
      "pi_session_open",
      { projectPath: hs.projectPath, sessionId: hs.sessionId },
      180000,
    );
    report.v2.openOk = opened.ok;
    report.v2.openError = opened.ok ? null : opened.error;
    if (opened.ok) {
      const v = opened.value;
      report.v2.restored = {
        sessionId: v.sessionId,
        sessionName: v.sessionName,
        thinkingLevel: v.thinkingLevel,
        model: modelMeta(v),
        messageCount: v.messageCount,
        messagesLen: Array.isArray(v.messages) ? v.messages.length : null,
        runtimeInstanceId: v.runtimeInstanceId,
      };
      report.v2.nameMatches = v.sessionName === hs.sessionName;
      report.v2.modelMatches =
        modelMeta(v).provider === hs.model.provider && modelMeta(v).id === hs.model.id;
      report.v2.thinkingMatches = v.thinkingLevel === hs.thinkingLevel;
      report.v2.messagesRestored =
        (v.messageCount || 0) >= (hs.messageCount || 0) &&
        (Array.isArray(v.messages) ? v.messages.length : 0) >= (hs.messagesLen || 0);
      report.v2.newRuntimeInstance =
        v.runtimeInstanceId != null && v.runtimeInstanceId !== hs.runtimeInstanceId;
    }

    // V3 missing JSONL
    const jsonl = findSessionJsonl(hs.sessionId);
    report.v3 = { jsonlFound: !!jsonl, jsonl: jsonl ? tokenize(jsonl) : null };
    if (jsonl) {
      const parked = jsonl + ".aster-v3-park";
      fs.renameSync(jsonl, parked);
      await step("stop_before_missing", "pi_session_stop", {});
      const missingTree = await step("tree_after_delete_jsonl", "pi_project_tree_refresh", {});
      const missingRow = missingTree.ok ? treeFind(missingTree.value, hs.sessionId) : null;
      report.v3.afterDelete = missingRow;
      const openMissing = await step("open_missing_jsonl", "pi_session_open", {
        projectPath: hs.projectPath,
        sessionId: hs.sessionId,
      });
      report.v3.openMissingRejected = !openMissing.ok;
      report.v3.openMissingError = openMissing.ok ? null : openMissing.error;
      const tree2 = await step("tree_after_failed_open", "pi_project_tree_refresh", {});
      report.v3.afterFailedOpen = tree2.ok ? treeFind(tree2.value, hs.sessionId) : null;

      fs.renameSync(parked, jsonl);

      const moved = hs.projectPath + ".aster-v3-moved";
      fs.renameSync(hs.projectPath, moved);
      const movedTree = await step("tree_after_move_project", "pi_project_tree_refresh", {});
      report.v3.afterMoveProject = movedTree.ok ? treeFind(movedTree.value, hs.sessionId) : null;
      fs.renameSync(moved, hs.projectPath);

      const restoredTree = await step("tree_after_restore_project", "pi_project_tree_refresh", {});
      report.v3.afterRestoreProject = restoredTree.ok
        ? treeFind(restoredTree.value, hs.sessionId)
        : null;

      // Force missing again for index-remove UI path: park jsonl, refresh, remove index.
      fs.renameSync(jsonl, parked);
      await step("tree_missing_for_remove", "pi_project_tree_refresh", {});
      const removed = await step("index_remove", "pi_session_index_remove", {
        sessionId: hs.sessionId,
      });
      report.v3.indexRemoveOk = removed.ok;
      const afterRemove = removed.ok ? treeFind(removed.value, hs.sessionId) : null;
      report.v3.goneAfterIndexRemove = !afterRemove;
      fs.renameSync(parked, jsonl);
      const reappeared = await step("tree_after_jsonl_restored", "pi_project_tree_refresh", {});
      report.v3.reindexedAfterRestore = !!(reappeared.ok && treeFind(reappeared.value, hs.sessionId));
    }

    // V4 ergonomics
    const clickPi = await evalJs(
      wsUrl,
      `(() => {
        const tabs = [...document.querySelectorAll('button.tb-tab')];
        const pi = tabs.find((b) => (b.innerText || '').includes('Pi'));
        if (!pi) return { ok: false, error: 'no Pi tab' };
        pi.click();
        return { ok: true, tabCount: tabs.length };
      })()`,
    );
    report.v4 = { clickedPiTab: !!(clickPi && clickPi.ok) };
    await new Promise((r) => setTimeout(r, 300));

    const layout1 = await evalJs(
      wsUrl,
      `(() => {
        const aside = document.querySelector('aside.sidebar');
        const tree = document.querySelector('nav.pi-project-tree');
        return {
          hasSidebar: !!aside,
          sidebarWidth: aside ? aside.getBoundingClientRect().width : 0,
          hasTree: !!tree,
          hiddenKey: localStorage.getItem('aster.sidebar.pi.hidden'),
          widthKey: localStorage.getItem('aster.sidebar.pi.width'),
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      })()`,
    );
    report.v4.initial = layout1;

    const ctrlB = await evalJs(
      wsUrl,
      `(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
        const aside = document.querySelector('aside.sidebar');
        return {
          hiddenKey: localStorage.getItem('aster.sidebar.pi.hidden'),
          hasSidebar: !!aside,
          sidebarWidth: aside ? aside.getBoundingClientRect().width : 0,
        };
      })()`,
    );
    report.v4.afterCtrlBHide = ctrlB;
    const ctrlB2 = await evalJs(
      wsUrl,
      `(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
        const aside = document.querySelector('aside.sidebar');
        return {
          hiddenKey: localStorage.getItem('aster.sidebar.pi.hidden'),
          hasSidebar: !!aside,
          sidebarWidth: aside ? aside.getBoundingClientRect().width : 0,
        };
      })()`,
    );
    report.v4.afterCtrlBShow = ctrlB2;

    async function viewport(width, height, scale) {
      await callCdp(wsUrl, "Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: false,
      });
      await new Promise((r) => setTimeout(r, 250));
      const m = await evalJs(
        wsUrl,
        `(() => {
          const aside = document.querySelector('aside.sidebar');
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            sidebarWidth: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
            overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          };
        })()`,
      );
      return { width, height, scale, ...m };
    }
    report.v4.viewports = [
      await viewport(1100, 700, 1),
      await viewport(1440, 900, 1),
      await viewport(1440, 900, 2),
    ];
    await callCdp(wsUrl, "Emulation.clearDeviceMetricsOverride", {}).catch(() => {});

    const kb = await evalJs(
      wsUrl,
      `(() => {
        const start = document.activeElement;
        const seen = [];
        for (let i = 0; i < 8; i++) {
          const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
          document.dispatchEvent(ev);
          const el = document.activeElement;
          if (el) {
            seen.push({
              tag: el.tagName,
              aria: el.getAttribute('aria-label'),
              text: (el.innerText || '').trim().slice(0, 24),
            });
          }
        }
        return { startTag: start && start.tagName, hops: seen };
      })()`,
    );
    report.v4.keyboardTab = kb;

    report.v4.ctrlBHides =
      ctrlB && (ctrlB.hiddenKey === "1" || ctrlB.sidebarWidth === 0 || ctrlB.hasSidebar === false);
    report.v4.ctrlBRestores =
      ctrlB2 &&
      ctrlB2.hiddenKey !== "1" &&
      (ctrlB2.hasSidebar === true || (ctrlB2.sidebarWidth && ctrlB2.sidebarWidth >= 220));
    report.v4.noOverflow1100 = report.v4.viewports[0] && report.v4.viewports[0].overflowX === false;
    report.v4.scale2Observed = report.v4.viewports[2] && report.v4.viewports[2].scale === 2;
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});

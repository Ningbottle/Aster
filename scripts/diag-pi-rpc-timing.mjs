#!/usr/bin/env node
// V0: time Pi 0.84.2 RPC stages used by Aster rename/snapshot.
// Does not send prompt. Does not print session text, credentials, or raw user paths.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const LOCAL = process.env.LOCALAPPDATA || "";
const CLI = path.join(
  LOCAL,
  "Aster",
  "runtimes",
  "pi",
  "0.84.2",
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "cli.js",
);
const SESSION_ROOT = path.join(HOME, ".pi", "agent", "sessions");
const RPC_WAIT_MS = 120_000;

function tokenize(p) {
  if (!p) return p;
  return String(p)
    .replaceAll(HOME, "%USERPROFILE%")
    .replaceAll(LOCAL, "%LOCALAPPDATA%");
}

function firstJsonlObject(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.slice(0, n).toString("utf8");
    const line = text.split("\n").find((l) => l.trim());
    return line ? JSON.parse(line) : null;
  } finally {
    fs.closeSync(fd);
  }
}

function listSessions() {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        const st = fs.statSync(full);
        out.push({ file: full, bytes: st.size });
      }
    }
  };
  walk(SESSION_ROOT, 0);
  out.sort((a, b) => a.bytes - b.bytes);
  return out;
}

function pickSessions(all) {
  if (all.length === 0) return [];
  const small = all[0];
  const large = all[all.length - 1];
  if (small.file === large.file) return [small];
  return [small, large];
}

class RpcClient {
  constructor(cliJs, cwd, sessionPath) {
    this.pending = new Map();
    this.nextId = 1;
    const args = ["--mode", "rpc"];
    if (sessionPath) args.push("--session", sessionPath);
    this.child = spawn("node", [cliJs, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stderr.on("data", () => {});
    let buf = "";
    this.child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        const nl = buf.indexOf("\n");
        if (nl < 0) break;
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === "response" && msg.id && this.pending.has(msg.id)) {
          const { resolve } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
    this.child.on("exit", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("pi rpc process exited"));
      }
      this.pending.clear();
    });
  }

  request(body, timeoutMs = RPC_WAIT_MS) {
    const id = `diag-${this.nextId++}`;
    const started = Date.now();
    const payload = { ...body, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs}ms waiting for ${body.type}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve({ msg, ms: Date.now() - started });
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.child.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  async stop() {
    try {
      this.child.stdin.end();
    } catch {}
    const dead = new Promise((resolve) => this.child.on("exit", resolve));
    this.child.kill();
    await Promise.race([dead, new Promise((r) => setTimeout(r, 3000))]);
    if (this.child.exitCode == null) {
      try {
        this.child.kill("SIGKILL");
      } catch {}
    }
  }
}

function summarize(label, result) {
  const { msg, ms } = result;
  const data = msg.data && typeof msg.data === "object" ? msg.data : {};
  const row = {
    stage: label,
    ms,
    success: msg.success === true,
    command: msg.command || "",
    error: msg.success === true ? null : String(msg.error || "failed").slice(0, 120),
  };
  if (Array.isArray(data.messages)) row.messageCount = data.messages.length;
  if (typeof data.messageCount === "number") row.stateMessageCount = data.messageCount;
  if (typeof data.sessionName === "string") row.hasSessionName = data.sessionName.length > 0;
  if (typeof data.isStreaming === "boolean") row.isStreaming = data.isStreaming;
  if (typeof data.isCompacting === "boolean") row.isCompacting = data.isCompacting;
  if (data.tokens && typeof data.tokens === "object") row.hasTokens = true;
  return row;
}

async function runCase(label, cliJs, cwd, sessionPath) {
  const client = new RpcClient(cliJs, cwd, sessionPath);
  const rows = [];
  try {
    const state1 = await client.request({ type: "get_state" });
    rows.push(summarize("get_state", state1));
    const prevName =
      state1.msg?.data && typeof state1.msg.data.sessionName === "string"
        ? state1.msg.data.sessionName
        : null;

    const messages = await client.request({ type: "get_messages" });
    rows.push(summarize("get_messages", messages));

    const stats = await client.request({ type: "get_session_stats" });
    rows.push(summarize("get_session_stats", stats));

    const named = await client.request({
      type: "set_session_name",
      name: "aster-v0-rpc-timing",
    });
    rows.push(summarize("set_session_name", named));

    const state2 = await client.request({ type: "get_state" });
    rows.push(summarize("get_state_after_rename", state2));

    const t0 = Date.now();
    const bundled = [];
    bundled.push(summarize("bundle.get_state", await client.request({ type: "get_state" })));
    bundled.push(
      summarize("bundle.get_messages", await client.request({ type: "get_messages" })),
    );
    bundled.push(
      summarize("bundle.get_session_stats", await client.request({ type: "get_session_stats" })),
    );
    rows.push({
      stage: "aster_snapshot_sequence",
      ms: Date.now() - t0,
      success: bundled.every((r) => r.success),
      parts: bundled,
    });

    if (prevName) {
      await client.request({ type: "set_session_name", name: prevName });
    }
  } finally {
    await client.stop();
  }
  return {
    case: label,
    session: sessionPath ? tokenize(sessionPath) : "(new process, no --session)",
    cwd: tokenize(cwd),
    rows,
  };
}

async function main() {
  if (!fs.existsSync(CLI)) {
    console.error(JSON.stringify({ error: "pi 0.84.2 cli.js missing" }));
    process.exit(2);
  }
  const sessions = pickSessions(listSessions());
  const reports = [];

  const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), "aster-pi-rpc-"));
  reports.push(await runCase("empty-cwd-no-session-file", CLI, emptyCwd, null));

  for (const s of sessions) {
    const header = firstJsonlObject(s.file);
    const cwd = header && typeof header.cwd === "string" ? header.cwd : emptyCwd;
    const sizeClass = s === sessions[0] ? "smallest-jsonl" : "largest-jsonl";
    reports.push(
      await runCase(`${sizeClass}:${s.bytes}B`, CLI, cwd, s.file),
    );
  }

  const out = {
    cli: tokenize(CLI),
    rpcWaitMs: RPC_WAIT_MS,
    asterRenameCommand:
      "pi_session_set_name = set_session_name + get_state + get_messages + get_session_stats (each RPC timeout 30s)",
    cases: reports,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});

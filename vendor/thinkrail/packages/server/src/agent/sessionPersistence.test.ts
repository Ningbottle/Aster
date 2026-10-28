import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Message } from "@thinkrail/contracts";
import { materializeNewSession } from "./sessionPersistence";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createTemporaryDirectory(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "thinkrail-session-persistence-"));
	temporaryDirectories.push(path);
	return path;
}

const userMessage = (text: string): Message =>
	({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }) as Message;

test("materializes an empty native session with its ID and setup entries", async () => {
	const root = await createTemporaryDirectory();
	const cwd = join(root, "workspace");
	const sessionDir = join(root, "sessions");
	await mkdir(cwd);
	const manager = SessionManager.create(cwd, sessionDir);
	const sessionId = manager.getSessionId();
	manager.appendModelChange("anthropic", "claude-test");
	manager.appendThinkingLevelChange("high");

	await materializeNewSession(manager);

	const listed = (await SessionManager.list(cwd, sessionDir)).find((session) => session.id === sessionId);
	expect(listed).toBeDefined();
	expect(listed?.messageCount).toBe(0);
	const opened = SessionManager.open(listed!.path, sessionDir);
	expect(opened.getSessionId()).toBe(sessionId);
	expect(opened.getEntries().map((entry) => entry.type)).toEqual(["model_change", "thinking_level_change"]);
	manager.appendMessage(userMessage("first message"));
	expect((await readFile(manager.getSessionFile()!, "utf8")).match(/\n/g)).toHaveLength(4);
});

test("does not materialize an in-memory session", async () => {
	const manager = SessionManager.inMemory(await createTemporaryDirectory());
	await materializeNewSession(manager);
	expect(manager.getSessionFile()).toBeUndefined();
});

test("does not overwrite an existing native session path", async () => {
	const root = await createTemporaryDirectory();
	const cwd = join(root, "workspace");
	const sessionDir = join(root, "sessions");
	await mkdir(cwd);
	const manager = SessionManager.create(cwd, sessionDir);
	const sessionFile = manager.getSessionFile()!;
	const originalContents = "leave this file untouched\n";
	await writeFile(sessionFile, originalContents, "utf8");

	await expect(materializeNewSession(manager)).rejects.toThrow("Could not persist the new session");
	expect(await readFile(sessionFile, "utf8")).toBe(originalContents);
});

test("reports native session file I/O failures without exposing the path", async () => {
	const root = await createTemporaryDirectory();
	const cwd = join(root, "workspace");
	const sessionDir = join(root, "not-a-directory");
	await mkdir(cwd);
	await writeFile(sessionDir, "blocker", "utf8");
	const manager = SessionManager.create(cwd, sessionDir);

	await expect(materializeNewSession(manager)).rejects.toThrow(
		"Could not persist the new session to its native session file.",
	);
});

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileNode, ResourceMeta } from "@thinkrail/contracts";
import { loadWorkspaces } from "../persistence";
import { decodeText, resourceMeta } from "./content";

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function posixRelative(root: string, abs: string): string {
	return relative(root, abs).split(sep).join("/");
}

export function workspaceRelativePath(root: string, path: string): string | null {
	const base = resolve(root);
	const abs = resolve(base, path);
	return isContained(base, abs) ? posixRelative(base, abs) : null;
}

function isGitMetadataPath(root: string, candidate: string): boolean {
	return relative(root, candidate).split(sep).includes(".git");
}

function assertExistingAncestorContained(root: string, abs: string): void {
	const realRoot = realpathSync(root);
	let cursor = abs;
	while (true) {
		let real: string;
		try {
			real = realpathSync(cursor);
		} catch (error) {
			const code =
				typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
			const parent = dirname(cursor);
			if (parent === cursor) throw error;
			cursor = parent;
			continue;
		}
		if (!isContained(realRoot, real)) throw new Error("Path escapes the worktree");
		if (isGitMetadataPath(realRoot, real)) throw new Error("The .git directory is not readable");
		return;
	}
}

function resolveInWorktree(
	workspaceId: string,
	path: string,
	followLeaf: boolean,
): { root: string; abs: string } {
	const ws = loadWorkspaces().find((workspace) => workspace.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const root = ws.worktreePath;
	const abs = resolve(root, path);
	if (!isContained(resolve(root), abs)) throw new Error("Path escapes the worktree");
	if (isGitMetadataPath(resolve(root), abs)) throw new Error("The .git directory is not readable");
	assertExistingAncestorContained(root, followLeaf ? abs : dirname(abs));
	return { root, abs };
}

export function readDir(workspaceId: string, path: string): FileNode[] {
	const { root, abs } = resolveInWorktree(workspaceId, path, true);

	return readdirSync(abs, { withFileTypes: true })
		.filter((entry) => entry.name !== ".git")
		.map(
			(entry): FileNode => ({
				path: posixRelative(root, join(abs, entry.name)),
				name: entry.name,
				kind: entry.isDirectory() ? "dir" : "file",
			}),
		)
		.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
}

export function readFile(
	workspaceId: string,
	path: string,
): { content: string; meta: ResourceMeta } {
	const { abs } = resolveInWorktree(workspaceId, path, true);
	const bytes = readFileSync(abs);
	const meta = resourceMeta(bytes, path);
	return { content: meta.text ? decodeText(bytes) : "", meta };
}

export function resolveWorktreeFile(
	workspaceId: string,
	path: string,
	options: { followLeaf?: boolean } = {},
): string {
	return resolveInWorktree(workspaceId, path, options.followLeaf !== false).abs;
}

/** Base64 read for in-app previews; the byte cap keeps one panel from pinning the host. */
const BINARY_PREVIEW_LIMIT = 16 * 1024 * 1024;

const PREVIEW_MIME: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	avif: "image/avif",
	pdf: "application/pdf",
};

export function previewMime(path: string): string {
	const extension = path.split(".").pop()?.toLowerCase() ?? "";
	return PREVIEW_MIME[extension] ?? "application/octet-stream";
}

export function readBinary(
	workspaceId: string,
	path: string,
): { data: string; mime: string; byteLength: number } {
	const { abs } = resolveInWorktree(workspaceId, path, true);
	const info = statSync(abs);
	if (!info.isFile()) throw new Error("The path is not a file");
	if (info.size > BINARY_PREVIEW_LIMIT) {
		throw new Error(`The file is too large to preview (${info.size} bytes; limit ${BINARY_PREVIEW_LIMIT})`);
	}
	const bytes = readFileSync(abs);
	return { data: bytes.toString("base64"), mime: previewMime(path), byteLength: bytes.byteLength };
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ApprovalMode } from "@thinkrail/contracts";

/** Tools that write files or run commands; reads stay unattended in `ask` mode. */
const MUTATING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "bash"]);

const PREVIEW_LIMIT = 320;

/** One-line summary of what the call would do, for the confirmation dialog. */
function preview(input: Record<string, unknown>): string {
	const command = input.command;
	if (typeof command === "string") return command.slice(0, PREVIEW_LIMIT);
	const path = input.path;
	if (typeof path === "string") return path;
	return "";
}

/**
 * `ask` gates mutating tool calls through the extension confirm dialog, which
 * ThinkRail already forwards to the desktop client. A denial blocks the call and
 * the model receives the reason as the tool result.
 */
export function createApprovalGateExtension(getMode: () => ApprovalMode) {
	return (pi: ExtensionAPI) => {
		pi.on("tool_call", async (event, ctx) => {
			if (getMode() !== "ask") return;
			if (!MUTATING_TOOLS.has(event.toolName)) return;
			if (!ctx.hasUI) return;
			const detail = preview(event.input as Record<string, unknown>);
			const allowed = await ctx.ui.confirm(
				`Allow ${event.toolName}?`,
				detail || `Run the ${event.toolName} tool?`,
			);
			if (allowed) return;
			return { block: true, reason: "The user denied this tool call." };
		});
	};
}

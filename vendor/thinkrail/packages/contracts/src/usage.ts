/** Local, read-only statistics over native Pi records in registered workspaces. */
export type UsageRange = "all" | "30d" | "7d";

export interface UsageTokens {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Sum of the four recorded token categories, including cached tokens. */
	total: number;
}

export interface UsageSummary {
	range: UsageRange;
	timeZone: string;
	generatedAt: number;
	/** Sessions containing at least one user/assistant record in the selected dates. */
	sessions: number;
	/** User and assistant messages, excluding tool results and summaries. */
	messages: number;
	totalTokens: number;
	activeDays: number;
	/** Hour in timeZone (0–23), based on message activity; null without messages. */
	peakHour: number | null;
	favoriteModel: { provider: string; id: string } | null;
	daily: { date: string; tokens: number; messages: number }[];
	models: { provider: string; id: string; messages: number; tokens: UsageTokens }[];
	coverage: {
		workspaceCount: number;
		sessionsRead: number;
		unreportedResponses: number;
		issues: { workspaceId: string; sessionId?: string; code: "UNREADABLE_WORKSPACE" | "UNREADABLE_SESSION" | "INVALID_RECORD" }[];
	};
}

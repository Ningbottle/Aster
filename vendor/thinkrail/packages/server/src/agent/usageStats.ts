import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { UsageRange, UsageSummary, UsageTokens } from "@thinkrail/contracts";

export function usageRequest(params: unknown): { range: UsageRange; timeZone: string } {
	if (!params || typeof params !== "object" || Array.isArray(params) ||
		Object.keys(params).some(key => key !== "range" && key !== "timeZone")) throw new Error("Invalid usage request.");
	const range: unknown = Reflect.get(params, "range");
	const timeZone: unknown = Reflect.get(params, "timeZone");
	if (range !== "all" && range !== "30d" && range !== "7d") throw new Error("Invalid usage range.");
	if (typeof timeZone !== "string" || !timeZone || timeZone.length > 100) throw new Error("Invalid usage time zone.");
	try { new Intl.DateTimeFormat("en", { timeZone }).format(); }
	catch { throw new Error("Invalid usage time zone."); }
	return { range, timeZone };
}

interface UsageRecord {
	id: string;
	timestamp: number;
	role: "user" | "assistant" | "usage";
	provider: string;
	model: string;
	tokens: UsageTokens | null;
}

function recordedTokens(value: unknown): UsageTokens | null {
	if (!value || typeof value !== "object") return null;
	const parts = ["input", "output", "cacheRead", "cacheWrite"] as const;
	if (parts.some(key => typeof Reflect.get(value, key) !== "number" || !Number.isFinite(Reflect.get(value, key)) || Reflect.get(value, key) < 0)) return null;
	const [input, output, cacheRead, cacheWrite] = [
		Reflect.get(value, parts[0]) as number,
		Reflect.get(value, parts[1]) as number,
		Reflect.get(value, parts[2]) as number,
		Reflect.get(value, parts[3]) as number,
	] as const;
	return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

/** Project metadata only. Neither message bodies nor paths are sent to the renderer. */
export function projectUsageEntry(entry: SessionEntry): UsageRecord | null {
	if (entry.type === "message") {
		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant") return null;
		const assistant = message.role === "assistant" ? message : null;
		return { id: entry.id, timestamp: message.timestamp, role: message.role,
			provider: typeof assistant?.provider === "string" ? assistant.provider : "", model: typeof assistant?.model === "string" ? assistant.model : "", tokens: assistant ? recordedTokens(assistant.usage) : null };
	}
	if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") {
		if (!entry.usage) return null;
		return { id: entry.id, timestamp: Date.parse(entry.timestamp), role: "usage",
			provider: entry.type === "usage" ? entry.provider : "", model: entry.type === "usage" ? entry.model : "", tokens: recordedTokens(entry.usage) };
	}
	return null;
}

export function usageAccumulator(range: UsageRange, timeZone: string, workspaceCount: number, now = Date.now()) {
	const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
	const dateParts = (timestamp: number) => {
		const parts = formatter.formatToParts(timestamp);
		const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === kind)!.value;
		return { day: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
	};
	const today = dateParts(now).day;
	const start = new Date(`${today}T00:00:00Z`);
	start.setUTCDate(start.getUTCDate() - (range === "7d" ? 6 : 29));
	const since = range === "all" ? null : start.toISOString().slice(0, 10);
	const result: UsageSummary = { range, timeZone, generatedAt: now, sessions: 0, messages: 0, totalTokens: 0, activeDays: 0,
		peakHour: null, favoriteModel: null, daily: [], models: [], coverage: { workspaceCount, sessionsRead: 0, unreportedResponses: 0, issues: [] } };
	const seen = new Set<string>();
	const sessionIds = new Set<string>();
	const daily = new Map<string, UsageSummary["daily"][number]>();
	const models = new Map<string, UsageSummary["models"][number]>();
	const hours = Array<number>(24).fill(0);
	const invalid = new Set<string>();
	return {
		issue(workspaceId: string, code: UsageSummary["coverage"]["issues"][number]["code"], sessionId?: string) {
			result.coverage.issues.push({ workspaceId, code, ...(sessionId ? { sessionId } : {}) });
		},
		addSession(workspaceId: string, sessionId: string, entries: readonly SessionEntry[]) {
			result.coverage.sessionsRead += 1;
			for (const entry of entries) {
				const record = projectUsageEntry(entry);
				if (!record) continue;
				if (!Number.isFinite(record.timestamp) || (record.role !== "user" && !record.tokens)) {
					if (!invalid.has(sessionId)) { invalid.add(sessionId); result.coverage.issues.push({ workspaceId, sessionId, code: "INVALID_RECORD" }); }
				}
				if (!Number.isFinite(record.timestamp) || record.timestamp > now) continue;
				const { day, hour } = dateParts(record.timestamp);
				if (since && day < since) continue;
				if (record.role !== "usage") sessionIds.add(sessionId);
				// Pi createBranchedSession preserves inherited entry ids and timestamps.
				const key = `${record.id}:${record.timestamp}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const activity = daily.get(day) ?? { date: day, tokens: 0, messages: 0 };
				daily.set(day, activity);
				// The h23 formatter returns 0–23, and hours has all 24 initialized buckets.
				if (record.role !== "usage") { result.messages += 1; activity.messages += 1; hours[hour]! += 1; }
				if (record.role === "user") continue;
				if (!record.tokens) { result.coverage.unreportedResponses += 1; continue; }
				result.totalTokens += record.tokens.total;
				activity.tokens += record.tokens.total;
				const modelKey = JSON.stringify([record.provider, record.model]);
				const model = models.get(modelKey) ?? { provider: record.provider, id: record.model, messages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
				if (record.role === "assistant") model.messages += 1;
				for (const field of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) model.tokens[field] += record.tokens[field];
				models.set(modelKey, model);
			}
		},
		finish(): UsageSummary {
			result.sessions = sessionIds.size;
			result.daily = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
			result.activeDays = result.daily.filter(day => day.messages > 0).length;
			if (result.messages > 0) result.peakHour = hours.indexOf(Math.max(...hours));
			result.models = [...models.values()].sort((a, b) => b.tokens.total - a.tokens.total || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
			const favorite = result.models.find(model => model.id && model.tokens.total > 0);
			result.favoriteModel = favorite ? { provider: favorite.provider, id: favorite.id } : null;
			return result;
		},
	};
}

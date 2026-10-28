import { describe, expect, test } from "bun:test";
import { isSessionModelSettingsResult, type SessionModelSettingsResult, type WsResult } from "./wsProtocol";

const model = {
	id: "fixture-model",
	name: "Fixture model",
	provider: "fixture",
	contextWindow: 128_000,
	reasoning: true,
	thinkingLevels: ["off", "minimal", "low", "medium", "high"],
	cost: { input: 0, output: 0 },
	input: ["text", "image"],
	auth: { kind: "other", detail: "fixture" },
} satisfies NonNullable<SessionModelSettingsResult["model"]>;

describe("session model settings acknowledgement", () => {
	test("accepts serialized confirmed settings for both mutations", () => {
		const result = { ok: true, model, thinkingLevel: "high" } satisfies WsResult<"session.setModel">;
		const thinking: WsResult<"session.setThinkingLevel"> = result;
		expect(isSessionModelSettingsResult(JSON.parse(JSON.stringify(thinking)))).toBe(true);
		expect(isSessionModelSettingsResult({ ok: true, model: null, thinkingLevel: "off" })).toBe(true);
	});

	test("rejects legacy acknowledgements and invalid effective levels", () => {
		for (const value of [
			{ ok: true },
			{ ok: false, model, thinkingLevel: "high" },
			{ ok: true, model, thinkingLevel: "turbo" },
			{ ok: true, model, thinkingLevel: "toString" },
			{ ok: true, model, thinkingLevel: null },
		]) expect(isSessionModelSettingsResult(value)).toBe(false);
	});

	test("rejects malformed model capabilities and optional metadata", () => {
		for (const invalidModel of [
			undefined,
			[],
			{ ...model, reasoning: "true" },
			{ ...model, contextWindow: Number.NaN },
			{ ...model, thinkingLevels: ["off", "bogus"] },
			{ ...model, thinkingLevels: "high" },
			{ ...model, input: ["text", "bogus"] },
			{ ...model, cost: { input: 0, output: "free" } },
			{ ...model, auth: { kind: "bogus" } },
		]) expect(isSessionModelSettingsResult({ ok: true, model: invalidModel, thinkingLevel: "off" })).toBe(false);
	});
});

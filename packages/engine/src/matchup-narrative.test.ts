// pattern: Functional Core
import { describe, expect, it } from "vitest";
import {
	type MatchupNarrative,
	parseNarrative,
	serializeNarrative,
	verdictDisplayLabel,
} from "./matchup-narrative.js";

describe("serializeNarrative / parseNarrative", () => {
	it("round-trips structured narrative", () => {
		const narrative: MatchupNarrative = {
			onPlayVerdict: "player0_wins",
			onDrawVerdict: "draw",
			playNarrative: "Alice leads with Bolt for the win.",
			drawNarrative: "Both sides trade evenly.",
		};
		const json = serializeNarrative(narrative);
		const parsed = parseNarrative(json);
		expect(parsed).toEqual(narrative);
	});

	it("returns null for plain text", () => {
		expect(parseNarrative("just some text")).toBeNull();
	});

	it("returns null for invalid JSON structure", () => {
		expect(parseNarrative('{"foo": "bar"}')).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseNarrative("")).toBeNull();
	});
});

describe("verdictDisplayLabel", () => {
	it("formats player0 wins", () => {
		expect(verdictDisplayLabel("player0_wins", "alice", "bob")).toBe(
			"@alice wins",
		);
	});

	it("formats player1 wins", () => {
		expect(verdictDisplayLabel("player1_wins", "alice", "bob")).toBe(
			"@bob wins",
		);
	});

	it("formats draw", () => {
		expect(verdictDisplayLabel("draw", "alice", "bob")).toBe("Draw");
	});

	it("passes through unknown verdict", () => {
		expect(verdictDisplayLabel("unresolved", "alice", "bob")).toBe(
			"unresolved",
		);
	});
});

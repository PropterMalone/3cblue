// pattern: Functional Core
import type { Card } from "@3cblue/shared";
import { describe, expect, it } from "vitest";
import { formatDeckForPrompt, parseVerdict } from "./matchup-evaluator.js";

describe("parseVerdict", () => {
	it("parses P0_WINS", () => {
		const text = "Some analysis...\nVERDICT: P0_WINS";
		expect(parseVerdict(text)).toBe("player0_wins");
	});

	it("parses P1_WINS", () => {
		const text = "Reasoning here.\nVERDICT: P1_WINS";
		expect(parseVerdict(text)).toBe("player1_wins");
	});

	it("parses DRAW", () => {
		const text = "Neither can win.\nVERDICT: DRAW";
		expect(parseVerdict(text)).toBe("draw");
	});

	it("finds verdict even with trailing whitespace", () => {
		const text = "Analysis...\nVERDICT: P0_WINS  ";
		expect(parseVerdict(text)).toBe("player0_wins");
	});

	it("uses last verdict line when multiple exist", () => {
		const text =
			"Initially VERDICT: DRAW\nBut reconsidering...\nVERDICT: P1_WINS";
		expect(parseVerdict(text)).toBe("player1_wins");
	});

	it("throws on missing verdict", () => {
		expect(() => parseVerdict("no verdict here")).toThrow(
			"failed to parse LLM verdict",
		);
	});

	it("throws on invalid verdict value", () => {
		expect(() => parseVerdict("VERDICT: INVALID")).toThrow(
			"failed to parse LLM verdict",
		);
	});
});

describe("formatDeckForPrompt", () => {
	it("formats a creature card", () => {
		const card: Card = {
			name: "Goblin Guide",
			manaCost: "{R}",
			cmc: 1,
			colors: ["R"],
			types: ["creature"],
			supertypes: [],
			subtypes: ["Goblin", "Scout"],
			oracleText:
				"Haste\nWhenever Goblin Guide attacks, defending player reveals the top card of their library.",
			power: 2,
			toughness: 2,
			abilities: [],
			scryfallId: "test",
		};
		const result = formatDeckForPrompt("Player 0's deck", [card]);
		expect(result).toContain("## Player 0's deck");
		expect(result).toContain("**Goblin Guide** {R}");
		expect(result).toContain("2/2");
		expect(result).toContain("Haste");
	});

	it("formats a land without mana cost or p/t", () => {
		const card: Card = {
			name: "Island",
			manaCost: "",
			cmc: 0,
			colors: [],
			types: ["land"],
			supertypes: ["basic"],
			subtypes: ["Island"],
			oracleText: "({T}: Add {U}.)",
			abilities: [],
			scryfallId: "test",
		};
		const result = formatDeckForPrompt("Player 1's deck", [card]);
		expect(result).toContain("**Island**");
		expect(result).not.toContain("undefined");
		expect(result).toContain("({T}: Add {U}.)");
	});
});

// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { parseOracleText } from "./oracle-parser.js";

describe("parseOracleText", () => {
	describe("keywords", () => {
		it("parses a single keyword", () => {
			const result = parseOracleText("Flying");
			expect(result).toEqual([{ kind: "keyword", keyword: "flying" }]);
		});

		it("parses multiple comma-separated keywords", () => {
			const result = parseOracleText("Flying, first strike");
			expect(result).toEqual([
				{ kind: "keyword", keyword: "flying" },
				{ kind: "keyword", keyword: "first_strike" },
			]);
		});

		it("strips reminder text in parentheses", () => {
			const result = parseOracleText(
				"Deathtouch (Any amount of damage this deals to a creature is enough to destroy it.)",
			);
			expect(result).toEqual([{ kind: "keyword", keyword: "deathtouch" }]);
		});

		it("parses all evergreen keywords", () => {
			const keywords = [
				["Flying", "flying"],
				["First strike", "first_strike"],
				["Double strike", "double_strike"],
				["Trample", "trample"],
				["Deathtouch", "deathtouch"],
				["Lifelink", "lifelink"],
				["Reach", "reach"],
				["Menace", "menace"],
				["Defender", "defender"],
				["Vigilance", "vigilance"],
				["Indestructible", "indestructible"],
				["Haste", "haste"],
				["Hexproof", "hexproof"],
				["Flash", "flash"],
			] as const;

			for (const [text, expected] of keywords) {
				const result = parseOracleText(text);
				expect(result, `failed for "${text}"`).toEqual([
					{ kind: "keyword", keyword: expected },
				]);
			}
		});

		it("parses multiline keywords on separate lines", () => {
			const result = parseOracleText("Flying\nVigilance");
			expect(result).toEqual([
				{ kind: "keyword", keyword: "flying" },
				{ kind: "keyword", keyword: "vigilance" },
			]);
		});
	});

	describe("ward", () => {
		it("parses ward with mana cost", () => {
			const result = parseOracleText("Ward {2}");
			expect(result).toEqual([
				{ kind: "keyword", keyword: "ward", cost: "{2}" },
			]);
		});
	});

	describe("protection", () => {
		it("parses protection from a color", () => {
			const result = parseOracleText("Protection from red");
			expect(result).toEqual([
				{ kind: "keyword", keyword: "protection", qualifier: "red" },
			]);
		});

		it("parses protection with reminder text", () => {
			const result = parseOracleText(
				"Protection from black (This creature can't be blocked, targeted, dealt damage, enchanted, or equipped by anything black.)",
			);
			expect(result).toEqual([
				{ kind: "keyword", keyword: "protection", qualifier: "black" },
			]);
		});
	});

	describe("ETB effects", () => {
		it("parses ETB damage to any target", () => {
			const result = parseOracleText(
				"When Goblin Chainwhirler enters the battlefield, it deals 1 damage to any target",
			);
			expect(result).toEqual([
				{ kind: "etb_damage", amount: 1, target: "any_target" },
			]);
		});

		it("parses ETB damage to each opponent", () => {
			const result = parseOracleText(
				"When Siege Rhino enters the battlefield, it deals 3 damage to each opponent",
			);
			expect(result).toEqual([
				{ kind: "etb_damage", amount: 3, target: "opponent" },
			]);
		});

		it("parses ETB life gain", () => {
			const result = parseOracleText(
				"When Angel of Vitality enters the battlefield, you gain 4 life",
			);
			expect(result).toEqual([{ kind: "etb_life_gain", amount: 4 }]);
		});

		it("parses ETB create token", () => {
			const result = parseOracleText(
				"When Cloudgoat Ranger enters the battlefield, create three 1/1 white Kithkin Soldier creature tokens",
			);
			expect(result).toEqual([
				{
					kind: "etb_create_token",
					count: 3,
					power: 1,
					toughness: 1,
					keywords: [],
				},
			]);
		});

		it("parses ETB create a single token", () => {
			const result = parseOracleText(
				"When Attended Knight enters the battlefield, create a 1/1 white Soldier creature token",
			);
			expect(result).toEqual([
				{
					kind: "etb_create_token",
					count: 1,
					power: 1,
					toughness: 1,
					keywords: [],
				},
			]);
		});
	});

	describe("activated abilities", () => {
		it("parses tap: deal damage", () => {
			const result = parseOracleText(
				"{T}: Prodigal Pyromancer deals 1 damage to any target",
			);
			expect(result).toEqual([
				{ kind: "activated_tap_damage", amount: 1, target: "any_target" },
			]);
		});

		it("parses tap: gain life", () => {
			const result = parseOracleText("{T}: You gain 1 life");
			expect(result).toEqual([{ kind: "activated_tap_life_gain", amount: 1 }]);
		});
	});

	describe("static P/T modifiers", () => {
		it("parses other creatures you control anthem", () => {
			const result = parseOracleText("Other creatures you control get +1/+1");
			expect(result).toEqual([
				{
					kind: "static_pt_modifier",
					power: 1,
					toughness: 1,
					target: "other_creatures_you_control",
				},
			]);
		});

		it("parses enchanted creature buff", () => {
			const result = parseOracleText("Enchanted creature gets +2/+2");
			expect(result).toEqual([
				{
					kind: "static_pt_modifier",
					power: 2,
					toughness: 2,
					target: "enchanted_creature",
				},
			]);
		});
	});

	describe("unresolved", () => {
		it("emits unresolved for complex abilities", () => {
			const result = parseOracleText("Whenever a creature dies, draw a card.");
			expect(result).toEqual([
				{
					kind: "unresolved",
					oracleText: "Whenever a creature dies, draw a card.",
					reason: "no matching parser rule",
				},
			]);
		});

		it("handles mixed known and unknown abilities", () => {
			const result = parseOracleText(
				"Flying\nWhenever Consecrated Sphinx enters the battlefield, draw two cards.",
			);
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ kind: "keyword", keyword: "flying" });
			expect(result[1]).toMatchObject({ kind: "unresolved" });
		});
	});

	describe("empty input", () => {
		it("returns empty array for empty string", () => {
			expect(parseOracleText("")).toEqual([]);
		});

		it("returns empty array for whitespace", () => {
			expect(parseOracleText("   ")).toEqual([]);
		});
	});
});

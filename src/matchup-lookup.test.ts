// pattern: Functional Core
import { afterEach, describe, expect, it } from "vitest";
import {
	clearMatchupDbCache,
	getMatchupDbStats,
	lookupMatchup,
} from "./matchup-lookup.js";

// Inline test DB — no file dependency
const testDb = {
	matchups: {
		"black lotus|strip mine|thassa's oracle vs chalice of the void|leyline of anticipation|memnite":
			{ score: 0, sources: ["R1A"] },
		"force of will|memnite|misdirection vs myr servitor|myr servitor|sheltered valley":
			{ score: 6, sources: ["R1A"] },
		"black lotus|strip mine|thassa's oracle vs force of will|memnite|misdirection":
			{ score: 2, sources: ["R1A", "R5B"] },
	},
	totalMatchups: 3,
	totalRounds: 2,
	scrapedAt: "2026-03-01T00:00:00Z",
};

afterEach(() => clearMatchupDbCache());

describe("lookupMatchup", () => {
	it("finds an exact match — player1 wins", () => {
		const result = lookupMatchup(
			["Black Lotus", "Thassa's Oracle", "Strip Mine"],
			["Memnite", "Chalice of the Void", "Leyline of Anticipation"],
			testDb,
		);
		expect(result.found).toBe(true);
		if (result.found) {
			expect(result.outcome).toBe("player1_wins");
			expect(result.score).toBe(0);
		}
	});

	it("finds an exact match — player0 wins (reversed order)", () => {
		const result = lookupMatchup(
			["Force of Will", "Misdirection", "Memnite"],
			["Myr Servitor", "Sheltered Valley", "Myr Servitor"],
			testDb,
		);
		expect(result.found).toBe(true);
		if (result.found) {
			expect(result.outcome).toBe("player0_wins");
			expect(result.score).toBe(6);
		}
	});

	it("finds a draw (score=2)", () => {
		const result = lookupMatchup(
			["Strip Mine", "Black Lotus", "Thassa's Oracle"],
			["Force of Will", "Memnite", "Misdirection"],
			testDb,
		);
		expect(result.found).toBe(true);
		if (result.found) {
			expect(result.outcome).toBe("draw");
		}
	});

	it("swaps deck order correctly", () => {
		// Reverse the deck order — should invert score
		const result = lookupMatchup(
			["Memnite", "Chalice of the Void", "Leyline of Anticipation"],
			["Black Lotus", "Thassa's Oracle", "Strip Mine"],
			testDb,
		);
		expect(result.found).toBe(true);
		if (result.found) {
			expect(result.outcome).toBe("player0_wins");
			expect(result.score).toBe(6);
		}
	});

	it("returns miss for unknown deck pair", () => {
		const result = lookupMatchup(
			["Lightning Bolt", "Snapcaster Mage", "Delver of Secrets"],
			["Black Lotus", "Ancestral Recall", "Time Walk"],
			testDb,
		);
		expect(result.found).toBe(false);
	});

	it("is case-insensitive", () => {
		const result = lookupMatchup(
			["BLACK LOTUS", "thassa's oracle", "Strip Mine"],
			["memnite", "CHALICE OF THE VOID", "Leyline of Anticipation"],
			testDb,
		);
		expect(result.found).toBe(true);
	});
});

describe("getMatchupDbStats", () => {
	it("returns correct stats", () => {
		const stats = getMatchupDbStats(testDb);
		expect(stats.uniquePairs).toBe(3);
		expect(stats.totalMatchups).toBe(3);
		expect(stats.totalRounds).toBe(2);
	});
});

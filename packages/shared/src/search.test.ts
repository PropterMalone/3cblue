// pattern: Functional Core
import { describe, expect, it } from "vitest";
import type { Card } from "./card-types.js";
import { runRoundRobin, simulateMatchup } from "./search.js";

function creature(
	name: string,
	power: number,
	toughness: number,
	cmc: number,
	keywords: string[] = [],
): Card {
	return {
		name,
		manaCost: `{${cmc}}`,
		cmc,
		colors: [],
		types: ["creature"],
		supertypes: [],
		subtypes: [],
		oracleText: keywords.join(", "),
		power,
		toughness,
		abilities: keywords.map((k) => ({
			kind: "keyword" as const,
			keyword: k.replace(" ", "_") as never,
		})),
		scryfallId: `test-${name}`,
	};
}

describe("simulateMatchup", () => {
	it("bigger creature wins against smaller", () => {
		const big = [creature("Elephant", 5, 5, 3)];
		const small = [creature("Bear", 2, 2, 2)];

		const { result } = simulateMatchup(big, small);
		// 5/5 vs 2/2: elephant attacks, bear can block (trades 2 for 2 damage),
		// but 5/5 kills 2/2 and survives. Then elephant attacks unblocked.
		expect(result.outcome).toBe("player0_wins");
	});

	it("identical creatures stalemate (draw)", () => {
		const deck0 = [creature("Bear A", 2, 2, 2)];
		const deck1 = [creature("Bear B", 2, 2, 2)];

		const { result } = simulateMatchup(deck0, deck1);
		// Optimal play: neither attacks because attacking into an equal
		// creature is always a trade, leaving the non-attacker with a creature
		// and the attacker with none → loss. So both hold.
		expect(result.outcome).toBe("draw");
	});

	it("2/3 beats 2/2 first strike: FS loses every combat", () => {
		const fs = [creature("Striker", 2, 2, 2, ["first strike"])];
		const normal = [creature("Tough", 2, 3, 2)];

		const { result } = simulateMatchup(fs, normal);
		// FS 2/2 vs 2/3: FS deals 2 first strike (2/3 survives at 1 toughness),
		// then 2/3 deals 2 normal (FS dies). FS loses every fight.
		// P0 can never profitably attack or block. P1 attacks for 2/turn → P1 wins.
		expect(result.outcome).toBe("player1_wins");
	});

	it("flying creature wins against ground creature", () => {
		const flyer = [creature("Eagle", 3, 3, 3, ["flying"])];
		const ground = [creature("Bear", 2, 2, 2)];

		const { result } = simulateMatchup(flyer, ground);
		// Flying can't be blocked by ground creature → free damage
		expect(result.outcome).toBe("player0_wins");
	});

	it("reach blocks flying", () => {
		const flyer = [creature("Eagle", 2, 2, 2, ["flying"])];
		const reacher = [creature("Spider", 2, 2, 2, ["reach"])];

		const { result } = simulateMatchup(flyer, reacher);
		// Reach can block flying. Equal stats → trade → neither wants to attack.
		expect(result.outcome).toBe("draw");
	});

	it("defender cannot attack, other side wins", () => {
		const attacker = [creature("Bear", 2, 2, 2)];
		const wall = [creature("Wall", 0, 5, 2, ["defender"])];

		const { result } = simulateMatchup(attacker, wall);
		// Wall can't attack. Bear can't punch through 5 toughness (2 power < 5).
		// Bear doesn't die if it attacks and wall blocks (0 power wall).
		// So bear attacks freely, wall blocks but deals 0 damage. Bear deals 2 to wall
		// but wall has 5 toughness. Every turn: bear attacks, wall blocks, 2 damage to wall.
		// After 3 turns of attacks (6 damage), wall dies. Then bear attacks player.
		// Wait — damage doesn't persist between turns in MTG. Each turn damage resets.
		// So 2 damage per combat never kills a 5 toughness wall. Stalemate → draw.
		expect(result.outcome).toBe("draw");
	});

	it("unresolved abilities flag the matchup", () => {
		const complexCard: Card = {
			name: "Snapcaster Mage",
			manaCost: "{1}{U}",
			cmc: 2,
			colors: ["U"],
			types: ["creature"],
			supertypes: [],
			subtypes: ["Human", "Wizard"],
			oracleText:
				"Flash\nWhen Snapcaster Mage enters the battlefield, target instant or sorcery card in your graveyard gains flashback until end of turn.",
			power: 2,
			toughness: 1,
			abilities: [
				{ kind: "keyword", keyword: "flash" },
				{
					kind: "unresolved",
					oracleText:
						"When Snapcaster Mage enters the battlefield, target instant or sorcery card in your graveyard gains flashback until end of turn.",
					reason: "no matching parser rule",
				},
			],
			scryfallId: "snap",
		};

		const { result } = simulateMatchup(
			[complexCard],
			[creature("Bear", 2, 2, 2)],
		);
		expect(result.outcome).toBe("unresolved");
		if (result.outcome === "unresolved") {
			expect(result.reason).toContain("Snapcaster Mage");
		}
	});

	it("multiple creatures: 3 bears vs 1 elephant is a draw", () => {
		const bears = [
			creature("Bear 1", 2, 2, 2),
			creature("Bear 2", 2, 2, 2),
			creature("Bear 3", 2, 2, 2),
		];
		const elephant = [creature("Elephant", 4, 4, 4)];

		const { result } = simulateMatchup(bears, elephant);
		// 3 bears vs 4/4: If bears attack, elephant blocks 1 per turn (eating a bear).
		// After 3 turns only 6 damage dealt (4+2+0), not lethal. If elephant attacks,
		// bears multi-block and kill it. Neither side profits from attacking → stalemate.
		expect(result.outcome).toBe("draw");
	});
});

describe("runRoundRobin", () => {
	it("scores a simple 3-player tournament", () => {
		const decks = [
			[creature("Flyer", 3, 3, 3, ["flying"])],
			[creature("Bear", 2, 2, 2)],
			[creature("Wall", 0, 7, 2, ["defender"])],
		];

		const standings = runRoundRobin(decks);
		expect(standings.scores).toHaveLength(3);
		// Flyer should score highest (beats bear, draws with wall)
		// Total points should be consistent
		const totalPoints = standings.scores.reduce(
			(a, b) => (a ?? 0) + (b ?? 0),
			0,
		);
		expect(totalPoints).toBeGreaterThan(0);
	});

	it("each pair plays twice (once as each player)", () => {
		const decks = [[creature("A", 2, 2, 2)], [creature("B", 3, 3, 3)]];

		const standings = runRoundRobin(decks);
		expect(standings.matchups).toHaveLength(2); // A vs B as P0, B vs A as P0
	});
});

// pattern: Functional Core
import { describe, expect, it } from "vitest";
import type { Card } from "./card-types.js";
import {
	enumerateBlockAssignments,
	hasFirstStrikers,
	resolveCombatDamage,
} from "./combat.js";
import type { Permanent } from "./game-state.js";

function makeCard(overrides: Partial<Card> = {}): Card {
	return {
		name: "Bear",
		manaCost: "{1}{G}",
		cmc: 2,
		colors: ["G"],
		types: ["creature"],
		supertypes: [],
		subtypes: [],
		oracleText: "",
		power: 2,
		toughness: 2,
		abilities: [],
		scryfallId: "test",
		...overrides,
	};
}

function makePerm(
	id: number,
	overrides: Partial<Card> = {},
	permOverrides: Partial<Permanent> = {},
): Permanent {
	return {
		card: makeCard(overrides),
		tapped: false,
		summoningSick: false,
		damageMarked: 0,
		isToken: false,
		id,
		...permOverrides,
	};
}

function makeKeywordCard(
	name: string,
	power: number,
	toughness: number,
	...keywords: string[]
): Partial<Card> {
	const abilities = keywords.map((k) => ({
		kind: "keyword" as const,
		keyword: k.replace(" ", "_") as Card["abilities"][number] extends {
			keyword: infer K;
		}
			? K
			: never,
	}));
	return {
		name,
		power,
		toughness,
		oracleText: keywords.join(", "),
		abilities,
	};
}

describe("resolveCombatDamage", () => {
	describe("unblocked attackers", () => {
		it("deals damage to defending player", () => {
			const attacker = makePerm(1, { power: 3, toughness: 3 });
			const blockerMap = new Map<number, Permanent[]>();

			const result = resolveCombatDamage([attacker], blockerMap, 0, false);
			expect(result.lifeDelta).toEqual([0, -3]);
			expect(result.destroyed).toEqual([]);
		});

		it("multiple unblocked attackers deal cumulative damage", () => {
			const a1 = makePerm(1, { power: 2 });
			const a2 = makePerm(2, { power: 3 });
			const result = resolveCombatDamage([a1, a2], new Map(), 0, false);
			expect(result.lifeDelta).toEqual([0, -5]);
		});

		it("player 1 attacking deals damage to player 0", () => {
			const attacker = makePerm(1, { power: 4 });
			const result = resolveCombatDamage([attacker], new Map(), 1, false);
			expect(result.lifeDelta).toEqual([-4, 0]);
		});
	});

	describe("blocked attackers", () => {
		it("attacker and blocker trade when equal power/toughness", () => {
			const attacker = makePerm(1, { power: 2, toughness: 2 });
			const blocker = makePerm(2, { power: 2, toughness: 2 });
			const blockerMap = new Map([[1, [blocker]]]);

			const result = resolveCombatDamage([attacker], blockerMap, 0, false);
			expect(result.destroyed).toContain(1);
			expect(result.destroyed).toContain(2);
			expect(result.lifeDelta).toEqual([0, 0]);
		});

		it("bigger creature survives combat", () => {
			const attacker = makePerm(1, { power: 3, toughness: 3 });
			const blocker = makePerm(2, { power: 2, toughness: 2 });
			const blockerMap = new Map([[1, [blocker]]]);

			const result = resolveCombatDamage([attacker], blockerMap, 0, false);
			expect(result.destroyed).toContain(2); // blocker dies
			expect(result.destroyed).not.toContain(1); // attacker lives
		});

		it("multiple blockers can kill a big attacker", () => {
			const attacker = makePerm(1, { power: 4, toughness: 4 });
			const b1 = makePerm(2, { power: 2, toughness: 2 });
			const b2 = makePerm(3, { power: 3, toughness: 3 });
			const blockerMap = new Map([[1, [b1, b2]]]);

			const result = resolveCombatDamage([attacker], blockerMap, 0, false);
			// Attacker takes 2+3=5 damage, has 4 toughness → dies
			expect(result.destroyed).toContain(1);
			// Attacker assigns 4 damage: 2 to b1 (lethal), 2 to b2 (not lethal for 3 toughness)
			expect(result.destroyed).toContain(2);
			expect(result.destroyed).not.toContain(3);
		});
	});

	describe("keyword interactions", () => {
		it("lifelink on unblocked attacker gains life", () => {
			const attacker = makePerm(
				1,
				makeKeywordCard("Lifelinker", 3, 3, "lifelink"),
			);
			const result = resolveCombatDamage([attacker], new Map(), 0, false);
			expect(result.lifeDelta).toEqual([3, -3]);
		});

		it("lifelink on blocked attacker gains life for damage dealt to creatures", () => {
			const attacker = makePerm(
				1,
				makeKeywordCard("Lifelinker", 3, 3, "lifelink"),
			);
			const blocker = makePerm(2, { power: 2, toughness: 2 });
			const blockerMap = new Map([[1, [blocker]]]);

			const result = resolveCombatDamage([attacker], blockerMap, 0, false);
			// Attacker deals 2 to blocker (lethal), 1 remaining but no trample
			// Lifelink gains life for damage dealt to creatures (2, since only 2 needed for lethal)
			expect(result.lifeDelta[0]).toBe(3); // gains 3 (full power dealt as damage to blocker, capped at power)
		});

		it("trample pushes excess damage through", () => {
			const attacker = makePerm(
				1,
				makeKeywordCard("Trampler", 5, 5, "trample"),
			);
			const blocker = makePerm(2, { power: 1, toughness: 2 });
			const blockerMap = new Map([[1, [blocker]]]);

			const result = resolveCombatDamage([attacker], blockerMap, 0, false);
			// 5 power, 2 toughness blocker: assign 2 to blocker, 3 tramples through
			expect(result.lifeDelta).toEqual([0, -3]);
			expect(result.destroyed).toContain(2);
		});

		it("deathtouch kills with 1 damage", () => {
			const attacker = makePerm(
				1,
				makeKeywordCard("Deathtoucher", 1, 1, "deathtouch"),
			);
			const blocker = makePerm(2, { power: 5, toughness: 5 });
			const blockerMap = new Map([[1, [blocker]]]);

			const result = resolveCombatDamage([attacker], blockerMap, 0, false);
			expect(result.destroyed).toContain(2); // 5/5 dies to 1 deathtouch damage
			expect(result.destroyed).toContain(1); // 1/1 dies to 5 damage
		});

		it("deathtouch + trample: assign 1 to each blocker, rest tramples", () => {
			const attacker = makePerm(
				1,
				makeKeywordCard("DT Trampler", 5, 5, "deathtouch", "trample"),
			);
			const b1 = makePerm(2, { power: 3, toughness: 3 });
			const b2 = makePerm(3, { power: 3, toughness: 3 });
			const blockerMap = new Map([[1, [b1, b2]]]);

			const result = resolveCombatDamage([attacker], blockerMap, 0, false);
			// 1 to b1 (lethal with DT), 1 to b2 (lethal with DT), 3 tramples
			expect(result.destroyed).toContain(2);
			expect(result.destroyed).toContain(3);
			expect(result.lifeDelta).toEqual([0, -3]);
		});

		it("indestructible survives lethal damage", () => {
			const attacker = makePerm(
				1,
				makeKeywordCard("Indestructo", 5, 5, "indestructible"),
			);
			const blocker = makePerm(2, { power: 10, toughness: 10 });
			const blockerMap = new Map([[1, [blocker]]]);

			const result = resolveCombatDamage([attacker], blockerMap, 0, false);
			expect(result.destroyed).not.toContain(1); // indestructible survives
			expect(result.destroyed).not.toContain(2); // 10 toughness, only 5 damage
		});

		it("first strike damage step only resolves first strikers", () => {
			const firstStriker = makePerm(
				1,
				makeKeywordCard("FS", 3, 2, "first strike"),
			);
			const normalAttacker = makePerm(2, { power: 2, toughness: 2 });

			const result = resolveCombatDamage(
				[firstStriker, normalAttacker],
				new Map(),
				0,
				true, // first strike step
			);
			// Only first striker deals damage in this step
			expect(result.lifeDelta).toEqual([0, -3]);
		});

		it("regular damage step skips first strikers", () => {
			const firstStriker = makePerm(
				1,
				makeKeywordCard("FS", 3, 2, "first strike"),
			);
			const normalAttacker = makePerm(2, { power: 2, toughness: 2 });

			const result = resolveCombatDamage(
				[firstStriker, normalAttacker],
				new Map(),
				0,
				false, // regular step
			);
			// Only normal attacker deals damage
			expect(result.lifeDelta).toEqual([0, -2]);
		});

		it("double strike deals damage in both steps", () => {
			const doubleStriker = makePerm(
				1,
				makeKeywordCard("DS", 3, 3, "double strike"),
			);

			const firstStep = resolveCombatDamage(
				[doubleStriker],
				new Map(),
				0,
				true,
			);
			expect(firstStep.lifeDelta).toEqual([0, -3]);

			const secondStep = resolveCombatDamage(
				[doubleStriker],
				new Map(),
				0,
				false,
			);
			expect(secondStep.lifeDelta).toEqual([0, -3]);
		});

		it("first strike blocker can kill attacker before regular damage", () => {
			const attacker = makePerm(1, { power: 3, toughness: 2 });
			const blocker = makePerm(
				2,
				makeKeywordCard("FS Blocker", 2, 2, "first strike"),
			);
			const blockerMap = new Map([[1, [blocker]]]);

			// First strike step: blocker deals 2 damage to attacker (lethal)
			const firstStep = resolveCombatDamage([attacker], blockerMap, 0, true);
			expect(firstStep.destroyed).toContain(1); // attacker dies in FS step
			expect(firstStep.destroyed).not.toContain(2); // blocker takes no damage yet
		});
	});

	describe("zero power", () => {
		it("zero power creatures deal no damage", () => {
			const attacker = makePerm(1, { power: 0, toughness: 4 });
			const result = resolveCombatDamage([attacker], new Map(), 0, false);
			expect(result.lifeDelta).toEqual([0, 0]);
		});
	});
});

describe("enumerateBlockAssignments", () => {
	it("returns single empty assignment when no attackers", () => {
		const result = enumerateBlockAssignments([], []);
		expect(result).toHaveLength(1);
	});

	it("returns two options for one attacker and one blocker: block or don't", () => {
		const attacker = makePerm(1);
		const blocker = makePerm(2);
		const result = enumerateBlockAssignments([attacker], [blocker]);
		expect(result).toHaveLength(2);
	});

	it("flying attacker can only be blocked by flying/reach", () => {
		const flyer = makePerm(1, makeKeywordCard("Flyer", 2, 2, "flying"));
		const groundBlocker = makePerm(2, { name: "Ground" });
		const flyingBlocker = makePerm(
			3,
			makeKeywordCard("Flying Blocker", 2, 2, "flying"),
		);
		const reachBlocker = makePerm(
			4,
			makeKeywordCard("Reach Blocker", 2, 2, "reach"),
		);

		// Ground blocker alone: can't block flyer → only 1 option (no block)
		const groundOnly = enumerateBlockAssignments([flyer], [groundBlocker]);
		expect(groundOnly).toHaveLength(1);

		// Flying blocker: 2 options (block or don't)
		const flyingOnly = enumerateBlockAssignments([flyer], [flyingBlocker]);
		expect(flyingOnly).toHaveLength(2);

		// Reach blocker: 2 options
		const reachOnly = enumerateBlockAssignments([flyer], [reachBlocker]);
		expect(reachOnly).toHaveLength(2);
	});

	it("menace requires 2+ blockers", () => {
		const menaceCreature = makePerm(
			1,
			makeKeywordCard("Menace", 3, 3, "menace"),
		);
		const b1 = makePerm(2);
		const b2 = makePerm(3);

		const result = enumerateBlockAssignments([menaceCreature], [b1, b2]);
		// Options: no block, both block (menace needs 2+)
		// Cannot have just one blocker on a menace creature
		for (const assignment of result) {
			const blockers = assignment.get(1) ?? [];
			expect(blockers.length !== 1).toBe(true);
		}
	});

	it("tapped creatures cannot block", () => {
		const attacker = makePerm(1);
		const tappedBlocker = makePerm(2, {}, { tapped: true });
		const result = enumerateBlockAssignments([attacker], [tappedBlocker]);
		expect(result).toHaveLength(1); // only option: no block
	});
});

describe("hasFirstStrikers", () => {
	it("returns false with no first strikers", () => {
		const attacker = makePerm(1);
		expect(hasFirstStrikers([attacker], new Map())).toBe(false);
	});

	it("detects first strike on attackers", () => {
		const fs = makePerm(1, makeKeywordCard("FS", 2, 2, "first strike"));
		expect(hasFirstStrikers([fs], new Map())).toBe(true);
	});

	it("detects double strike on blockers", () => {
		const attacker = makePerm(1);
		const ds = makePerm(2, makeKeywordCard("DS", 2, 2, "double strike"));
		const blockerMap = new Map([[1, [ds]]]);
		expect(hasFirstStrikers([attacker], blockerMap)).toBe(true);
	});
});

// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { checkBan, checkDeckBans } from "./ban-list.js";
import type { Card } from "./card-types.js";
import type { ScryfallCard } from "./scryfall-types.js";

function makeCard(overrides: Partial<Card> = {}): Card {
	return {
		name: "Lightning Bolt",
		manaCost: "{R}",
		cmc: 1,
		colors: ["R"],
		types: ["instant"],
		supertypes: [],
		subtypes: [],
		oracleText: "Lightning Bolt deals 3 damage to any target.",
		abilities: [],
		scryfallId: "test-id",
		...overrides,
	};
}

describe("checkBan", () => {
	it("allows normal cards", () => {
		const result = checkBan(makeCard());
		expect(result.banned).toBe(false);
	});

	it("bans Shahrazad by name", () => {
		const result = checkBan(makeCard({ name: "Shahrazad" }));
		expect(result.banned).toBe(true);
		expect(result.reason).toContain("Shahrazad");
	});

	it("bans ante cards by name", () => {
		const result = checkBan(makeCard({ name: "Contract from Below" }));
		expect(result.banned).toBe(true);
	});

	it("bans un-set cards", () => {
		const result = checkBan(makeCard({ name: "Ach! Hans, Run!" }), {
			set_type: "funny",
		} as ScryfallCard);
		expect(result.banned).toBe(true);
		expect(result.reason).toContain("un-set");
	});

	it("bans wish effects", () => {
		const result = checkBan(
			makeCard({
				name: "Burning Wish",
				oracleText:
					"You may reveal a sorcery card you own from outside the game and put it into your hand.",
			}),
		);
		expect(result.banned).toBe(true);
		expect(result.reason).toContain("outside the game");
	});

	it("bans sideboard references", () => {
		const result = checkBan(
			makeCard({
				name: "Mastermind's Acquisition",
				oracleText:
					"Choose one —\n• Search your library for a card, put it into your hand, then shuffle.\n• Put a card you own from your sideboard into your hand.",
			}),
		);
		expect(result.banned).toBe(true);
		expect(result.reason).toContain("sideboard");
	});

	it("bans pure lands", () => {
		const result = checkBan(
			makeCard({
				name: "Island",
				types: ["land"],
				oracleText: "({T}: Add {U}.)",
			}),
		);
		expect(result.banned).toBe(true);
		expect(result.reason).toContain("lands have no effect");
	});

	it("allows creature lands (not pure land type)", () => {
		const result = checkBan(
			makeCard({
				name: "Dryad Arbor",
				types: ["land", "creature"],
				oracleText: "",
				power: 1,
				toughness: 1,
			}),
		);
		expect(result.banned).toBe(false);
	});
});

describe("checkDeckBans", () => {
	it("checks all cards in a deck", () => {
		const cards = [
			makeCard({ name: "Lightning Bolt" }),
			makeCard({ name: "Shahrazad" }),
			makeCard({ name: "Grizzly Bears" }),
		];
		const results = checkDeckBans(cards);
		expect(results[0]?.banned).toBe(false);
		expect(results[1]?.banned).toBe(true);
		expect(results[2]?.banned).toBe(false);
	});
});

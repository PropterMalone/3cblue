// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { scryfallToCard } from "./scryfall-to-card.js";
import type { ScryfallCard } from "./scryfall-types.js";

function makeScryfallCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
	return {
		id: "test-id",
		name: "Test Creature",
		mana_cost: "{2}{R}",
		cmc: 3,
		colors: ["R"],
		type_line: "Creature — Human Warrior",
		oracle_text: "Haste",
		power: "3",
		toughness: "2",
		image_uris: { normal: "https://example.com/card.jpg" },
		...overrides,
	};
}

describe("scryfallToCard", () => {
	it("converts a basic creature", () => {
		const card = scryfallToCard(makeScryfallCard());
		expect(card.name).toBe("Test Creature");
		expect(card.manaCost).toBe("{2}{R}");
		expect(card.cmc).toBe(3);
		expect(card.colors).toEqual(["R"]);
		expect(card.types).toEqual(["creature"]);
		expect(card.supertypes).toEqual([]);
		expect(card.subtypes).toEqual(["Human", "Warrior"]);
		expect(card.power).toBe(3);
		expect(card.toughness).toBe(2);
		expect(card.abilities).toEqual([{ kind: "keyword", keyword: "haste" }]);
		expect(card.scryfallId).toBe("test-id");
		expect(card.imageUri).toBe("https://example.com/card.jpg");
	});

	it("parses a legendary creature type line", () => {
		const card = scryfallToCard(
			makeScryfallCard({ type_line: "Legendary Creature — Angel" }),
		);
		expect(card.types).toEqual(["creature"]);
		expect(card.supertypes).toEqual(["legendary"]);
		expect(card.subtypes).toEqual(["Angel"]);
	});

	it("parses an artifact creature", () => {
		const card = scryfallToCard(
			makeScryfallCard({ type_line: "Artifact Creature — Golem" }),
		);
		expect(card.types).toEqual(["artifact", "creature"]);
		expect(card.subtypes).toEqual(["Golem"]);
	});

	it("handles enchantment with no subtypes", () => {
		const card = scryfallToCard(
			makeScryfallCard({
				type_line: "Enchantment",
				oracle_text: "Other creatures you control get +1/+1",
				power: undefined,
				toughness: undefined,
			}),
		);
		expect(card.types).toEqual(["enchantment"]);
		expect(card.subtypes).toEqual([]);
		expect(card.power).toBeUndefined();
	});

	it("handles variable power/toughness as 0", () => {
		const card = scryfallToCard(
			makeScryfallCard({ power: "*", toughness: "*" }),
		);
		expect(card.power).toBe(0);
		expect(card.toughness).toBe(0);
	});

	it("handles planeswalkers", () => {
		const card = scryfallToCard(
			makeScryfallCard({
				type_line: "Legendary Planeswalker — Jace",
				oracle_text:
					"+1: Draw a card.\n-1: Return target creature to its owner's hand.",
				power: undefined,
				toughness: undefined,
				loyalty: "3",
			}),
		);
		expect(card.types).toEqual(["planeswalker"]);
		expect(card.loyalty).toBe(3);
		// Planeswalker abilities should be unresolved for now
		expect(card.abilities.every((a) => a.kind === "unresolved")).toBe(true);
	});

	it("uses front face for double-faced cards", () => {
		const card = scryfallToCard({
			id: "dfc-id",
			name: "Delver of Secrets // Insectile Aberration",
			cmc: 1,
			type_line: "Creature — Human Wizard // Creature — Human Insect",
			card_faces: [
				{
					name: "Delver of Secrets",
					mana_cost: "{U}",
					type_line: "Creature — Human Wizard",
					oracle_text:
						"At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform Delver of Secrets.",
					power: "1",
					toughness: "1",
					colors: ["U"],
				},
				{
					name: "Insectile Aberration",
					mana_cost: "",
					type_line: "Creature — Human Insect",
					oracle_text: "Flying",
					power: "3",
					toughness: "2",
					colors: ["U"],
				},
			],
		});
		// Should use front face data
		expect(card.name).toBe("Delver of Secrets // Insectile Aberration");
		expect(card.power).toBe(1);
		expect(card.toughness).toBe(1);
	});

	it("handles missing oracle text", () => {
		const card = scryfallToCard(makeScryfallCard({ oracle_text: undefined }));
		expect(card.abilities).toEqual([]);
	});
});

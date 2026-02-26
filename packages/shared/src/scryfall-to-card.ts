// pattern: Functional Core

// Converts Scryfall API response data into our internal Card type.
// Pure function — no I/O.

import type { Card, CardType, Color } from "./card-types.js";
import { parseOracleText } from "./oracle-parser.js";
import type { ScryfallCard, ScryfallCardFace } from "./scryfall-types.js";

const TYPE_KEYWORDS: CardType[] = [
	"creature",
	"instant",
	"sorcery",
	"enchantment",
	"artifact",
	"planeswalker",
	"land",
	"battle",
];

const SUPERTYPES = ["legendary", "basic", "snow", "world"];

export function scryfallToCard(raw: ScryfallCard): Card {
	// For double-faced cards, use the front face
	const face = raw.card_faces?.[0];
	const oracleText = raw.oracle_text ?? face?.oracle_text ?? "";
	const typeLine = raw.type_line ?? face?.type_line ?? "";
	const manaCost = raw.mana_cost ?? face?.mana_cost ?? "";
	const power = raw.power ?? face?.power;
	const toughness = raw.toughness ?? face?.toughness;
	const loyalty = raw.loyalty ?? face?.loyalty;
	const colors = (raw.colors ?? face?.colors ?? []) as Color[];

	const { types, supertypes, subtypes } = parseTypeLine(typeLine);

	return {
		name: raw.name,
		manaCost,
		cmc: raw.cmc,
		colors,
		types,
		supertypes,
		subtypes,
		oracleText,
		power: power !== undefined ? parseNumericStat(power) : undefined,
		toughness:
			toughness !== undefined ? parseNumericStat(toughness) : undefined,
		loyalty: loyalty !== undefined ? Number.parseInt(loyalty, 10) : undefined,
		abilities: parseOracleText(oracleText),
		scryfallId: raw.id,
		imageUri: raw.image_uris?.normal ?? face?.image_uris?.normal,
	};
}

function parseTypeLine(typeLine: string): {
	types: CardType[];
	supertypes: string[];
	subtypes: string[];
} {
	const [mainPart, subtypePart] = typeLine.split("—").map((s) => s.trim());
	const mainWords = (mainPart ?? "").toLowerCase().split(/\s+/);

	const types: CardType[] = [];
	const supertypes: string[] = [];

	for (const word of mainWords) {
		if (TYPE_KEYWORDS.includes(word as CardType)) {
			types.push(word as CardType);
		} else if (SUPERTYPES.includes(word)) {
			supertypes.push(word);
		}
	}

	const subtypes = subtypePart ? subtypePart.split(/\s+/).filter(Boolean) : [];

	return { types, supertypes, subtypes };
}

/** Parse power/toughness strings like "3", "*", "1+*" into numbers.
 *  Variable stats (*, X) get 0 — the engine will need to handle these specially. */
function parseNumericStat(stat: string): number {
	const n = Number.parseInt(stat, 10);
	return Number.isNaN(n) ? 0 : n;
}

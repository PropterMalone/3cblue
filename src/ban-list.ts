// pattern: Functional Core

// Structural ban list for 3CB. These cards break the format itself,
// not cards that are merely powerful. Metagame bans are a separate concern
// (managed per-league or per-round by the judge).

import type { Card } from "./card-types.js";
import type { ScryfallCard } from "./scryfall-types.js";

export interface BanCheckResult {
	readonly banned: boolean;
	readonly reason?: string;
}

/** Set types that are structurally incompatible with 3CB */
const BANNED_SET_TYPES = new Set(["funny"]);

/** Cards banned by name — structural format breaks */
const BANNED_NAMES = new Set([
	// Subgame cards
	"Shahrazad",
	// Ante cards
	"Contract from Below",
	"Darkpact",
	"Demonic Attorney",
	"Jeweled Bird",
	"Rebirth",
	"Tempest Efreet",
	"Timmerian Fiends",
	"Bronze Tablet",
	"Amulet of Quoz",
]);

/** Oracle text patterns that indicate a structural format break */
const BANNED_ORACLE_PATTERNS = [
	{
		pattern: /from outside the game/i,
		reason: "references cards outside the game (wish effects)",
	},
	{
		pattern: /your sideboard/i,
		reason: "references sideboard (no sideboard in 3CB)",
	},
];

/** Check if a card is structurally banned from 3CB */
export function checkBan(
	card: Card,
	scryfallData?: ScryfallCard,
): BanCheckResult {
	// Name ban
	if (BANNED_NAMES.has(card.name)) {
		return {
			banned: true,
			reason: `${card.name} is banned (structural format break)`,
		};
	}

	// Un-set / joke set ban
	if (scryfallData?.set_type && BANNED_SET_TYPES.has(scryfallData.set_type)) {
		return {
			banned: true,
			reason: `${card.name} is from an un-set (${scryfallData.set_type})`,
		};
	}

	// Oracle text pattern bans
	for (const { pattern, reason } of BANNED_ORACLE_PATTERNS) {
		if (pattern.test(card.oracleText)) {
			return { banned: true, reason: `${card.name}: ${reason}` };
		}
	}

	return { banned: false };
}

/** Check multiple cards, return all ban results */
export function checkDeckBans(
	cards: Card[],
	scryfallData?: ScryfallCard[],
): BanCheckResult[] {
	return cards.map((card, i) => checkBan(card, scryfallData?.[i]));
}

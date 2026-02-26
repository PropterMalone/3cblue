// pattern: Functional Core

// Structured representation of an MTG card for 3CB simulation.
// Parsed from Scryfall API data. Oracle text gets decomposed into
// abilities the engine understands, with unparseable text preserved
// as Unresolved for human judging.

export type Color = "W" | "U" | "B" | "R" | "G";

export type CardType =
	| "creature"
	| "instant"
	| "sorcery"
	| "enchantment"
	| "artifact"
	| "planeswalker"
	| "land"
	| "battle";

export type EvergreenKeyword =
	| "flying"
	| "first_strike"
	| "double_strike"
	| "trample"
	| "deathtouch"
	| "lifelink"
	| "reach"
	| "menace"
	| "defender"
	| "vigilance"
	| "indestructible"
	| "haste"
	| "hexproof"
	| "ward"
	| "flash"
	| "protection";

export type AbilityKind =
	| "keyword"
	| "static_pt_modifier"
	| "etb_damage"
	| "etb_life_gain"
	| "etb_create_token"
	| "activated_tap_damage"
	| "activated_tap_life_gain"
	| "unresolved";

export interface KeywordAbility {
	readonly kind: "keyword";
	readonly keyword: EvergreenKeyword;
	// For protection: "from red", "from creatures", etc.
	readonly qualifier?: string;
	// For ward: the cost (e.g., "{2}")
	readonly cost?: string;
}

export interface StaticPtModifier {
	readonly kind: "static_pt_modifier";
	readonly power: number;
	readonly toughness: number;
	// What it applies to: "self" for auras/equipment, "other_creatures_you_control" for anthems
	readonly target: string;
	readonly condition?: string;
}

export interface EtbDamage {
	readonly kind: "etb_damage";
	readonly amount: number;
	readonly target: "any_target" | "creature" | "player" | "opponent";
}

export interface EtbLifeGain {
	readonly kind: "etb_life_gain";
	readonly amount: number;
}

export interface EtbCreateToken {
	readonly kind: "etb_create_token";
	readonly count: number;
	readonly power: number;
	readonly toughness: number;
	readonly keywords: EvergreenKeyword[];
}

export interface ActivatedTapDamage {
	readonly kind: "activated_tap_damage";
	readonly amount: number;
	readonly target: "any_target" | "creature" | "player" | "opponent";
}

export interface ActivatedTapLifeGain {
	readonly kind: "activated_tap_life_gain";
	readonly amount: number;
}

export interface UnresolvedAbility {
	readonly kind: "unresolved";
	readonly oracleText: string;
	// Why the parser couldn't handle it
	readonly reason: string;
}

export type Ability =
	| KeywordAbility
	| StaticPtModifier
	| EtbDamage
	| EtbLifeGain
	| EtbCreateToken
	| ActivatedTapDamage
	| ActivatedTapLifeGain
	| UnresolvedAbility;

export interface Card {
	readonly name: string;
	readonly manaCost: string;
	readonly cmc: number;
	readonly colors: Color[];
	readonly types: CardType[];
	// Supertypes like "legendary", "basic"
	readonly supertypes: string[];
	// Subtypes like "Human", "Warrior", "Aura", "Equipment"
	readonly subtypes: string[];
	readonly oracleText: string;
	// Only for creatures (or cards that become creatures)
	readonly power?: number;
	readonly toughness?: number;
	// Only for planeswalkers
	readonly loyalty?: number;
	readonly abilities: Ability[];
	readonly scryfallId: string;
	// URI for card image
	readonly imageUri?: string;
}

/** True if the card has any abilities the engine can't simulate */
export function hasUnresolvedAbilities(card: Card): boolean {
	return card.abilities.some((a) => a.kind === "unresolved");
}

/** Get all keywords on a card */
export function getKeywords(card: Card): EvergreenKeyword[] {
	return card.abilities
		.filter((a): a is KeywordAbility => a.kind === "keyword")
		.map((a) => a.keyword);
}

/** True if the card is a creature (by type line) */
export function isCreature(card: Card): boolean {
	return card.types.includes("creature");
}

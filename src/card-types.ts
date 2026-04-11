// pattern: Functional Core

// Structured representation of an MTG card for 3CB evaluation.
// Parsed from Scryfall API data. Oracle text gets decomposed into
// abilities the parser understands, with unparseable text preserved
// as Unresolved for human/LLM judging.

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
	readonly qualifier?: string;
	readonly cost?: string;
}

export interface StaticPtModifier {
	readonly kind: "static_pt_modifier";
	readonly power: number;
	readonly toughness: number;
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
	readonly supertypes: string[];
	readonly subtypes: string[];
	readonly oracleText: string;
	readonly power?: number;
	readonly toughness?: number;
	readonly loyalty?: number;
	readonly abilities: Ability[];
	readonly scryfallId: string;
	readonly imageUri?: string;
}

/** True if the card has any abilities the parser can't handle */
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

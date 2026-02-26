// pattern: Functional Core

// Immutable game state for the minimax search tree.
// Every state transition returns a new state — never mutates.

import type { Card, EvergreenKeyword } from "./card-types.js";
import { getKeywords } from "./card-types.js";

export type PlayerId = 0 | 1;

export interface Permanent {
	readonly card: Card;
	readonly tapped: boolean;
	readonly summoningSick: boolean;
	// Damage marked this turn (clears at end of turn)
	readonly damageMarked: number;
	readonly isToken: boolean;
	// Unique ID for tracking across state transitions
	readonly id: number;
}

export interface PlayerState {
	readonly life: number;
	readonly hand: readonly Card[];
	readonly battlefield: readonly Permanent[];
	readonly graveyard: readonly Card[];
}

export type Phase =
	| "main_precombat"
	| "declare_attackers"
	| "declare_blockers"
	| "first_strike_damage"
	| "combat_damage"
	| "main_postcombat"
	| "cleanup";

export interface CombatState {
	readonly attackers: readonly number[]; // permanent IDs
	readonly blockers: ReadonlyMap<number, readonly number[]>; // attacker ID → blocker IDs
}

export interface GameState {
	readonly activePlayer: PlayerId;
	readonly players: readonly [PlayerState, PlayerState];
	readonly turn: number;
	readonly phase: Phase;
	readonly combat: CombatState | null;
	// For stalemate detection — hash of board positions seen
	readonly stateHistory: ReadonlySet<string>;
	// Next permanent ID to assign
	readonly nextPermanentId: number;
}

let nextId = 0;

export function createInitialState(
	deck0: readonly Card[],
	deck1: readonly Card[],
): GameState {
	nextId = 0;
	return {
		activePlayer: 0,
		players: [
			{ life: 20, hand: deck0, battlefield: [], graveyard: [] },
			{ life: 20, hand: deck1, battlefield: [], graveyard: [] },
		],
		turn: 1,
		phase: "main_precombat",
		combat: null,
		stateHistory: new Set(),
		nextPermanentId: 0,
	};
}

export function opponent(player: PlayerId): PlayerId {
	return player === 0 ? 1 : 0;
}

/** Get a player's state */
export function getPlayer(state: GameState, player: PlayerId): PlayerState {
	return state.players[player];
}

/** Get the active player's state */
export function getActivePlayer(state: GameState): PlayerState {
	return state.players[state.activePlayer];
}

/** Get the defending player's state */
export function getDefendingPlayer(state: GameState): PlayerState {
	return state.players[opponent(state.activePlayer)];
}

/** Create a permanent from a card */
export function createPermanent(
	card: Card,
	id: number,
	summoningSick = true,
): Permanent {
	return {
		card,
		tapped: false,
		summoningSick,
		damageMarked: 0,
		isToken: false,
		id,
	};
}

/** Check if a permanent has a keyword */
export function hasKeyword(
	perm: Permanent,
	keyword: EvergreenKeyword,
): boolean {
	return getKeywords(perm.card).includes(keyword);
}

/** Check if a permanent can attack */
export function canAttack(perm: Permanent): boolean {
	if (perm.tapped) return false;
	if (hasKeyword(perm, "defender")) return false;
	if (
		perm.summoningSick &&
		!hasKeyword(perm, "haste") &&
		!hasKeyword(perm, "vigilance")
	) {
		// Summoning sick creatures can't attack unless they have haste
		// (vigilance doesn't help with summoning sickness — only prevents tapping)
		if (!hasKeyword(perm, "haste")) return false;
	}
	return perm.card.types.includes("creature");
}

/** Check if a permanent can block a specific attacker */
export function canBlock(blocker: Permanent, attacker: Permanent): boolean {
	if (blocker.tapped) return false;
	if (!blocker.card.types.includes("creature")) return false;

	// Flying: can only be blocked by creatures with flying or reach
	if (hasKeyword(attacker, "flying")) {
		if (!hasKeyword(blocker, "flying") && !hasKeyword(blocker, "reach")) {
			return false;
		}
	}

	return true;
}

/** Get effective power of a permanent (base power for now — modifiers come later) */
export function getEffectivePower(perm: Permanent): number {
	return perm.card.power ?? 0;
}

/** Get effective toughness of a permanent */
export function getEffectiveToughness(perm: Permanent): number {
	return perm.card.toughness ?? 0;
}

/** Check if a permanent is dead (damage >= toughness, or deathtouch damage > 0) */
export function isLethalDamage(
	perm: Permanent,
	damageAmount: number,
	fromDeathtouch: boolean,
): boolean {
	if (hasKeyword(perm, "indestructible")) return false;
	if (fromDeathtouch && damageAmount > 0) return true;
	return damageAmount >= getEffectiveToughness(perm);
}

/** Generate a hash string for stalemate detection.
 *  Captures: life totals, board state (cards + tapped/sick), hands, active player */
export function hashState(state: GameState): string {
	const parts: string[] = [`t:${state.activePlayer}`, `p:${state.phase}`];
	for (let i = 0; i < 2; i++) {
		const p = state.players[i];
		if (!p) continue;
		parts.push(`l${i}:${p.life}`);
		const boardParts = p.battlefield
			.map(
				(perm) =>
					`${perm.card.name}:${perm.tapped ? "T" : "U"}:${perm.summoningSick ? "S" : "R"}`,
			)
			.sort()
			.join(",");
		parts.push(`b${i}:${boardParts}`);
		const handParts = p.hand
			.map((c) => c.name)
			.sort()
			.join(",");
		parts.push(`h${i}:${handParts}`);
	}
	return parts.join("|");
}

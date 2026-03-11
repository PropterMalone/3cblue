// pattern: Functional Core

// Minimax game tree search for 3CB.
// Finds optimal play for both sides. Objective: maximize tournament points
// (3 for win, 1 for draw, 0 for loss).
//
// Terminal states: one player at 0 life (win/loss), or stalemate (draw).
// Stalemate = repeated game state (neither player can improve their position).
//
// Internally uses +1 (P0 wins), 0 (draw), -1 (P1 wins).
// P0 maximizes, P1 minimizes.

import type { Card } from "./card-types.js";
import { hasUnresolvedAbilities } from "./card-types.js";
import {
	type Action,
	applyAction,
	checkAndRecordStalemate,
	checkGameOver,
	enumerateLegalActions,
} from "./game-actions.js";
import type { GameState } from "./game-state.js";
import { createInitialState, hashState } from "./game-state.js";

export type MatchupResult =
	| { outcome: "player0_wins" }
	| { outcome: "player1_wins" }
	| { outcome: "draw" }
	| { outcome: "unresolved"; reason: string; partialState: GameState };

export interface SearchStats {
	nodesExplored: number;
	maxDepthReached: number;
	terminatedByDepthLimit: boolean;
}

const DEFAULT_MAX_DEPTH = 200;

/** Run a full matchup between two 3-card decks.
 *  Returns the outcome assuming optimal play from both sides. */
export function simulateMatchup(
	deck0: readonly Card[],
	deck1: readonly Card[],
	maxDepth = DEFAULT_MAX_DEPTH,
): { result: MatchupResult; stats: SearchStats } {
	// Check for unresolved abilities — if any card has abilities the engine
	// can't simulate, the matchup is unresolved
	const allCards = [...deck0, ...deck1];
	const unresolvedCards = allCards.filter(hasUnresolvedAbilities);
	if (unresolvedCards.length > 0) {
		const state = createInitialState(deck0, deck1);
		return {
			result: {
				outcome: "unresolved",
				reason: `cards with unresolved abilities: ${unresolvedCards.map((c) => c.name).join(", ")}`,
				partialState: state,
			},
			stats: {
				nodesExplored: 0,
				maxDepthReached: 0,
				terminatedByDepthLimit: false,
			},
		};
	}

	const state = createInitialState(deck0, deck1);
	const stats: SearchStats = {
		nodesExplored: 0,
		maxDepthReached: 0,
		terminatedByDepthLimit: false,
	};

	const transpositionTable = new Map<string, number>();
	const value = minimax(state, 0, maxDepth, stats, transpositionTable);

	let result: MatchupResult;
	if (value > 0) {
		result = { outcome: "player0_wins" };
	} else if (value < 0) {
		result = { outcome: "player1_wins" };
	} else {
		result = { outcome: "draw" };
	}

	return { result, stats };
}

/** Minimax search with alpha-beta pruning and transposition table.
 *  Returns +1 if P0 can force a win, -1 if P1 can, 0 for draw. */
function minimax(
	state: GameState,
	depth: number,
	maxDepth: number,
	stats: SearchStats,
	transpositionTable: Map<string, number>,
	initialAlpha = Number.NEGATIVE_INFINITY,
	initialBeta = Number.POSITIVE_INFINITY,
): number {
	let alpha = initialAlpha;
	let beta = initialBeta;
	stats.nodesExplored++;
	if (depth > stats.maxDepthReached) {
		stats.maxDepthReached = depth;
	}

	// Terminal check: life totals
	const gameResult = checkGameOver(state);
	if (gameResult !== null) {
		if (gameResult.outcome === "draw") return 0;
		return gameResult.winner === 0 ? 1 : -1;
	}

	// Depth limit safety valve
	if (depth >= maxDepth) {
		stats.terminatedByDepthLimit = true;
		return 0; // treat as draw if we hit depth limit
	}

	// Stalemate check at turn boundaries (main_precombat only).
	let effectiveState = state;
	if (state.phase === "main_precombat") {
		const stalemateCheck = checkAndRecordStalemate(state);
		if (stalemateCheck.stalemate) return 0;
		effectiveState = stalemateCheck.state;

		// Transposition table: check if we've evaluated this position before.
		// Only at turn boundaries to keep the table compact.
		const hash = hashState(effectiveState);
		const cached = transpositionTable.get(hash);
		if (cached !== undefined) return cached;
	}

	const actions = enumerateLegalActions(effectiveState);
	if (actions.length === 0) return 0;

	// Blocking decisions are made by the DEFENDER (opponent of active player).
	const decisionMaker =
		effectiveState.phase === "declare_blockers"
			? effectiveState.activePlayer === 0
				? 1
				: 0
			: effectiveState.activePlayer;
	const isMaximizing = decisionMaker === 0;

	// Auto-resolve phases: just apply the pass action
	if (
		effectiveState.phase === "first_strike_damage" ||
		effectiveState.phase === "combat_damage" ||
		effectiveState.phase === "cleanup"
	) {
		const nextState = applyAction(effectiveState, { type: "pass" });
		return minimax(
			nextState,
			depth + 1,
			maxDepth,
			stats,
			transpositionTable,
			alpha,
			beta,
		);
	}

	let value = isMaximizing
		? Number.NEGATIVE_INFINITY
		: Number.POSITIVE_INFINITY;
	for (const action of actions) {
		const nextState = applyAction(effectiveState, action);
		const childValue = minimax(
			nextState,
			depth + 1,
			maxDepth,
			stats,
			transpositionTable,
			alpha,
			beta,
		);
		if (isMaximizing) {
			value = Math.max(value, childValue);
			alpha = Math.max(alpha, value);
		} else {
			value = Math.min(value, childValue);
			beta = Math.min(beta, value);
		}
		if (beta <= alpha) break;
	}

	// Cache the result at turn boundaries
	if (state.phase === "main_precombat") {
		transpositionTable.set(hashState(effectiveState), value);
	}

	return value;
}

// --- Tournament scoring ---

export interface TournamentMatchup {
	readonly player0Index: number;
	readonly player1Index: number;
	readonly result: MatchupResult;
	readonly stats: SearchStats;
}

export interface TournamentStandings {
	readonly matchups: readonly TournamentMatchup[];
	readonly scores: readonly number[]; // points per player
}

/** Run a round-robin tournament. Each deck plays every other deck twice
 *  (once as P0, once as P1) to eliminate first-player advantage. */
export function runRoundRobin(
	decks: readonly (readonly Card[])[],
	maxDepth = DEFAULT_MAX_DEPTH,
): TournamentStandings {
	const matchups: TournamentMatchup[] = [];
	const scores = new Array(decks.length).fill(0) as number[];

	for (let i = 0; i < decks.length; i++) {
		for (let j = i + 1; j < decks.length; j++) {
			const deck0 = decks[i];
			const deck1 = decks[j];
			if (!deck0 || !deck1) continue;

			// Game 1: i as P0, j as P1
			const g1 = simulateMatchup(deck0, deck1, maxDepth);
			matchups.push({
				player0Index: i,
				player1Index: j,
				result: g1.result,
				stats: g1.stats,
			});
			applyScore(scores, i, j, g1.result);

			// Game 2: j as P0, i as P1
			const g2 = simulateMatchup(deck1, deck0, maxDepth);
			matchups.push({
				player0Index: j,
				player1Index: i,
				result: g2.result,
				stats: g2.stats,
			});
			applyScore(scores, j, i, g2.result);
		}
	}

	return { matchups, scores };
}

function applyScore(
	scores: number[],
	p0Index: number,
	p1Index: number,
	result: MatchupResult,
): void {
	switch (result.outcome) {
		case "player0_wins":
			scores[p0Index] = (scores[p0Index] ?? 0) + 3;
			break;
		case "player1_wins":
			scores[p1Index] = (scores[p1Index] ?? 0) + 3;
			break;
		case "draw":
			scores[p0Index] = (scores[p0Index] ?? 0) + 1;
			scores[p1Index] = (scores[p1Index] ?? 0) + 1;
			break;
		case "unresolved":
			// No points until judge resolves
			break;
	}
}

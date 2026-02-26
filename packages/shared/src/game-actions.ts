// pattern: Functional Core

// Action types and state transition logic for the game tree search.
// Each action transforms a GameState into a new GameState.

import type { Card } from "./card-types.js";
import {
	enumerateBlockAssignments,
	hasFirstStrikers,
	resolveCombatDamage,
} from "./combat.js";
import type {
	CombatState,
	GameState,
	Permanent,
	Phase,
	PlayerId,
	PlayerState,
} from "./game-state.js";
import {
	canAttack,
	createPermanent,
	getActivePlayer,
	getDefendingPlayer,
	hasKeyword,
	hashState,
	opponent,
} from "./game-state.js";

// --- Action types ---

export interface CastAction {
	readonly type: "cast";
	// Indices in hand to cast simultaneously.
	// In 3CB with unlimited mana, casting order between your own spells
	// doesn't matter — only WHICH cards to play matters.
	readonly cardIndices: readonly number[];
}

export interface DeclareAttackersAction {
	readonly type: "declare_attackers";
	readonly attackerIds: readonly number[]; // permanent IDs
}

export interface DeclareBlockersAction {
	readonly type: "declare_blockers";
	readonly assignment: ReadonlyMap<number, readonly number[]>; // attacker ID → blocker IDs
}

export interface PassAction {
	readonly type: "pass"; // pass priority / move to next phase
}

export type Action =
	| CastAction
	| DeclareAttackersAction
	| DeclareBlockersAction
	| PassAction;

// --- Action enumeration ---

/** Enumerate all legal actions in the current game state */
export function enumerateLegalActions(state: GameState): Action[] {
	switch (state.phase) {
		case "main_precombat":
		case "main_postcombat":
			return enumerateMainPhaseActions(state);
		case "declare_attackers":
			return enumerateAttackerActions(state);
		case "declare_blockers":
			return enumerateBlockerActions(state);
		case "first_strike_damage":
		case "combat_damage":
		case "cleanup":
			// These phases auto-resolve — only action is pass
			return [{ type: "pass" }];
		default:
			return [{ type: "pass" }];
	}
}

function enumerateMainPhaseActions(state: GameState): Action[] {
	const player = getActivePlayer(state);

	// Enumerate all subsets of cards to cast (batch cast).
	// Always includes cast-nothing (empty subset) which advances to combat.
	// In 3CB with unlimited mana, you choose WHICH cards to play, not the order.
	const indices = player.hand.map((_, i) => i);
	const subsets = generateSubsets(indices);

	return subsets.map((cardIndices) => ({
		type: "cast" as const,
		cardIndices,
	}));
}

function enumerateAttackerActions(state: GameState): Action[] {
	const player = getActivePlayer(state);
	const eligible = player.battlefield.filter(canAttack);

	// Generate all subsets of eligible attackers
	const subsets = generateSubsets(eligible.map((p) => p.id));
	return subsets.map((ids) => ({
		type: "declare_attackers" as const,
		attackerIds: ids,
	}));
}

function enumerateBlockerActions(state: GameState): Action[] {
	if (!state.combat) return [{ type: "pass" }];

	const defender = getDefendingPlayer(state);
	const activePlayer = getActivePlayer(state);
	const attackerPerms = state.combat.attackers
		.map((id) => activePlayer.battlefield.find((p) => p.id === id))
		.filter((p): p is Permanent => p !== undefined);

	const potentialBlockers = defender.battlefield.filter(
		(p) => p.card.types.includes("creature") && !p.tapped,
	);

	const assignments = enumerateBlockAssignments(
		attackerPerms,
		potentialBlockers,
	);

	return assignments.map((assignment) => ({
		type: "declare_blockers" as const,
		assignment,
	}));
}

function generateSubsets(ids: number[]): number[][] {
	if (ids.length === 0) return [[]];
	const result: number[][] = [];
	const count = 1 << ids.length;
	for (let mask = 0; mask < count; mask++) {
		const subset: number[] = [];
		for (let i = 0; i < ids.length; i++) {
			if (mask & (1 << i)) {
				const id = ids[i];
				if (id !== undefined) subset.push(id);
			}
		}
		result.push(subset);
	}
	return result;
}

// --- State transitions ---

/** Apply an action to a game state, returning the new state */
export function applyAction(state: GameState, action: Action): GameState {
	switch (action.type) {
		case "cast":
			return applyCast(state, action);
		case "declare_attackers":
			return applyDeclareAttackers(state, action);
		case "declare_blockers":
			return applyDeclareBlockers(state, action);
		case "pass":
			return applyPass(state);
	}
}

function applyCast(state: GameState, action: CastAction): GameState {
	const player = getActivePlayer(state);

	// Batch cast: put all selected cards onto the battlefield at once
	const indicesToCast = new Set(action.cardIndices);
	const newHand: Card[] = [];
	const newPerms: Permanent[] = [];
	let nextId = state.nextPermanentId;

	for (let i = 0; i < player.hand.length; i++) {
		const card = player.hand[i];
		if (!card) continue;
		if (indicesToCast.has(i)) {
			newPerms.push(createPermanent(card, nextId++));
		} else {
			newHand.push(card);
		}
	}

	const newBattlefield = [...player.battlefield, ...newPerms];

	// After casting, automatically advance to declare_attackers
	return updatePlayer(
		{
			...state,
			nextPermanentId: nextId,
			phase: "declare_attackers" as Phase,
		},
		state.activePlayer,
		{ ...player, hand: newHand, battlefield: newBattlefield },
	);
}

function applyDeclareAttackers(
	state: GameState,
	action: DeclareAttackersAction,
): GameState {
	const player = getActivePlayer(state);

	// Tap attackers (unless they have vigilance)
	const newBattlefield = player.battlefield.map((perm) => {
		if (action.attackerIds.includes(perm.id)) {
			if (hasKeyword(perm, "vigilance")) return perm;
			return { ...perm, tapped: true };
		}
		return perm;
	});

	const combat: CombatState = {
		attackers: action.attackerIds,
		blockers: new Map(),
	};

	// If no attackers, skip combat and advance to next player's turn
	if (action.attackerIds.length === 0) {
		const noAttackState = updatePlayer(
			{ ...state, combat: null },
			state.activePlayer,
			{ ...player, battlefield: newBattlefield },
		);
		return advanceTurn(noAttackState);
	}

	return updatePlayer(
		{ ...state, phase: "declare_blockers" as Phase, combat },
		state.activePlayer,
		{ ...player, battlefield: newBattlefield },
	);
}

function applyDeclareBlockers(
	state: GameState,
	action: DeclareBlockersAction,
): GameState {
	if (!state.combat) return state;

	const combat: CombatState = {
		...state.combat,
		blockers: action.assignment,
	};

	const activePlayer = getActivePlayer(state);
	const attackerPerms = combat.attackers
		.map((id) => activePlayer.battlefield.find((p) => p.id === id))
		.filter((p): p is Permanent => p !== undefined);

	const defender = getDefendingPlayer(state);
	const blockerMap = buildBlockerPermMap(combat.blockers, defender);

	// Determine if we need a first strike damage step
	const needsFirstStrike = hasFirstStrikers(attackerPerms, blockerMap);

	return {
		...state,
		phase: needsFirstStrike ? "first_strike_damage" : "combat_damage",
		combat,
	};
}

function applyPass(state: GameState): GameState {
	switch (state.phase) {
		case "main_precombat":
			// Cast action handles this now — shouldn't reach here
			return { ...state, phase: "declare_attackers" as Phase };

		case "first_strike_damage": {
			const result = resolveCombatStep(state, true);
			return { ...result, phase: "combat_damage" as Phase };
		}

		case "combat_damage": {
			const result = resolveCombatStep(state, false);
			// After combat, advance to next player's turn
			return advanceTurn({ ...result, combat: null });
		}

		case "declare_blockers":
			return state;

		case "main_postcombat":
			return advanceTurn(state);

		case "cleanup":
			return advanceTurn(state);

		default:
			return state;
	}
}

function resolveCombatStep(
	state: GameState,
	isFirstStrike: boolean,
): GameState {
	if (!state.combat) return state;

	const activePlayerState = getActivePlayer(state);
	const defenderState = getDefendingPlayer(state);

	const attackerPerms = state.combat.attackers
		.map((id) => activePlayerState.battlefield.find((p) => p.id === id))
		.filter((p): p is Permanent => p !== undefined);

	const blockerMap = buildBlockerPermMap(state.combat.blockers, defenderState);

	const result = resolveCombatDamage(
		attackerPerms,
		blockerMap,
		state.activePlayer,
		isFirstStrike,
	);

	// Apply life changes
	const newPlayers: [PlayerState, PlayerState] = [
		{
			...state.players[0],
			life: state.players[0].life + result.lifeDelta[0],
		},
		{
			...state.players[1],
			life: state.players[1].life + result.lifeDelta[1],
		},
	];

	// Remove destroyed permanents, move to graveyard
	const destroyedSet = new Set(result.destroyed);
	for (let i = 0; i < 2; i++) {
		const player = newPlayers[i];
		if (!player) continue;
		const destroyed = player.battlefield.filter((p) => destroyedSet.has(p.id));
		const surviving = player.battlefield.filter((p) => !destroyedSet.has(p.id));
		newPlayers[i] = {
			...player,
			battlefield: surviving,
			graveyard: [...player.graveyard, ...destroyed.map((p) => p.card)],
		};
	}

	return { ...state, players: newPlayers };
}

function advanceTurn(state: GameState): GameState {
	const nextPlayer = opponent(state.activePlayer);
	const nextTurn = nextPlayer === 0 ? state.turn + 1 : state.turn;

	// Untap all of next player's permanents, clear summoning sickness
	const nextPlayerState = state.players[nextPlayer];
	const untapped: PlayerState = {
		...nextPlayerState,
		battlefield: nextPlayerState.battlefield.map((p) => ({
			...p,
			tapped: false,
			summoningSick: false,
			damageMarked: 0,
		})),
	};

	const newPlayers: [PlayerState, PlayerState] = [...state.players];
	newPlayers[nextPlayer] = untapped;

	// Also clear damage on the other player's creatures (end of turn)
	const otherPlayer = opponent(nextPlayer);
	const otherState = newPlayers[otherPlayer];
	if (otherState) {
		newPlayers[otherPlayer] = {
			...otherState,
			battlefield: otherState.battlefield.map((p) => ({
				...p,
				damageMarked: 0,
			})),
		};
	}

	const newState: GameState = {
		...state,
		activePlayer: nextPlayer,
		players: newPlayers,
		turn: nextTurn,
		phase: "main_precombat",
		combat: null,
	};

	// Don't record stalemate hashes here — the search handles it
	// at consistent checkpoints (main_precombat only).
	return { ...newState, stateHistory: state.stateHistory };
}

function buildBlockerPermMap(
	blockerIds: ReadonlyMap<number, readonly number[]>,
	defender: PlayerState,
): Map<number, Permanent[]> {
	const map = new Map<number, Permanent[]>();
	for (const [attackerId, ids] of blockerIds) {
		const perms = ids
			.map((id) => defender.battlefield.find((p) => p.id === id))
			.filter((p): p is Permanent => p !== undefined);
		map.set(attackerId, perms);
	}
	return map;
}

function updatePlayer(
	state: GameState,
	player: PlayerId,
	playerState: PlayerState,
): GameState {
	const newPlayers: [PlayerState, PlayerState] = [...state.players];
	newPlayers[player] = playerState;
	return { ...state, players: newPlayers };
}

// --- Terminal state checks ---

export type GameResult =
	| { outcome: "win"; winner: PlayerId }
	| { outcome: "draw" }
	| null; // game not over

/** Check if the game is over (life total check only).
 *  Stalemate detection is handled by the search at turn boundaries. */
export function checkGameOver(state: GameState): GameResult {
	const p0Dead = state.players[0].life <= 0;
	const p1Dead = state.players[1].life <= 0;

	if (p0Dead && p1Dead) return { outcome: "draw" };
	if (p0Dead) return { outcome: "win", winner: 1 };
	if (p1Dead) return { outcome: "win", winner: 0 };

	return null;
}

/** Check stalemate: has this turn-start state been seen before?
 *  Returns the state with the hash recorded if not a repeat. */
export function checkAndRecordStalemate(
	state: GameState,
): { stalemate: true } | { stalemate: false; state: GameState } {
	const hash = hashState(state);
	if (state.stateHistory.has(hash)) {
		return { stalemate: true };
	}
	const newHistory = new Set(state.stateHistory);
	newHistory.add(hash);
	return { stalemate: false, state: { ...state, stateHistory: newHistory } };
}

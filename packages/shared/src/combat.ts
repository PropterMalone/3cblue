// pattern: Functional Core

// Combat damage resolution. Handles keyword interactions:
// - First strike / double strike damage ordering
// - Trample (excess damage to player)
// - Deathtouch (any damage is lethal)
// - Lifelink (damage dealt = life gained)
// - Indestructible (survives lethal damage)

import type { Permanent, PlayerId } from "./game-state.js";
import {
	getEffectivePower,
	getEffectiveToughness,
	hasKeyword,
	isLethalDamage,
} from "./game-state.js";

export interface DamageAssignment {
	readonly targetId: number;
	readonly amount: number;
	readonly sourceId: number;
	readonly sourceHasDeathtouch: boolean;
	readonly sourceHasLifelink: boolean;
}

export interface CombatResult {
	// Permanent IDs that die
	readonly destroyed: readonly number[];
	// Life changes per player [player0delta, player1delta]
	readonly lifeDelta: readonly [number, number];
}

/** Resolve combat damage for a set of attacker/blocker assignments.
 *  Returns which permanents die and life total changes.
 *
 *  @param attackers - attacking permanents (owned by activePlayer)
 *  @param blockerMap - map of attacker ID → blocking permanents
 *  @param activePlayer - who is attacking
 *  @param isFirstStrike - true if resolving first strike damage step only
 */
export function resolveCombatDamage(
	attackers: readonly Permanent[],
	blockerMap: ReadonlyMap<number, readonly Permanent[]>,
	activePlayer: PlayerId,
	isFirstStrike: boolean,
): CombatResult {
	const destroyed: number[] = [];
	const lifeDelta: [number, number] = [0, 0];
	const defendingPlayer = activePlayer === 0 ? 1 : 0;

	// Track cumulative damage to each permanent for this step
	const damageToPermament = new Map<
		number,
		{ total: number; fromDeathtouch: boolean }
	>();

	for (const attacker of attackers) {
		const power = getEffectivePower(attacker);
		if (power <= 0) continue;

		const hasFirstStrike =
			hasKeyword(attacker, "first_strike") ||
			hasKeyword(attacker, "double_strike");
		const hasRegularStrike =
			!hasKeyword(attacker, "first_strike") ||
			hasKeyword(attacker, "double_strike");

		// Skip if this isn't the right damage step for this creature
		if (isFirstStrike && !hasFirstStrike) continue;
		if (!isFirstStrike && !hasRegularStrike) continue;

		const attackerDeathtouch = hasKeyword(attacker, "deathtouch");
		const attackerLifelink = hasKeyword(attacker, "lifelink");
		const blockers = blockerMap.get(attacker.id) ?? [];

		if (blockers.length === 0) {
			// Unblocked — damage goes to defending player
			lifeDelta[defendingPlayer] -= power;
			if (attackerLifelink) {
				lifeDelta[activePlayer] += power;
			}
		} else {
			// Blocked — assign damage to blockers.
			// MTG rule 510.1c: assign at least lethal to each blocker in order,
			// then remaining damage to the last blocker (or trample to player).
			let remainingDamage = power;

			// First pass: assign lethal damage to each blocker in order
			for (const blocker of blockers) {
				if (remainingDamage <= 0) break;
				const lethalAmount = attackerDeathtouch
					? 1
					: Math.max(
							0,
							getEffectiveToughness(blocker) -
								(damageToPermament.get(blocker.id)?.total ?? 0),
						);
				const assigned = Math.min(remainingDamage, lethalAmount);
				addDamage(damageToPermament, blocker.id, assigned, attackerDeathtouch);
				remainingDamage -= assigned;
			}

			// Excess damage: trample goes to defending player, otherwise to last blocker
			if (remainingDamage > 0) {
				if (hasKeyword(attacker, "trample")) {
					lifeDelta[defendingPlayer] -= remainingDamage;
					if (attackerLifelink) {
						lifeDelta[activePlayer] += remainingDamage;
					}
					remainingDamage = 0;
				} else {
					// Dump remaining on last blocker (MTG rules: excess stays on blockers)
					const lastBlocker = blockers[blockers.length - 1];
					if (lastBlocker) {
						addDamage(
							damageToPermament,
							lastBlocker.id,
							remainingDamage,
							attackerDeathtouch,
						);
						remainingDamage = 0;
					}
				}
			}

			// Lifelink: gains life for all damage dealt (to creatures and player)
			if (attackerLifelink) {
				const damageDealt = power - remainingDamage;
				lifeDelta[activePlayer] += damageDealt;
			}
		}

		// Blockers deal damage back to attacker
		if (
			!isFirstStrike ||
			blockers.some(
				(b) => hasKeyword(b, "first_strike") || hasKeyword(b, "double_strike"),
			)
		) {
			// Only process blocker damage in the right step
		}
	}

	// Blockers deal damage to their assigned attacker
	for (const [attackerId, blockers] of blockerMap) {
		const attacker = attackers.find((a) => a.id === attackerId);
		if (!attacker) continue;

		for (const blocker of blockers) {
			const blockerPower = getEffectivePower(blocker);
			if (blockerPower <= 0) continue;

			const blockerHasFirstStrike =
				hasKeyword(blocker, "first_strike") ||
				hasKeyword(blocker, "double_strike");
			const blockerHasRegularStrike =
				!hasKeyword(blocker, "first_strike") ||
				hasKeyword(blocker, "double_strike");

			if (isFirstStrike && !blockerHasFirstStrike) continue;
			if (!isFirstStrike && !blockerHasRegularStrike) continue;

			const blockerDeathtouch = hasKeyword(blocker, "deathtouch");
			addDamage(
				damageToPermament,
				attacker.id,
				blockerPower,
				blockerDeathtouch,
			);

			if (hasKeyword(blocker, "lifelink")) {
				const defendingPlayerId = activePlayer === 0 ? 1 : 0;
				lifeDelta[defendingPlayerId] += blockerPower;
			}
		}
	}

	// Determine which permanents are destroyed
	const allInvolved = [...attackers, ...[...blockerMap.values()].flat()];
	for (const perm of allInvolved) {
		const dmg = damageToPermament.get(perm.id);
		if (dmg && isLethalDamage(perm, dmg.total, dmg.fromDeathtouch)) {
			destroyed.push(perm.id);
		}
	}

	return { destroyed, lifeDelta };
}

function addDamage(
	map: Map<number, { total: number; fromDeathtouch: boolean }>,
	targetId: number,
	amount: number,
	fromDeathtouch: boolean,
): void {
	const existing = map.get(targetId);
	if (existing) {
		map.set(targetId, {
			total: existing.total + amount,
			fromDeathtouch: existing.fromDeathtouch || fromDeathtouch,
		});
	} else {
		map.set(targetId, { total: amount, fromDeathtouch });
	}
}

/** Check if combat has any first strikers (to determine if we need the first strike damage step) */
export function hasFirstStrikers(
	attackers: readonly Permanent[],
	blockerMap: ReadonlyMap<number, readonly Permanent[]>,
): boolean {
	const allBlockers = [...blockerMap.values()].flat();
	return (
		attackers.some(
			(a) => hasKeyword(a, "first_strike") || hasKeyword(a, "double_strike"),
		) ||
		allBlockers.some(
			(b) => hasKeyword(b, "first_strike") || hasKeyword(b, "double_strike"),
		)
	);
}

/** Enumerate all legal block assignments for a set of attackers and potential blockers.
 *  Returns all possible assignments. Each assignment is a Map<attackerId, blockerIds[]>.
 *  Respects: flying (only flying/reach can block flyers), menace (must be blocked by 2+).
 */
export function enumerateBlockAssignments(
	attackers: readonly Permanent[],
	potentialBlockers: readonly Permanent[],
): ReadonlyMap<number, readonly number[]>[] {
	if (attackers.length === 0) return [new Map()];

	// For each blocker, determine which attackers it can legally block
	const blockerOptions = potentialBlockers.map((blocker) => ({
		blocker,
		canBlock: attackers
			.filter((a) => canBlockAttacker(blocker, a))
			.map((a) => a.id),
	}));

	// Generate all possible assignments:
	// Each blocker can block at most one attacker (or not block at all).
	// This is the cartesian product of each blocker's choices.
	const assignments: Map<number, number[]>[] = [];
	generateAssignments(blockerOptions, 0, new Map(), assignments);

	// Filter out assignments where menace creatures are blocked by fewer than 2
	return assignments.filter((assignment) => {
		for (const attacker of attackers) {
			if (hasKeyword(attacker, "menace")) {
				const blockers = assignment.get(attacker.id) ?? [];
				// Menace: if blocked at all, must be by 2+
				if (blockers.length === 1) return false;
			}
		}
		return true;
	});
}

function canBlockAttacker(blocker: Permanent, attacker: Permanent): boolean {
	if (blocker.tapped) return false;
	if (!blocker.card.types.includes("creature")) return false;
	if (hasKeyword(attacker, "flying")) {
		if (!hasKeyword(blocker, "flying") && !hasKeyword(blocker, "reach")) {
			return false;
		}
	}
	return true;
}

function generateAssignments(
	blockerOptions: readonly { blocker: Permanent; canBlock: number[] }[],
	index: number,
	current: Map<number, number[]>,
	results: Map<number, number[]>[],
): void {
	if (index >= blockerOptions.length) {
		// Deep copy the current assignment
		const copy = new Map<number, number[]>();
		for (const [k, v] of current) {
			copy.set(k, [...v]);
		}
		results.push(copy);
		return;
	}

	const option = blockerOptions[index];
	if (!option) return;
	const { blocker, canBlock } = option;

	// Option 1: this blocker doesn't block
	generateAssignments(blockerOptions, index + 1, current, results);

	// Option 2: this blocker blocks one of its valid targets
	for (const attackerId of canBlock) {
		const existing = current.get(attackerId) ?? [];
		current.set(attackerId, [...existing, blocker.id]);
		generateAssignments(blockerOptions, index + 1, current, results);
		// Restore
		if (existing.length === 0) {
			current.delete(attackerId);
		} else {
			current.set(attackerId, existing);
		}
	}
}

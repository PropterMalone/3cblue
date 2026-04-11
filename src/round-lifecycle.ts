// pattern: Imperative Shell

// Round lifecycle: orchestrates the phases of a 3CB round.

import type Database from "better-sqlite3";
import type { Card } from "./card-types.js";
import {
	type DbMatchup,
	type DbRound,
	type DbSubmission,
	addWinnerBan,
	getActiveRound,
	getAllCompletedMatchups,
	getCompletedRoundCount,
	getCompletedRoundPlayerDids,
	getMatchupsForRound,
	getRound,
	getSubmissionsForRound,
	getUnresolvedMatchups,
	insertMatchup,
	updateRoundPhase,
} from "./database.js";
import { evaluateMatchup as defaultEvaluateMatchup } from "./matchup-evaluator.js";

export interface MatchupResultWithPlayers {
	player0Did: string;
	player1Did: string;
	outcome: "player0_wins" | "player1_wins" | "draw" | "unresolved";
	reasoning: string;
}

export type MatchupEvaluator = (
	deck0: readonly Card[],
	deck1: readonly Card[],
) => Promise<{
	outcome: "player0_wins" | "player1_wins" | "draw";
	reasoning: string;
}>;

export interface RoundResolutionResult {
	matchups: MatchupResultWithPlayers[];
	unresolvedCount: number;
}

export interface StandingsEntry {
	playerDid: string;
	points: number;
	wins: number;
	draws: number;
	losses: number;
	unresolved: number;
}

/** Check if a round's submission deadline has passed and it's still accepting submissions. */
export function isRoundPastDeadline(round: DbRound): boolean {
	if (round.phase !== "submission") return false;
	if (!round.submissionDeadline) return false;
	return new Date() >= new Date(round.submissionDeadline);
}

/** LEGACY: Not used in production since R1. The /resolve-round skill handles
 *  actual resolution via per-deck agents with crosscheck. */
export async function resolveRound(
	db: Database.Database,
	evaluator: MatchupEvaluator = defaultEvaluateMatchup,
): Promise<RoundResolutionResult | { error: string }> {
	const round = getActiveRound(db);
	if (!round) return { error: "no active round" };
	if (round.phase !== "submission") {
		return { error: `round is in ${round.phase} phase, not submission` };
	}

	const submissions = getSubmissionsForRound(db, round.id);
	if (submissions.length < 2) {
		return { error: "need at least 2 submissions to resolve" };
	}

	const existing = getMatchupsForRound(db, round.id);
	if (existing.length > 0) {
		return {
			error: `round ${round.id} already has ${existing.length} matchups — delete them first to re-resolve`,
		};
	}

	updateRoundPhase(db, round.id, "resolution");

	const matchups: MatchupResultWithPlayers[] = [];
	let unresolvedCount = 0;

	for (let i = 0; i < submissions.length; i++) {
		for (let j = i + 1; j < submissions.length; j++) {
			const sub0 = submissions[i] as DbSubmission;
			const sub1 = submissions[j] as DbSubmission;
			const deck0 = deserializeDeck(sub0);
			const deck1 = deserializeDeck(sub1);

			let outcome: "player0_wins" | "player1_wins" | "draw" | "unresolved";
			let reasoning: string;
			let unresolvedReason: string | null = null;

			try {
				const verdict = await evaluator(deck0, deck1);
				outcome = verdict.outcome;
				reasoning = verdict.reasoning;
			} catch (err) {
				outcome = "unresolved";
				reasoning = "";
				unresolvedReason = `llm evaluation failed: ${err instanceof Error ? err.message : String(err)}`;
				unresolvedCount++;
			}

			matchups.push({
				player0Did: sub0.playerDid,
				player1Did: sub1.playerDid,
				outcome,
				reasoning,
			});

			insertMatchup(
				db,
				round.id,
				sub0.playerDid,
				sub1.playerDid,
				outcome,
				unresolvedReason,
				"{}",
				reasoning || null,
			);
		}
	}

	if (unresolvedCount > 0) {
		updateRoundPhase(db, round.id, "judging");
	} else {
		finalizeRound(db, round.id);
	}

	return { matchups, unresolvedCount };
}

/**
 * Extract per-direction verdicts from a matchup.
 * Returns [onPlay, onDraw] verdicts from player0's perspective.
 */
function getDirectionVerdicts(m: DbMatchup): [string, string] {
	// Prefer DB columns (set by R4+ import)
	if (m.onPlayVerdict && m.onDrawVerdict) {
		const verdictToOutcome = (v: string) =>
			v === "W" ? "player0_wins" : v === "L" ? "player1_wins" : "draw";
		return [
			verdictToOutcome(m.onPlayVerdict),
			verdictToOutcome(m.onDrawVerdict),
		];
	}
	// Narrative JSON (R2-R3 format)
	try {
		if (m.narrative) {
			const data = JSON.parse(m.narrative);
			if (data.onPlayVerdict && data.onDrawVerdict) {
				return [data.onPlayVerdict, data.onDrawVerdict];
			}
		}
	} catch {
		// malformed narrative, fall through
	}
	// Legacy fallback: try to parse combined codes (WL, WD, etc.)
	const effectiveOutcome = m.judgeResolution ?? m.outcome;
	const combinedMap: Record<string, [string, string]> = {
		WW: ["player0_wins", "player0_wins"],
		WL: ["player0_wins", "player1_wins"],
		WD: ["player0_wins", "draw"],
		DD: ["draw", "draw"],
		DL: ["draw", "player1_wins"],
		LL: ["player1_wins", "player1_wins"],
		LW: ["player1_wins", "player0_wins"],
		DW: ["draw", "player0_wins"],
		LD: ["player1_wins", "draw"],
	};
	if (combinedMap[effectiveOutcome]) {
		return combinedMap[effectiveOutcome];
	}
	// Single-outcome fallback: apply to both directions
	return [effectiveOutcome, effectiveOutcome];
}

/** Compute standings for a round from its matchup results. */
export function computeStandings(
	db: Database.Database,
	roundId: number,
): StandingsEntry[] {
	const matchups = getMatchupsForRound(db, roundId);
	const submissions = getSubmissionsForRound(db, roundId);
	const playerDids = submissions.map((s) => s.playerDid);

	const standings = new Map<string, StandingsEntry>();
	for (const did of playerDids) {
		standings.set(did, {
			playerDid: did,
			points: 0,
			wins: 0,
			draws: 0,
			losses: 0,
			unresolved: 0,
		});
	}

	for (const m of matchups) {
		const p0 = standings.get(m.player0Did);
		const p1 = standings.get(m.player1Did);
		if (!p0 || !p1) continue;

		const effectiveOutcome = m.judgeResolution ?? m.outcome;
		if (effectiveOutcome === "unresolved") {
			p0.unresolved++;
			p1.unresolved++;
			continue;
		}

		const directions = getDirectionVerdicts(m);
		for (const dir of directions) {
			if (dir === "player0_wins") {
				p0.points += 3;
				p0.wins++;
				p1.losses++;
			} else if (dir === "player1_wins") {
				p1.points += 3;
				p1.wins++;
				p0.losses++;
			} else {
				p0.points += 1;
				p1.points += 1;
				p0.draws++;
				p1.draws++;
			}
		}
	}

	return [...standings.values()].sort((a, b) => b.points - a.points);
}

/** Check if all unresolved matchups have been judged. If so, complete the round. */
export function checkJudgingComplete(db: Database.Database): boolean {
	const round = getActiveRound(db);
	if (!round || round.phase !== "judging") return false;

	const unresolved = getUnresolvedMatchups(db, round.id);
	if (unresolved.length === 0) {
		finalizeRound(db, round.id);
		return true;
	}
	return false;
}

/** Mark round complete and ban the winning deck's cards.
 *  Idempotent — safe to call on an already-complete round. */
export function finalizeRound(
	db: Database.Database,
	roundId: number,
): { winnersFound: number; cardsBanned: string[] } {
	const round = getRound(db, roundId);
	if (!round) return { winnersFound: 0, cardsBanned: [] };

	if (round.phase !== "complete") {
		updateRoundPhase(db, roundId, "complete");
	}

	const standings = computeStandings(db, roundId);
	if (standings.length === 0) return { winnersFound: 0, cardsBanned: [] };

	const topScore = standings[0]!.points;
	const winners = standings.filter((s) => s.points === topScore);
	const submissions = getSubmissionsForRound(db, roundId);
	const cardsBanned: string[] = [];

	for (const winner of winners) {
		const sub = submissions.find((s) => s.playerDid === winner.playerDid);
		if (!sub) continue;
		for (const name of [sub.card1Name, sub.card2Name, sub.card3Name]) {
			addWinnerBan(db, name, roundId);
			cardsBanned.push(name);
		}
	}

	return { winnersFound: winners.length, cardsBanned };
}

export interface LeaderboardEntry {
	playerDid: string;
	points: number;
	wins: number;
	draws: number;
	losses: number;
	roundsPlayed: number;
}

/** Aggregate standings across all completed rounds. */
export function computeLeaderboard(db: Database.Database): LeaderboardEntry[] {
	const matchups = getAllCompletedMatchups(db);
	const playerDids = getCompletedRoundPlayerDids(db);

	const stats = new Map<string, LeaderboardEntry>();
	for (const did of playerDids) {
		stats.set(did, {
			playerDid: did,
			points: 0,
			wins: 0,
			draws: 0,
			losses: 0,
			roundsPlayed: 0,
		});
	}

	const roundsPerPlayer = new Map<string, Set<number>>();
	for (const did of playerDids) {
		roundsPerPlayer.set(did, new Set());
	}
	for (const m of matchups) {
		roundsPerPlayer.get(m.player0Did)?.add(m.roundId);
		roundsPerPlayer.get(m.player1Did)?.add(m.roundId);
	}
	for (const [did, rounds] of roundsPerPlayer) {
		const entry = stats.get(did);
		if (entry) entry.roundsPlayed = rounds.size;
	}

	for (const m of matchups) {
		const p0 = stats.get(m.player0Did);
		const p1 = stats.get(m.player1Did);
		if (!p0 || !p1) continue;

		const effectiveOutcome = m.judgeResolution ?? m.outcome;
		if (effectiveOutcome === "unresolved") continue;

		const directions = getDirectionVerdicts(m);
		for (const dir of directions) {
			if (dir === "player0_wins") {
				p0.points += 3;
				p0.wins++;
				p1.losses++;
			} else if (dir === "player1_wins") {
				p1.points += 3;
				p1.wins++;
				p0.losses++;
			} else {
				p0.points += 1;
				p1.points += 1;
				p0.draws++;
				p1.draws++;
			}
		}
	}

	return [...stats.values()].sort((a, b) => b.points - a.points);
}

function deserializeDeck(sub: DbSubmission): Card[] {
	return [
		JSON.parse(sub.card1Json) as Card,
		JSON.parse(sub.card2Json) as Card,
		JSON.parse(sub.card3Json) as Card,
	];
}

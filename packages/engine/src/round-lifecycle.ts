// pattern: Imperative Shell

// Round lifecycle: orchestrates the phases of a 3CB round.
// Each function advances the round to the next phase and returns
// data needed for the bot to post/DM.

import type { Card } from "@3cblue/shared";
import type Database from "better-sqlite3";
import {
	type DbMatchup,
	type DbRound,
	type DbSubmission,
	getActiveRound,
	getAllCompletedMatchups,
	getCompletedRoundCount,
	getCompletedRoundPlayerDids,
	getMatchupsForRound,
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

/** Close submissions, advance to resolution phase, and run all matchups. */
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

	updateRoundPhase(db, round.id, "resolution");

	const matchups: MatchupResultWithPlayers[] = [];
	let unresolvedCount = 0;

	// One LLM evaluation per pair — the prompt covers both play/draw directions
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
				// LLM failure degrades to unresolved — falls through to judge path
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

	// Advance phase based on whether we need judging
	if (unresolvedCount > 0) {
		updateRoundPhase(db, round.id, "judging");
	} else {
		updateRoundPhase(db, round.id, "complete");
	}

	return { matchups, unresolvedCount };
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
		const effectiveOutcome = m.judgeResolution ?? m.outcome;
		const p0 = standings.get(m.player0Did);
		const p1 = standings.get(m.player1Did);
		if (!p0 || !p1) continue;

		switch (effectiveOutcome) {
			case "player0_wins":
				p0.points += 3;
				p0.wins++;
				p1.losses++;
				break;
			case "player1_wins":
				p1.points += 3;
				p1.wins++;
				p0.losses++;
				break;
			case "draw":
				p0.points += 1;
				p1.points += 1;
				p0.draws++;
				p1.draws++;
				break;
			case "unresolved":
				p0.unresolved++;
				p1.unresolved++;
				break;
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
		updateRoundPhase(db, round.id, "complete");
		return true;
	}
	return false;
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

	// Count rounds played per player from submissions
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
		const effectiveOutcome = m.judgeResolution ?? m.outcome;
		const p0 = stats.get(m.player0Did);
		const p1 = stats.get(m.player1Did);
		if (!p0 || !p1) continue;

		switch (effectiveOutcome) {
			case "player0_wins":
				p0.points += 3;
				p0.wins++;
				p1.losses++;
				break;
			case "player1_wins":
				p1.points += 3;
				p1.wins++;
				p0.losses++;
				break;
			case "draw":
				p0.points += 1;
				p1.points += 1;
				p0.draws++;
				p1.draws++;
				break;
			// unresolved matchups in completed rounds shouldn't exist, but skip gracefully
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

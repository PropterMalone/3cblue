// pattern: Imperative Shell

// Round lifecycle: orchestrates the phases of a 3CB round.
// Each function advances the round to the next phase and returns
// data needed for the bot to post/DM.

import {
	type Card,
	type MatchupResult,
	type SearchStats,
	simulateMatchup,
} from "@3cblue/shared";
import type Database from "better-sqlite3";
import {
	type DbMatchup,
	type DbSubmission,
	getActiveRound,
	getMatchupsForRound,
	getSubmissionsForRound,
	getUnresolvedMatchups,
	insertMatchup,
	updateRoundPhase,
} from "./database.js";

export interface MatchupResultWithPlayers {
	player0Did: string;
	player1Did: string;
	result: MatchupResult;
	stats: SearchStats;
}

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

/** Close submissions, advance to resolution phase, and run all matchups. */
export function resolveRound(
	db: Database.Database,
): RoundResolutionResult | { error: string } {
	const round = getActiveRound(db);
	if (!round) return { error: "no active round" };
	if (round.phase !== "submission" && round.phase !== "signup") {
		return { error: `round is in ${round.phase} phase, not submission` };
	}

	const submissions = getSubmissionsForRound(db, round.id);
	if (submissions.length < 2) {
		return { error: "need at least 2 submissions to resolve" };
	}

	updateRoundPhase(db, round.id, "resolution");

	const matchups: MatchupResultWithPlayers[] = [];
	let unresolvedCount = 0;

	// Run all pairwise matchups (both directions for fairness)
	for (let i = 0; i < submissions.length; i++) {
		for (let j = i + 1; j < submissions.length; j++) {
			const sub0 = submissions[i] as DbSubmission;
			const sub1 = submissions[j] as DbSubmission;
			const deck0 = deserializeDeck(sub0);
			const deck1 = deserializeDeck(sub1);

			// Game 1: sub0 as P0, sub1 as P1
			const g1 = simulateMatchup(deck0, deck1);
			matchups.push({
				player0Did: sub0.playerDid,
				player1Did: sub1.playerDid,
				result: g1.result,
				stats: g1.stats,
			});
			insertMatchup(
				db,
				round.id,
				sub0.playerDid,
				sub1.playerDid,
				g1.result.outcome,
				g1.result.outcome === "unresolved" ? g1.result.reason : null,
				JSON.stringify(g1.stats),
			);
			if (g1.result.outcome === "unresolved") unresolvedCount++;

			// Game 2: sub1 as P0, sub0 as P1
			const g2 = simulateMatchup(deck1, deck0);
			matchups.push({
				player0Did: sub1.playerDid,
				player1Did: sub0.playerDid,
				result: g2.result,
				stats: g2.stats,
			});
			insertMatchup(
				db,
				round.id,
				sub1.playerDid,
				sub0.playerDid,
				g2.result.outcome,
				g2.result.outcome === "unresolved" ? g2.result.reason : null,
				JSON.stringify(g2.stats),
			);
			if (g2.result.outcome === "unresolved") unresolvedCount++;
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

function deserializeDeck(sub: DbSubmission): Card[] {
	return [
		JSON.parse(sub.card1Json) as Card,
		JSON.parse(sub.card2Json) as Card,
		JSON.parse(sub.card3Json) as Card,
	];
}

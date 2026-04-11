// pattern: Functional Core
//
// Lookup historical matchup results from the Metashape database.
// Used to short-circuit LLM evaluation when we already have a
// human-adjudicated result for the same deck pair.

import { readFileSync } from "node:fs";

interface MatchupEntry {
	score: number;
	sources: string[];
}

interface MatchupDb {
	matchups: Record<string, MatchupEntry>;
	totalMatchups: number;
	totalRounds: number;
	scrapedAt: string;
}

export interface LookupResult {
	found: true;
	outcome: "player0_wins" | "player1_wins" | "draw";
	score: number;
	sources: string[];
}

export interface LookupMiss {
	found: false;
}

let cachedDb: MatchupDb | null = null;

function deckKey(cards: readonly string[]): string {
	return cards
		.map((c) => c.trim().toLowerCase())
		.sort()
		.join("|");
}

export function loadMatchupDb(
	path = "./data/metashape-matchups.json",
): MatchupDb {
	if (cachedDb) return cachedDb;
	const raw = readFileSync(path, "utf-8");
	cachedDb = JSON.parse(raw) as MatchupDb;
	return cachedDb;
}

export function clearMatchupDbCache(): void {
	cachedDb = null;
}

/**
 * Look up a matchup result from historical data.
 * Score 6 = deck0 wins both, 0 = deck0 loses both, 1-5 = draw (conservative).
 * Cards are order-independent.
 */
export function lookupMatchup(
	deck0Cards: readonly string[],
	deck1Cards: readonly string[],
	db?: MatchupDb,
): LookupResult | LookupMiss {
	const matchupDb = db ?? loadMatchupDb();

	const k0 = deckKey(deck0Cards);
	const k1 = deckKey(deck1Cards);
	const key = k0 <= k1 ? `${k0} vs ${k1}` : `${k1} vs ${k0}`;
	const swapped = k0 > k1;

	const entry = matchupDb.matchups[key];
	if (!entry) return { found: false };

	const score = swapped ? 6 - entry.score : entry.score;

	let outcome: "player0_wins" | "player1_wins" | "draw";
	if (score === 6) {
		outcome = "player0_wins";
	} else if (score === 0) {
		outcome = "player1_wins";
	} else {
		outcome = "draw";
	}

	return { found: true, outcome, score, sources: entry.sources };
}

export function getMatchupDbStats(db?: MatchupDb): {
	uniquePairs: number;
	totalMatchups: number;
	totalRounds: number;
} {
	const matchupDb = db ?? loadMatchupDb();
	return {
		uniquePairs: Object.keys(matchupDb.matchups).length,
		totalMatchups: matchupDb.totalMatchups,
		totalRounds: matchupDb.totalRounds,
	};
}

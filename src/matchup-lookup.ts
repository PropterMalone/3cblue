// pattern: Functional Core
//
// Lookup historical matchup results from the Metashape database.
// Used to short-circuit LLM evaluation when we already have a
// human-adjudicated result for the same deck pair.

import { readFileSync } from "node:fs";

interface MatchupEntry {
	score: number; // 0-6 from deck0's perspective (deck0 is the lex-smaller key)
	sources: string[]; // e.g. ["R1A", "R45B"]
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
	score: number; // raw score from deck0's perspective
	sources: string[];
}

export interface LookupMiss {
	found: false;
}

let cachedDb: MatchupDb | null = null;

/** Normalize a deck to canonical key: sorted lowercase card names joined by | */
function deckKey(cards: readonly string[]): string {
	return cards
		.map((c) => c.trim().toLowerCase())
		.sort()
		.join("|");
}

/** Load the matchup database from disk (cached after first load) */
export function loadMatchupDb(
	path = "./data/metashape-matchups.json",
): MatchupDb {
	if (cachedDb) return cachedDb;
	const raw = readFileSync(path, "utf-8");
	cachedDb = JSON.parse(raw) as MatchupDb;
	return cachedDb;
}

/** Clear the cached DB (for testing) */
export function clearMatchupDbCache(): void {
	cachedDb = null;
}

/**
 * Look up a matchup result from historical data.
 *
 * Score semantics (double round-robin, both play/draw directions):
 *   6 = deck0 wins both directions → player0_wins
 *   0 = deck0 loses both directions → player1_wins
 *   3 = split (each wins on the play) → draw
 *   2 = draw both directions → draw
 *   1, 4, 5 = partial/contested → treat as draw (conservative)
 *
 * Cards are order-independent — {Bolt, Snap, Delver} == {Delver, Bolt, Snap}
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

	// Normalize score to deck0's perspective
	const score = swapped ? 6 - entry.score : entry.score;

	let outcome: "player0_wins" | "player1_wins" | "draw";
	if (score === 6) {
		outcome = "player0_wins";
	} else if (score === 0) {
		outcome = "player1_wins";
	} else {
		// 1, 2, 3, 4, 5 all map to draw (conservative — split, draw, or contested)
		outcome = "draw";
	}

	return { found: true, outcome, score, sources: entry.sources };
}

/** Stats about the loaded database */
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

// pattern: Imperative Shell
//
// Polls a Bluesky thread for correction replies, parses them, and auto-applies.
// Uses PBK's watchThread for thread polling + like-to-ack.
// First correction on a matchup auto-applies. Second touch flags for human review.

import type { AtpAgent } from "@atproto/api";
import type Database from "better-sqlite3";
import type { ThreadReply } from "propter-bsky-kit";
import { watchThread } from "propter-bsky-kit/thread-watcher";
import type { ReviewStatus } from "./database.js";
import { getPlayer, getSubmissionsForRound, setReviewStatus } from "./database.js";
import { appendUpdate, applyUpdates, readUpdates } from "./round-updates.js";
import type { RoundUpdate } from "./round-updates.js";

export interface ParsedCorrection {
	playerA: string;
	playerB: string;
	verdict: string; // "WW", "WL", "LL", "DD", "WD", "DL"
	reason: string;
	sourceUri: string;
	authorHandle: string;
}

/** Parse all corrections from a reply (may contain multiple). */
export function parseCorrections(
	text: string,
	authorHandle: string,
	sourceUri: string,
	allHandles: readonly string[],
	cardOwners?: ReadonlyMap<string, string>,
): ParsedCorrection[] {
	// Split on newlines and "VS" boundaries to handle multi-correction posts
	const segments = text.split(/\n/).filter((s) => s.trim().length > 10);
	if (segments.length <= 1) {
		const single = parseSingleCorrection(
			text,
			authorHandle,
			sourceUri,
			allHandles,
			cardOwners,
		);
		return single ? [single] : [];
	}
	const results: ParsedCorrection[] = [];
	for (const seg of segments) {
		const c = parseSingleCorrection(
			seg,
			authorHandle,
			sourceUri,
			allHandles,
			cardOwners,
		);
		if (c) results.push(c);
	}
	return results;
}

/**
 * Build a card-token → handle map from a round's submissions. Used to resolve
 * card-name references in corrections ("Karakas WLs Magus" → elyv WL mutantmell).
 * Only includes tokens of length ≥ 4 that uniquely identify one player's deck.
 * Stopword-filtered to avoid false positives on common English words.
 */
export function buildCardOwnerMap(
	submissions: readonly { playerHandle: string; cards: readonly string[] }[],
): ReadonlyMap<string, string> {
	const stopwords = new Set([
		"lord", "with", "from", "when", "that", "this", "what", "your", "they",
		"them", "were", "will", "into", "over", "have", "been", "just", "like",
		"than", "then", "also", "both", "mind", "time", "turn", "play", "draw",
		"card", "deck", "land", "mana", "life", "damage", "attack", "block",
	]);
	// token → set of handles that have a card containing it
	const tokenToHandles = new Map<string, Set<string>>();
	for (const sub of submissions) {
		const handle = sub.playerHandle;
		const seen = new Set<string>();
		for (const card of sub.cards) {
			for (const word of card.split(/[^A-Za-z]+/)) {
				const w = word.toLowerCase();
				if (w.length < 4 || stopwords.has(w)) continue;
				if (seen.has(w)) continue;
				seen.add(w);
				let set = tokenToHandles.get(w);
				if (!set) {
					set = new Set();
					tokenToHandles.set(w, set);
				}
				set.add(handle);
			}
		}
	}
	const result = new Map<string, string>();
	for (const [token, handles] of tokenToHandles) {
		if (handles.size === 1) {
			result.set(token, [...handles][0]!);
		}
	}
	return result;
}

/** Parse a single correction from text. Returns null if not a correction. */
export function parseSingleCorrection(
	text: string,
	authorHandle: string,
	sourceUri: string,
	allHandles: readonly string[],
	cardOwners?: ReadonlyMap<string, string>,
): ParsedCorrection | null {
	// Normalize text
	const t = text.trim();

	// Skip obvious non-corrections
	if (t.length < 15) return null;
	const lower = t.toLowerCase();
	if (
		lower.startsWith("sweet") ||
		lower.startsWith("looks lik") ||
		lower.startsWith("lol") ||
		lower.startsWith("hrm") ||
		lower.startsWith("more correction")
	)
		return null;

	// Extract mentioned handles — match full handles and short names
	const shortNames = new Map<string, string>();
	for (const h of allHandles) {
		shortNames.set(h.toLowerCase(), h);
		const short = h.replace(/\.bsky\.social$/, "").replace(/\.\w+$/, "");
		if (short !== h) shortNames.set(short.toLowerCase(), h);
	}
	const patterns = [...shortNames.keys()]
		.sort((a, b) => b.length - a.length) // longest first to avoid partial matches
		.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const mentionRegex = new RegExp(`@?(${patterns.join("|")})`, "gi");
	const rawMentions = [...t.matchAll(mentionRegex)].map(
		(m) =>
			shortNames.get(m[1]!.toLowerCase())?.toLowerCase() ?? m[1]!.toLowerCase(),
	);

	// Also match card-name tokens → deck owner handles (preserves order with
	// handle mentions, so "Karakas WLs Magus" → [elyv, mutantmell]).
	const mentions: string[] = [];
	if (cardOwners && cardOwners.size > 0) {
		const cardTokenPattern = [...cardOwners.keys()]
			.sort((a, b) => b.length - a.length)
			.map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join("|");
		// Match handles OR card tokens in order of appearance. Card tokens match
		// with a leading word boundary but allow trailing letters (e.g.
		// "Stylusing" → "Stylus", "Regisaurs" → "Regisaur").
		const combined = new RegExp(
			`@?(${patterns.join("|")})|\\b(${cardTokenPattern})\\w*`,
			"gi",
		);
		for (const m of t.matchAll(combined)) {
			if (m[1]) {
				mentions.push(
					shortNames.get(m[1].toLowerCase())?.toLowerCase() ??
						m[1].toLowerCase(),
				);
			} else if (m[2]) {
				const owner = cardOwners.get(m[2].toLowerCase());
				if (owner) mentions.push(owner.toLowerCase());
			}
		}
	} else {
		mentions.push(...rawMentions);
	}

	// Deduplicate while preserving order (one matchup = at most 2 distinct players)
	const seenMentions = new Set<string>();
	const dedupedMentions: string[] = [];
	for (const m of mentions) {
		if (!seenMentions.has(m)) {
			seenMentions.add(m);
			dedupedMentions.push(m);
		}
	}

	// Extract verdict pattern (WW, WL, LL, DD, WD, DL). Trailing "s" allowed
	// for natural forms like "WLs"/"LLs" — "Karakas WLs Magus".
	const verdictMatch = t.match(/\b([WwLlDd]{2})s?\b/);
	const verdict = verdictMatch?.[1]?.toUpperCase() ?? null;

	if (!verdict) return null;

	// Determine the two players
	let playerA: string | null = null;
	let playerB: string | null = null;

	const firstPerson =
		/\b(my|i'm|i\s+am|i\s+think|i\s+can|i\s+don't|i\s+win|i\s+lose)\b/i.test(t);

	if (dedupedMentions.length >= 2) {
		// "@A should WW @B" or "@A is LL to @B"
		playerA = dedupedMentions[0]!;
		playerB = dedupedMentions[1]!;
	} else {
		// "VS. @X should be YY" — check context for who playerA is
		const vsMatch = t.match(/vs\.?\s+@?([\w.-]+)/i);
		if (vsMatch) {
			playerB = vsMatch[1]!.replace(/\.$/, "").toLowerCase();
			// If first-person language or only one mention, author is playerA
			playerA = authorHandle.toLowerCase();
		} else if (dedupedMentions.length === 1) {
			// "in my matchup with @B" — author is one player
			playerA = firstPerson
				? authorHandle.toLowerCase()
				: dedupedMentions[0]!;
			playerB = firstPerson
				? dedupedMentions[0]!
				: authorHandle.toLowerCase();
		}
	}

	if (!playerA || !playerB) return null;

	// Resolve to full handles (exact match, then prefix match as fallback)
	const resolveHandle = (h: string): string => {
		const low = h.toLowerCase();
		const full = shortNames.get(low);
		if (full) return full;
		const exact = allHandles.find((fh) => fh.toLowerCase() === low);
		if (exact) return exact;
		// Prefix match: "jkyu" → "jkyu06.bsky.social"
		const prefix = allHandles.filter((fh) => fh.toLowerCase().startsWith(low));
		if (prefix.length === 1) return prefix[0]!;
		return h;
	};

	playerA = resolveHandle(playerA);
	playerB = resolveHandle(playerB);

	return {
		playerA,
		playerB,
		verdict,
		reason: t,
		sourceUri,
		authorHandle,
	};
}

/** Convert a ParsedCorrection to play/draw verdicts from playerA's perspective. */
export function correctionToVerdicts(verdict: string): {
	play: string;
	draw: string;
} {
	// First char = on-play result, second = on-draw result (from playerA's perspective)
	return { play: verdict[0]!, draw: verdict[1]! };
}

/** Check if a reply is a confirmation ("looks right", "correct", etc.) rather than a correction. */
export function isConfirmation(text: string): boolean {
	const lower = text.toLowerCase().trim();
	if (lower.length > 200) return false; // long posts aren't confirmations
	const patterns = [
		/^looks? (?:right|good|correct)/,
		/^correct/,
		/^(?:yep|yeah|yes),?\s*(?:that'?s? (?:right|correct)|correct|looks? right)/,
		/^confirmed?\.?$/,
		/^agree[ds]?\.?$/,
		/^lgtm/,
		/^that'?s? (?:right|correct)/,
		/other results look right/,
	];
	return patterns.some((p) => p.test(lower));
}

export interface ReviewStatusChange {
	matchupKey: string;
	oldStatus: ReviewStatus;
	newStatus: ReviewStatus;
	reason: string;
}

export interface HarvestResult {
	parsed: ParsedCorrection[];
	applied: number;
	flaggedForReview: string[];
	reviewStatusChanges: ReviewStatusChange[];
	confirmations: number;
	skipped: number;
	errors: string[];
}

interface MatchupTouch {
	play: string;
	draw: string;
	sourceUri: string;
	authorHandle: string;
	matchupId?: number;
}

/** Run one harvest pass: read threads, parse corrections, apply, like, regen. */
export async function harvestCorrections(
	agent: AtpAgent,
	db: Database.Database,
	roundId: number,
	threadUris: string[],
	allHandles: readonly string[],
	botDid: string,
	dryRun = false,
): Promise<HarvestResult> {
	const result: HarvestResult = {
		parsed: [],
		applied: 0,
		flaggedForReview: [],
		reviewStatusChanges: [],
		confirmations: 0,
		skipped: 0,
		errors: [],
	};

	// Track which matchups already have corrections (sorted key → touch info)
	const existingUpdates = readUpdates(roundId);
	const touched = new Map<string, MatchupTouch>();
	for (const u of existingUpdates) {
		const key = [u.matchup[0], u.matchup[1]].sort().join("|");
		touched.set(key, {
			play: u.play,
			draw: u.draw,
			sourceUri: u.source.uri ?? "",
			authorHandle: u.source.context ?? "",
		});
	}

	// Track which correction URIs have been confirmed (parentUri → matchupKey)
	const correctionUriToMatchup = new Map<string, string>();

	// Build card-token → handle map so card references like "Karakas WLs Magus"
	// resolve to the decks' owners.
	const submissions = getSubmissionsForRound(db, roundId);
	const cardOwners = buildCardOwnerMap(
		submissions.map((s) => ({
			playerHandle: getPlayer(db, s.playerDid)?.handle ?? s.playerDid,
			cards: [s.card1Name, s.card2Name, s.card3Name],
		})),
	);

	const processReply = (reply: ThreadReply) => {
		// Check for confirmation first (before correction parsing skips it)
		if (isConfirmation(reply.text)) {
			// Look up which correction this confirms via parentUri
			if (reply.parentUri) {
				const matchupKey = correctionUriToMatchup.get(reply.parentUri);
				if (matchupKey && !dryRun) {
					const matchup = findMatchupByKey(db, roundId, matchupKey, allHandles);
					if (matchup) {
						const old = matchup.reviewStatus;
						if (old !== "reviewed") {
							setReviewStatus(db, matchup.id, "reviewed");
							result.reviewStatusChanges.push({
								matchupKey,
								oldStatus: old,
								newStatus: "reviewed",
								reason: `confirmed by @${reply.authorHandle}`,
							});
						}
					}
				}
				result.confirmations++;
				return;
			}
			result.skipped++;
			return;
		}

		const corrections = parseCorrections(
			reply.text,
			reply.authorHandle,
			reply.uri,
			allHandles,
			cardOwners,
		);

		if (corrections.length === 0) {
			result.skipped++;
			return;
		}

		for (const correction of corrections) {
			result.parsed.push(correction);

			const matchupKey = [correction.playerA, correction.playerB]
				.sort()
				.join("|");

			// Register this reply URI as a correction for confirmation tracking
			correctionUriToMatchup.set(reply.uri, matchupKey);

			const existing = touched.get(matchupKey);
			if (existing) {
				// Same verdict → skip silently
				const { play, draw } = correctionToVerdicts(correction.verdict);
				if (existing.play === play && existing.draw === draw) {
					continue;
				}
				// Conflicting → flag as disputed
				result.flaggedForReview.push(
					`${correction.playerA} vs ${correction.playerB}: conflicting correction from @${correction.authorHandle} (${correction.verdict} vs existing ${existing.play}${existing.draw}) — marked disputed`,
				);
				if (!dryRun) {
					const matchup = findMatchupByKey(db, roundId, matchupKey, allHandles);
					if (matchup && matchup.reviewStatus !== "disputed") {
						setReviewStatus(db, matchup.id, "disputed");
						result.reviewStatusChanges.push({
							matchupKey,
							oldStatus: matchup.reviewStatus,
							newStatus: "disputed",
							reason: `conflicting: @${correction.authorHandle} says ${correction.verdict}, existing ${existing.play}${existing.draw}`,
						});
					}
				}
				continue;
			}

			// First correction on this matchup → apply
			const { play, draw } = correctionToVerdicts(correction.verdict);
			const update: RoundUpdate = {
				matchup: [correction.playerA, correction.playerB],
				play,
				draw,
				source: {
					type: "bsky",
					uri: correction.sourceUri,
					date: reply.indexedAt,
					context: `auto-harvested from @${correction.authorHandle}`,
				},
				reason: correction.reason,
				status: "pending",
			};

			if (!dryRun) {
				appendUpdate(roundId, update);
			}
			touched.set(matchupKey, {
				play,
				draw,
				sourceUri: correction.sourceUri,
				authorHandle: correction.authorHandle,
			});
			result.applied++;
		}
	};

	// Poll each thread, sharing state across them
	for (const uri of threadUris) {
		const watchResult = await watchThread(agent, uri, processReply, {
			botDid,
			dryRun,
		});
		result.errors.push(...watchResult.likeErrors);
	}

	// Apply all pending updates + set review_status on applied matchups
	if (!dryRun && result.applied > 0) {
		const applyResult = applyUpdates(db, roundId);
		if (applyResult.errors.length > 0) {
			result.errors.push(...applyResult.errors);
		}
		// Mark newly-corrected matchups as reviewed
		for (const [key, touch] of touched) {
			const matchup = findMatchupByKey(db, roundId, key, allHandles);
			if (matchup && matchup.reviewStatus === "unreviewed") {
				setReviewStatus(db, matchup.id, "reviewed");
				result.reviewStatusChanges.push({
					matchupKey: key,
					oldStatus: "unreviewed",
					newStatus: "reviewed",
					reason: `correction applied from @${touch.authorHandle}`,
				});
			}
		}
	}

	return result;
}

/** Find a matchup by sorted handle key. Resolves handles to DIDs via the players table. */
function findMatchupByKey(
	db: Database.Database,
	roundId: number,
	sortedKey: string,
	allHandles: readonly string[],
): { id: number; reviewStatus: ReviewStatus } | undefined {
	const [handleA, handleB] = sortedKey.split("|");
	if (!handleA || !handleB) return undefined;

	// Resolve handles to DIDs
	const rowA = db
		.prepare("SELECT did FROM players WHERE handle = ?")
		.get(handleA) as { did: string } | undefined;
	const rowB = db
		.prepare("SELECT did FROM players WHERE handle = ?")
		.get(handleB) as { did: string } | undefined;
	if (!rowA || !rowB) return undefined;

	const row = db
		.prepare(
			`SELECT id, review_status FROM matchups WHERE round_id = ? AND (
				(player0_did = ? AND player1_did = ?) OR
				(player0_did = ? AND player1_did = ?)
			)`,
		)
		.get(roundId, rowA.did, rowB.did, rowB.did, rowA.did) as
		| { id: number; review_status: string }
		| undefined;
	if (!row) return undefined;

	return {
		id: row.id,
		reviewStatus: (row.review_status as ReviewStatus) ?? "unreviewed",
	};
}

// pattern: Functional Core

// Formats round results into Bluesky post text.
// Post limit is 300 graphemes. Long content splits across thread posts.

import type { DbMatchup, DbSubmission } from "./database.js";
import type { StandingsEntry } from "./round-lifecycle.js";

const MAX_POST_LENGTH = 300;

/** Format the reveal post showing all players' decks. */
export function formatRevealPost(
	roundId: number,
	submissions: readonly DbSubmission[],
	handleMap: ReadonlyMap<string, string>,
): string[] {
	const header = `🎴 Round ${roundId} — Reveal!\n\n`;
	const lines: string[] = [];

	for (const sub of submissions) {
		const handle = handleMap.get(sub.playerDid) ?? sub.playerDid;
		lines.push(
			`@${handle}: ${sub.card1Name}, ${sub.card2Name}, ${sub.card3Name}`,
		);
	}

	return splitIntoPosts(header, lines);
}

/** Format matchup results for posting. */
export function formatMatchupResults(
	roundId: number,
	matchups: readonly DbMatchup[],
	handleMap: ReadonlyMap<string, string>,
): string[] {
	const header = `⚔️ Round ${roundId} — Results\n\n`;
	const lines: string[] = [];

	for (const m of matchups) {
		const h0 = handleMap.get(m.player0Did) ?? "?";
		const h1 = handleMap.get(m.player1Did) ?? "?";
		const outcome = formatOutcome(m);
		lines.push(`@${h0} vs @${h1}: ${outcome}`);
	}

	return splitIntoPosts(header, lines);
}

/** Format standings table. */
export function formatStandings(
	roundId: number,
	standings: readonly StandingsEntry[],
	handleMap: ReadonlyMap<string, string>,
): string {
	const lines = [`🏆 Round ${roundId} — Standings\n`];

	for (let i = 0; i < standings.length; i++) {
		const entry = standings[i];
		if (!entry) continue;
		const handle = handleMap.get(entry.playerDid) ?? "?";
		const record = `${entry.wins}W-${entry.losses}L-${entry.draws}D`;
		const unresolved = entry.unresolved > 0 ? ` (${entry.unresolved}?)` : "";
		lines.push(
			`${i + 1}. @${handle} — ${entry.points}pts (${record})${unresolved}`,
		);
	}

	return lines.join("\n");
}

/** Format a single unresolved matchup for judge review. */
export function formatUnresolvedMatchup(
	matchup: DbMatchup,
	handleMap: ReadonlyMap<string, string>,
): string {
	const h0 = handleMap.get(matchup.player0Did) ?? "?";
	const h1 = handleMap.get(matchup.player1Did) ?? "?";
	const reason = matchup.unresolvedReason ?? "unknown";
	return `❓ @${h0} vs @${h1}\n\nNeeds judge: ${reason}\n\nReply with: p0 wins, p1 wins, or draw`;
}

function formatOutcome(m: DbMatchup): string {
	if (m.judgeResolution) {
		const label =
			m.judgeResolution === "player0_wins"
				? "P0 wins"
				: m.judgeResolution === "player1_wins"
					? "P1 wins"
					: "Draw";
		return `${label} (judged)`;
	}
	switch (m.outcome) {
		case "player0_wins":
			return "P0 wins";
		case "player1_wins":
			return "P1 wins";
		case "draw":
			return "Draw";
		case "unresolved":
			return "❓ (needs judge)";
		default:
			return m.outcome;
	}
}

/** Split content into multiple posts if it exceeds the character limit. */
function splitIntoPosts(header: string, lines: string[]): string[] {
	const posts: string[] = [];
	let current = header;

	for (const line of lines) {
		const candidate = `${current}${line}\n`;
		if (candidate.length > MAX_POST_LENGTH && current !== header) {
			posts.push(current.trimEnd());
			current = `${line}\n`;
		} else {
			current = candidate;
		}
	}

	if (current.trim().length > 0) {
		posts.push(current.trimEnd());
	}

	return posts;
}

// pattern: imperative-shell
// Post preliminary standings for a round to Bluesky.
// Generates a thread: header → ranked standings → corrections-window → mention blasts.
// Stores the root post URI as standings_thread_uri so the harvester monitors it.
// Auto-detects ties at the top and adapts the header line.
// Usage: npx tsx src/scripts/post-standings.ts <round-id> [--dry-run]

import { RichText } from "@atproto/api";
import { createAgent, graphemeLength } from "propter-bsky-kit";
import {
	createDatabase,
	getPlayer,
	getSubmissionsForRound,
} from "../database.ts";

interface StandingsRow {
	handle: string;
	did: string;
	pts: number;
}

interface PostRef {
	uri: string;
	cid: string;
}

const DASHBOARD_URL = "proptermalone.github.io/3cblue/";
const CORRECTIONS_TEXT =
	"Corrections open through Tuesday evening. Reply to this thread (or any matchup on the dashboard) with disputes — agents will re-evaluate flagged matchups.\n\nFinal results + next round signups go up after corrections close.";

async function main() {
	const roundId = Number.parseInt(process.argv[2] ?? "", 10);
	if (!Number.isFinite(roundId)) {
		console.error("usage: post-standings.ts <round-id> [--dry-run]");
		process.exit(1);
	}
	const dryRun = process.argv.includes("--dry-run");

	const db = createDatabase("data/3cblue.db");

	const standings = db
		.prepare(
			`
		SELECT p.handle, p.did,
			SUM(CASE
				WHEN m.player0_did = p.did THEN
					CASE m.on_play_verdict WHEN 'W' THEN 3 WHEN 'D' THEN 1 ELSE 0 END +
					CASE m.on_draw_verdict WHEN 'W' THEN 3 WHEN 'D' THEN 1 ELSE 0 END
				ELSE
					CASE m.on_play_verdict WHEN 'L' THEN 3 WHEN 'D' THEN 1 ELSE 0 END +
					CASE m.on_draw_verdict WHEN 'L' THEN 3 WHEN 'D' THEN 1 ELSE 0 END
			END) as pts
		FROM players p
		JOIN submissions s ON s.player_did = p.did AND s.round_id = ?
		JOIN matchups m ON m.round_id = ? AND (m.player0_did = p.did OR m.player1_did = p.did)
		GROUP BY p.did
		ORDER BY pts DESC
	`,
		)
		.all(roundId, roundId) as StandingsRow[];

	if (standings.length === 0) {
		console.error(`no standings for round ${roundId} — has it been resolved?`);
		db.close();
		process.exit(1);
	}

	// Build header — auto-detect ties at the top
	const topScore = standings[0]!.pts;
	const tied = standings.filter((s) => s.pts === topScore);
	const header = buildHeader(roundId, tied);

	// Build ranked standings lines
	const standingsLines: string[] = [];
	for (let i = 0; i < standings.length; i++) {
		const s = standings[i]!;
		// All players tied for #1 get gold medal; others get numeric rank
		const rank = s.pts === topScore ? "🥇" : `${i + 1}.`;
		standingsLines.push(`${rank} @${s.handle} — ${s.pts} pts`);
	}

	// Pack standings lines into ≤295-grapheme posts
	const allPosts: string[] = [header];
	let current = "";
	for (const line of standingsLines) {
		const candidate = current ? `${current}\n${line}` : line;
		if (graphemeLength(candidate) > 295 && current) {
			allPosts.push(current);
			current = line;
		} else {
			current = candidate;
		}
	}
	if (current) allPosts.push(current);
	allPosts.push(CORRECTIONS_TEXT);

	// Build mention blast(s) — chunk handles to fit grapheme limit
	const subs = getSubmissionsForRound(db, roundId);
	const handles = subs.map((s) => {
		const p = getPlayer(db, s.playerDid);
		return `@${p?.handle ?? s.playerDid}`;
	});
	const mentionPosts: string[] = [];
	for (let i = 0; i < handles.length; i += 10) {
		mentionPosts.push(handles.slice(i, i + 10).join(" "));
	}

	console.log(`Round ${roundId}: ${standings.length} players, ${allPosts.length} thread posts + ${mentionPosts.length} mention blasts`);
	for (let i = 0; i < allPosts.length; i++) {
		console.log(
			`\n--- Post ${i + 1} (${graphemeLength(allPosts[i]!)} graphemes) ---`,
		);
		console.log(allPosts[i]);
	}
	for (let i = 0; i < mentionPosts.length; i++) {
		console.log(
			`\n--- Mention ${i + 1} (${graphemeLength(mentionPosts[i]!)} graphemes) ---`,
		);
		console.log(mentionPosts[i]);
	}

	if (dryRun) {
		console.log("\nDry run — pass without --dry-run to post");
		db.close();
		return;
	}

	const agent = await createAgent({
		identifier: process.env.BSKY_IDENTIFIER!,
		password: process.env.BSKY_PASSWORD!,
	});

	const rt0 = new RichText({ text: allPosts[0]! });
	await rt0.detectFacets(agent);
	const first = await agent.post({ text: rt0.text, facets: rt0.facets });
	const rootRef: PostRef = { uri: first.uri, cid: first.cid };
	console.log(`\nPosted 1/${allPosts.length}: ${first.uri}`);

	let parent: PostRef = rootRef;
	for (let i = 1; i < allPosts.length; i++) {
		await new Promise((r) => setTimeout(r, 1500));
		const rt = new RichText({ text: allPosts[i]! });
		await rt.detectFacets(agent);
		const result = await agent.post({
			text: rt.text,
			facets: rt.facets,
			reply: { root: rootRef, parent },
		});
		parent = { uri: result.uri, cid: result.cid };
		console.log(`Posted ${i + 1}/${allPosts.length}: ${result.uri}`);
	}

	for (const text of mentionPosts) {
		await new Promise((r) => setTimeout(r, 1500));
		const rt = new RichText({ text });
		await rt.detectFacets(agent);
		const result = await agent.post({
			text: rt.text,
			facets: rt.facets,
			reply: { root: rootRef, parent },
		});
		parent = { uri: result.uri, cid: result.cid };
		console.log(`Posted mention: ${result.uri}`);
	}

	db.prepare("UPDATE rounds SET standings_thread_uri = ? WHERE id = ?").run(
		rootRef.uri,
		roundId,
	);
	console.log(`\nStored standings_thread_uri: ${rootRef.uri}`);
	db.close();
}

function buildHeader(roundId: number, tied: StandingsRow[]): string {
	const intro = `Round ${roundId} — Preliminary Results`;
	const link = `Full results + per-matchup narratives:\n\n${DASHBOARD_URL}`;

	if (tied.length === 1) {
		return `${intro}\n\n@${tied[0]!.handle} takes the top spot with ${tied[0]!.pts} points. ${link}`;
	}
	if (tied.length === 2) {
		return `${intro}\n\n@${tied[0]!.handle} & @${tied[1]!.handle} tied at the top with ${tied[0]!.pts} points each. ${link}`;
	}
	// 3+ way tie
	const handles = tied.map((t) => `@${t.handle}`).join(", ");
	return `${intro}\n\n${tied.length}-way tie at the top (${tied[0]!.pts} pts each): ${handles}. ${link}`;
}

main();

// pattern: imperative-shell
// Auto-close round when submission deadline passes.
// Transitions phase, posts decklists to Bluesky, stores post_uri, tags participants.
// Designed to run from cron every few minutes. No-ops if deadline hasn't passed or already closed.
// Usage: npx tsx src/scripts/auto-close-round.ts [--dry-run]

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { RichText } from "@atproto/api";
import { createAgent, graphemeLength } from "propter-bsky-kit";
import {
	createDatabase,
	getActiveRound,
	getPlayer,
	getSubmissionsForRound,
	updateRoundPhase,
	updateRoundPostUri,
} from "../database.ts";
import { isRoundPastDeadline } from "../round-lifecycle.ts";

const dryRun = process.argv.includes("--dry-run");

async function main() {
	const db = createDatabase("data/3cblue.db");
	const round = getActiveRound(db);
	if (!round) {
		console.log("no active round");
		db.close();
		return;
	}

	if (!isRoundPastDeadline(round)) {
		console.log(
			`round ${round.id} deadline not reached (${round.submissionDeadline})`,
		);
		db.close();
		return;
	}

	// Already closed — post_uri means decklists already posted
	if (round.postUri) {
		console.log(`round ${round.id} already has post_uri — skipping`);
		db.close();
		return;
	}

	const subs = getSubmissionsForRound(db, round.id);
	if (subs.length === 0) {
		console.log("no submissions — skipping auto-close");
		db.close();
		return;
	}

	console.log(
		`round ${round.id}: deadline passed, ${subs.length} submissions — closing`,
	);

	// Build decklist posts
	const header = `Round ${round.id} — Deck Reveal\n\n${subs.length} players submitted. Results coming soon.`;

	const deckLines: string[] = [];
	const handles: string[] = [];
	for (const s of subs) {
		const p = getPlayer(db, s.playerDid);
		const handle = p?.handle ?? s.playerDid;
		handles.push(`@${handle}`);
		deckLines.push(
			`@${handle}: ${s.card1Name}, ${s.card2Name}, ${s.card3Name}`,
		);
	}

	// Split deck lines into posts respecting 300 grapheme limit
	const allPosts: string[] = [header];
	let current = "";
	for (const line of deckLines) {
		const candidate = current ? `${current}\n${line}` : line;
		if (graphemeLength(candidate) > 295 && current) {
			allPosts.push(current);
			current = line;
		} else {
			current = candidate;
		}
	}
	if (current) allPosts.push(current);

	// Build mention blast posts (~10 handles per post)
	const mentionPosts: string[] = [];
	for (let i = 0; i < handles.length; i += 10) {
		const chunk = handles.slice(i, i + 10);
		const text =
			i === 0
				? `Decklists are up! Good luck everyone\n\n${chunk.join(" ")}`
				: chunk.join(" ");
		mentionPosts.push(text);
	}

	console.log(`\n${allPosts.length} decklist posts + ${mentionPosts.length} mention posts`);
	for (let i = 0; i < allPosts.length; i++) {
		console.log(
			`\n--- Decklist ${i + 1} (${graphemeLength(allPosts[i]!)} graphemes) ---`,
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
		console.log("\nDry run — would transition to resolution and post above");
		db.close();
		return;
	}

	// Transition phase
	updateRoundPhase(db, round.id, "resolution");
	console.log("\nAdvanced round to resolution phase");

	// Post to Bluesky
	const agent = await createAgent({
		identifier: process.env.BSKY_IDENTIFIER!,
		password: process.env.BSKY_PASSWORD!,
	});

	interface PostRef {
		uri: string;
		cid: string;
	}

	const rt0 = new RichText({ text: allPosts[0]! });
	await rt0.detectFacets(agent);
	const first = await agent.post({ text: rt0.text, facets: rt0.facets });
	const rootRef: PostRef = { uri: first.uri, cid: first.cid };
	console.log(`Posted 1/${allPosts.length}: ${first.uri}`);

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

	// Mention blast
	for (const mentionText of mentionPosts) {
		await new Promise((r) => setTimeout(r, 1500));
		const rt = new RichText({ text: mentionText });
		await rt.detectFacets(agent);
		const result = await agent.post({
			text: rt.text,
			facets: rt.facets,
			reply: { root: rootRef, parent },
		});
		parent = { uri: result.uri, cid: result.cid };
		console.log(`Posted mention blast: ${result.uri}`);
	}

	// Store post_uri on round — enables correction harvester
	updateRoundPostUri(db, round.id, rootRef.uri);
	console.log(`\nStored post_uri: ${rootRef.uri}`);

	// Queue Phyllis task for overnight resolution
	queuePhyllisResolution(round.id, subs.length);

	db.close();
	console.log("Done — decklists posted, round closed, resolution queued");
}

function queuePhyllisResolution(roundId: number, subCount: number): void {
	const matchupCount = (subCount * (subCount - 1)) / 2;
	const prompt = `You are running unattended. Do not ask for confirmation.

TASK: Resolve Round ${roundId} of Three Card Blind.
Read /home/karl/Projects/3cblue/.claude/commands/resolve-round.md for the full procedure and follow it from Step 1, with these overrides for unattended operation:

WORKING DIRECTORY: /home/karl/Projects/3cblue
DATABASE: /home/karl/Projects/3cblue/data/3cblue.db
EXPECTED: ${subCount} submissions, ${matchupCount} matchups

UNATTENDED OVERRIDES:
- Step 2c (deck plan review): Generate deck plans, save to /tmp/r${roundId}-deck-plans.json, proceed without human review.
- Step 5 (disagreements): Do NOT ask the user. For each disagreement, spawn a single tiebreaker Agent (Opus model, foreground) with both agents' full reasoning and ask it to determine the correct verdict. Use the tiebreaker's verdict. Log the disagreement and tiebreaker reasoning in /tmp/r${roundId}-resolution-summary.md.
- Step 7 (Bluesky posting): Skip Bluesky posting entirely — just generate the dashboard HTML, commit, and push to GitHub Pages.
- Step 8-9 (corrections/finalize): Skip — leave round in resolution phase.

ENVIRONMENT: Run \`set -a && source /home/karl/Projects/3cblue/.env && set +a\` before any script that needs env vars.

After all matchups are written to DB, write a summary to /tmp/r${roundId}-resolution-summary.md covering: total matchups, historical vs LLM-evaluated vs deduped breakdown, any disagreements and how they were resolved, and final standings.`;

	const preflight = `sqlite3 /home/karl/Projects/3cblue/data/3cblue.db "SELECT count(*) FROM matchups WHERE round_id = ${roundId}" | grep -q '^[1-9]'`;

	try {
		execFileSync(
			"node",
			[
				"--import", "tsx", "src/cli.ts",
				"queue", "add",
				"--name", `3CB R${roundId} resolution`,
				"--size", "XL",
				"--dir", "/home/karl/Projects/3cblue",
				"--priority", "1",
				"--preflight", preflight,
				"--prompt", prompt,
			],
			{ cwd: "/home/karl/Projects/phyllis", stdio: "pipe" },
		);
		console.log(`Queued Phyllis task: 3CB R${roundId} resolution (XL, priority 1)`);
	} catch (err) {
		// Save prompt so it can be queued manually
		const promptFile = `/tmp/r${roundId}-phyllis-prompt.txt`;
		writeFileSync(promptFile, prompt);
		console.error("Failed to queue Phyllis task:", (err as Error).message);
		console.error(`Prompt saved to ${promptFile} — queue manually`);
	}
}

main();

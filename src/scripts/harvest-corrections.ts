// Run one correction harvest pass for the active round.
// Usage: npx tsx src/scripts/harvest-corrections.ts [--dry-run]
// Reads the reveal thread, parses corrections, applies them, likes replies,
// regenerates dashboard, and pushes to GitHub Pages.

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createAgent } from "propter-bsky-kit";
import { harvestCorrections } from "../correction-harvester.ts";
import { generateDashboardHtml } from "../dashboard-html.ts";
import {
	createDatabase,
	getActiveRound,
	getMatchupsForRound,
	getPlayer,
	getSubmissionsForRound,
	getWinnerBans,
} from "../database.ts";
import { computeStandings } from "../round-lifecycle.ts";

const dryRun = process.argv.includes("--dry-run");

async function main() {
	const db = createDatabase("data/3cblue.db");
	const round = getActiveRound(db);
	if (!round) {
		console.log("no active round");
		return;
	}

	const subs = getSubmissionsForRound(db, round.id);
	const allHandles = subs.map((s) => {
		const p = getPlayer(db, s.playerDid);
		return p?.handle ?? s.playerDid;
	});

	// Gather thread URIs to monitor (reveal + standings)
	const threadUris = [round.postUri, round.standingsThreadUri].filter(
		Boolean,
	) as string[];
	if (threadUris.length === 0) {
		console.log(
			"no thread URIs on round — set post_uri or standings_thread_uri first",
		);
		return;
	}

	const agent = await createAgent({
		identifier: process.env.BSKY_IDENTIFIER!,
		password: process.env.BSKY_PASSWORD!,
	});

	const botDid = agent.session?.did;
	if (!botDid) {
		console.log("failed to get bot DID from session");
		return;
	}

	console.log(
		`[harvest] round ${round.id}, ${subs.length} players, ${threadUris.length} thread(s)`,
	);
	if (dryRun) console.log("[harvest] DRY RUN — no changes will be made");

	const result = await harvestCorrections(
		agent,
		db,
		round.id,
		threadUris,
		allHandles,
		botDid,
		dryRun,
	);

	console.log(
		`[harvest] parsed: ${result.parsed.length}, applied: ${result.applied}, confirmations: ${result.confirmations}, skipped: ${result.skipped}`,
	);
	for (const c of result.parsed) {
		console.log(
			`  ${c.playerA} vs ${c.playerB}: ${c.verdict} (by @${c.authorHandle})`,
		);
	}
	if (result.reviewStatusChanges.length > 0) {
		console.log("[harvest] REVIEW STATUS CHANGES:");
		for (const c of result.reviewStatusChanges)
			console.log(
				`  ${c.matchupKey}: ${c.oldStatus} → ${c.newStatus} (${c.reason})`,
			);
	}
	if (result.flaggedForReview.length > 0) {
		console.log("[harvest] FLAGGED FOR HUMAN REVIEW:");
		for (const f of result.flaggedForReview) console.log(`  ${f}`);
	}
	if (result.errors.length > 0) {
		console.log("[harvest] ERRORS:");
		for (const e of result.errors) console.log(`  ${e}`);
	}

	// Regenerate dashboard if corrections applied or review statuses changed
	const needsRegen =
		result.applied > 0 || result.reviewStatusChanges.length > 0;
	if (needsRegen && !dryRun) {
		console.log("[harvest] regenerating dashboard...");
		const matchups = getMatchupsForRound(db, round.id);
		const standings = computeStandings(db, round.id);
		const bannedCards = getWinnerBans(db);
		const players = new Map<
			string,
			{ handle: string; cards: [string, string, string] }
		>();
		for (const sub of subs) {
			const player = getPlayer(db, sub.playerDid);
			players.set(sub.playerDid, {
				handle: player?.handle ?? sub.playerDid.slice(0, 16),
				cards: [sub.card1Name, sub.card2Name, sub.card3Name],
			});
		}
		const html = generateDashboardHtml({
			round: {
				id: round.id,
				phase: round.phase,
				deadline: null,
				submissionCount: subs.length,
			},
			standings,
			matchups,
			players,
			bannedCards,
		});
		writeFileSync("docs/index.html", html);

		// Git push
		try {
			execSync(
				'git add docs/index.html data/round-updates/ && git commit -m "fix: auto-apply community corrections" && git push origin main',
				{ stdio: "pipe" },
			);
			console.log("[harvest] dashboard pushed to GitHub Pages");
		} catch (err: any) {
			console.log(`[harvest] git push failed: ${err.message}`);
		}
	}

	db.close();
}

main();

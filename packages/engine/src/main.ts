// pattern: Imperative Shell

// Entry point for the 3CBlue bot.

import { type BotConfig, ThreeCBlueBot } from "./bluesky-bot.js";
import { createAgent } from "./bot.js";
import { generateDashboardFromDb } from "./dashboard-html.js";
import {
	addJudge,
	createDatabase,
	createRound,
	getActiveRound,
	getMatchupsForRound,
	getRound,
	getSubmissionsForRound,
	getUnresolvedMatchups,
	updateRoundPostUri,
} from "./database.js";
import { formatAnnouncementPost } from "./post-formatter.js";
import { finalizeRound } from "./round-lifecycle.js";

function loadConfig(): BotConfig {
	const service = process.env.BSKY_SERVICE ?? "https://bsky.social";
	const identifier = process.env.BSKY_IDENTIFIER;
	const password = process.env.BSKY_PASSWORD;
	const dbPath = process.env.DB_PATH ?? "./3cblue.db";
	const pollIntervalMs = Number.parseInt(
		process.env.POLL_INTERVAL_MS ?? "10000",
		10,
	);

	if (!identifier || !password) {
		console.error(
			"[cli] missing BSKY_IDENTIFIER and/or BSKY_PASSWORD environment variables",
		);
		process.exit(1);
	}

	return { service, identifier, password, dbPath, pollIntervalMs };
}

async function main(): Promise<void> {
	// Commands that don't need Bluesky credentials
	const command = process.argv[2];
	if (command === "dashboard") {
		const dbPath = process.env.DB_PATH ?? "./3cblue.db";
		const db = createDatabase(dbPath);
		const html = generateDashboardFromDb(db);
		process.stdout.write(html);
		db.close();
		return;
	}

	const config = loadConfig();
	const db = createDatabase(config.dbPath);
	const agent = await createAgent({
		identifier: config.identifier,
		password: config.password,
	});

	const bot = new ThreeCBlueBot(agent, db, config);

	switch (command) {
		case "start": {
			const hours = Number.parseInt(process.argv[3] ?? "24", 10);
			const round = createRound(db, hours);
			console.log(
				`[cli] created round ${round.id} (deadline: ${round.submissionDeadline})`,
			);
			if (round.submissionDeadline) {
				const text = formatAnnouncementPost(
					round.id,
					new Date(round.submissionDeadline),
				);
				const uri = await bot.postAnnouncement(text);
				if (uri) {
					updateRoundPostUri(db, round.id, uri);
					console.log(`[cli] announcement posted: ${uri}`);
				} else {
					console.error("[cli] failed to post announcement");
				}
			}
			return;
		}
		case "add-judge": {
			const did = process.argv[3];
			if (!did) {
				console.error("[cli] usage: add-judge <did>");
				process.exit(1);
			}
			addJudge(db, did);
			console.log(`[cli] added judge: ${did}`);
			return;
		}
		case "status": {
			const round = getActiveRound(db);
			if (!round) {
				console.log("[cli] no active round");
				return;
			}
			const submissions = getSubmissionsForRound(db, round.id);
			const matchups = getMatchupsForRound(db, round.id);
			const unresolved = matchups.filter(
				(m) => m.outcome === "unresolved" && !m.judgeResolution,
			);
			console.log(`[cli] round ${round.id}`);
			console.log(`  phase: ${round.phase}`);
			console.log(`  deadline: ${round.submissionDeadline ?? "none"}`);
			console.log(`  submissions: ${submissions.length}`);
			console.log(`  matchups: ${matchups.length}`);
			if (unresolved.length > 0) {
				console.log(`  unresolved: ${unresolved.length}`);
			}
			return;
		}
		case "finalize": {
			const roundIdArg = process.argv[3]
				? Number.parseInt(process.argv[3], 10)
				: undefined;
			const targetRound = roundIdArg
				? getRound(db, roundIdArg)
				: getActiveRound(db);
			if (!targetRound) {
				console.error("[cli] no round found");
				process.exit(1);
			}
			const unresolved = getUnresolvedMatchups(db, targetRound.id);
			if (unresolved.length > 0) {
				console.error(
					`[cli] round ${targetRound.id} has ${unresolved.length} unresolved matchups — resolve those first`,
				);
				process.exit(1);
			}
			const result = finalizeRound(db, targetRound.id);
			console.log(
				`[cli] round ${targetRound.id} finalized — ${result.winnersFound} winner(s), banned: ${result.cardsBanned.join(", ") || "none"}`,
			);
			return;
		}
		case "post-results": {
			const round = getActiveRound(db);
			if (!round) {
				console.error("[cli] no active round");
				process.exit(1);
			}
			if (round.phase !== "complete" && round.phase !== "judging") {
				console.error(
					`[cli] round ${round.id} is in ${round.phase} phase — resolve first`,
				);
				process.exit(1);
			}
			// Auto-finalize if not yet complete (bans + phase transition)
			if (round.phase !== "complete") {
				const fin = finalizeRound(db, round.id);
				console.log(
					`[cli] auto-finalized round ${round.id} — banned: ${fin.cardsBanned.join(", ") || "none"}`,
				);
			}
			console.log(`[cli] posting results for round ${round.id}...`);
			const uri = await bot.postResults(round.id);
			if (uri) {
				console.log(`[cli] results posted: ${uri}`);
			} else {
				console.error("[cli] failed to post results");
			}
			await bot.postLeaderboard();
			console.log("[cli] leaderboard posted");
			return;
		}
		default:
			break;
	}

	// Start the bot
	console.log("[bot] starting 3CBlue bot...");
	await bot.start();
}

main().catch((err) => {
	console.error("[cli] fatal:", err);
	process.exit(1);
});

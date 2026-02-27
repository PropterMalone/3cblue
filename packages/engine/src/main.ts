// pattern: Imperative Shell

// Entry point for the 3CBlue bot.

import { type BotConfig, ThreeCBlueBot } from "./bluesky-bot.js";
import { createAgent } from "./bot.js";
import {
	addJudge,
	createDatabase,
	createRound,
	getActiveRound,
	getMatchupsForRound,
	getSubmissionsForRound,
	updateRoundPostUri,
} from "./database.js";
import { formatAnnouncementPost } from "./post-formatter.js";

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
	const config = loadConfig();
	const db = createDatabase(config.dbPath);
	const agent = await createAgent({
		identifier: config.identifier,
		password: config.password,
	});

	const bot = new ThreeCBlueBot(agent, db, config);

	// CLI commands for round management
	const command = process.argv[2];
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

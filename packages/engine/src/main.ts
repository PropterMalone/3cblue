// pattern: Imperative Shell

// Entry point for the 3CBlue bot.

import { AtpAgent } from "@atproto/api";
import { type BotConfig, ThreeCBlueBot } from "./bluesky-bot.js";
import { addJudge, createDatabase, createRound } from "./database.js";

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
			"missing BSKY_IDENTIFIER and/or BSKY_PASSWORD environment variables",
		);
		process.exit(1);
	}

	return { service, identifier, password, dbPath, pollIntervalMs };
}

async function main(): Promise<void> {
	const config = loadConfig();
	const db = createDatabase(config.dbPath);
	const agent = new AtpAgent({ service: config.service });

	const bot = new ThreeCBlueBot(agent, db, config);

	// CLI commands for round management
	const command = process.argv[2];
	switch (command) {
		case "start": {
			const hours = Number.parseInt(process.argv[3] ?? "24", 10);
			const round = createRound(db, hours);
			console.log(
				`created round ${round.id} (deadline: ${round.submissionDeadline})`,
			);
			return;
		}
		case "add-judge": {
			const did = process.argv[3];
			if (!did) {
				console.error("usage: add-judge <did>");
				process.exit(1);
			}
			addJudge(db, did);
			console.log(`added judge: ${did}`);
			return;
		}
		default:
			break;
	}

	// Start the bot
	console.log("starting 3CBlue bot...");
	await bot.start();
}

main().catch((err) => {
	console.error("fatal:", err);
	process.exit(1);
});

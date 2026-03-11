// pattern: Imperative Shell

// Bluesky bot for 3CBlue. Handles DMs (deck submissions, judge commands).
// All posting (reveals, results, standings) is done manually via scripts.

import type { AtpAgent } from "@atproto/api";
import type Database from "better-sqlite3";
import {
	createBlueskyDmSender,
	createChatAgent,
	pollInboundDms,
} from "./bot.js";
import type { DmSender } from "./bot.js";
import {
	getActiveRound,
	getBotState,
	getPlayer,
	isJudge,
	isWinnerBanned,
	resolveMatchup,
	setBotState,
	upsertPlayer,
	upsertSubmission,
} from "./database.js";
import { parseCardNames, validateDeck } from "./deck-validation.js";
import { isRoundPastDeadline } from "./round-lifecycle.js";

export interface BotConfig {
	service: string;
	identifier: string;
	password: string;
	dbPath: string;
	pollIntervalMs: number;
}

export class ThreeCBlueBot {
	private agent: AtpAgent;
	private dm: DmSender;
	private db: Database.Database;
	private config: BotConfig;
	private dmMessageId: string | undefined;
	private running = false;
	private deadlineLogged = false;

	constructor(agent: AtpAgent, db: Database.Database, config: BotConfig) {
		this.agent = agent;
		const chatAgent = createChatAgent(agent);
		this.dm = createBlueskyDmSender(chatAgent);
		this.db = db;
		this.config = config;
		// Restore DM cursor from DB so restarts don't reprocess old messages
		this.dmMessageId = getBotState(db, "dm_cursor") ?? undefined;
	}

	async start(): Promise<void> {
		this.running = true;
		this.poll();
	}

	stop(): void {
		this.running = false;
	}

	private async poll(): Promise<void> {
		while (this.running) {
			try {
				await this.checkDirectMessages();
				this.checkRoundDeadlines();
			} catch (err) {
				console.error("[bot] poll error:", err);
			}
			await new Promise((resolve) =>
				setTimeout(resolve, this.config.pollIntervalMs),
			);
		}
	}

	private checkRoundDeadlines(): void {
		if (this.deadlineLogged) return;
		const round = getActiveRound(this.db);
		if (!round || !isRoundPastDeadline(round)) return;

		console.log(
			`[round] round ${round.id} deadline passed — waiting for manual resolution`,
		);
		this.deadlineLogged = true;
	}

	private async checkDirectMessages(): Promise<void> {
		const chatAgent = createChatAgent(this.agent);
		const { messages, latestMessageId } = await pollInboundDms(
			chatAgent,
			this.dmMessageId,
		);

		const botDid = this.agent.did;
		for (const msg of messages) {
			// Defense in depth: skip our own messages even if pollInboundDms missed them
			if (msg.senderDid === botDid) continue;
			console.log(
				`[dm] inbound from ${msg.senderDid}: ${msg.text.slice(0, 80)}`,
			);
			await this.handleDirectMessage(msg.senderDid, msg.text);
		}

		if (latestMessageId) {
			this.dmMessageId = latestMessageId;
			setBotState(this.db, "dm_cursor", latestMessageId);
		}
	}

	private async handleDirectMessage(
		senderDid: string,
		text: string,
	): Promise<void> {
		const trimmed = text.trim().toLowerCase();

		// Judge resolution command
		if (trimmed.startsWith("judge ")) {
			await this.handleJudgeCommand(senderDid, text);
			return;
		}

		// Treat as deck submission
		await this.handleDeckSubmission(senderDid, text);
	}

	private async handleDeckSubmission(
		senderDid: string,
		text: string,
	): Promise<void> {
		const round = getActiveRound(this.db);
		if (!round) {
			await this.dm.sendDm(
				senderDid,
				"no active round right now. wait for the next one!",
			);
			return;
		}
		if (round.phase !== "submission") {
			await this.dm.sendDm(
				senderDid,
				`round ${round.id} is in ${round.phase} phase — submissions are closed.`,
			);
			return;
		}

		const cardNames = parseCardNames(text);
		if (cardNames.length !== 3) {
			await this.dm.sendDm(
				senderDid,
				`expected 3 card names (one per line), got ${cardNames.length}. example:\n\nLightning Bolt\nSnapcaster Mage\nDelver of Secrets`,
			);
			return;
		}

		const validation = await validateDeck(cardNames, (name) =>
			isWinnerBanned(this.db, name),
		);
		if (!validation.ok) {
			const errorList = validation.errors.map((e) => `• ${e}`).join("\n");
			await this.dm.sendDm(
				senderDid,
				`deck submission failed:\n\n${errorList}\n\nfix and resend.`,
			);
			return;
		}

		// Look up sender's profile for handle/display name
		const profile = await this.agent.getProfile({ actor: senderDid });
		upsertPlayer(
			this.db,
			senderDid,
			profile.data.handle,
			profile.data.displayName ?? null,
		);

		const cards = validation.cards.map((c) => ({
			name: c.name,
			json: JSON.stringify(c),
		}));
		upsertSubmission(this.db, round.id, senderDid, cards);

		const names = validation.cards.map((c) => c.name).join(", ");

		await this.dm.sendDm(
			senderDid,
			`✅ deck submitted for round ${round.id}: ${names}\n\nyou can resend to update your deck before the deadline.`,
		);
	}

	private async handleJudgeCommand(
		senderDid: string,
		text: string,
	): Promise<void> {
		if (!isJudge(this.db, senderDid)) {
			await this.dm.sendDm(senderDid, "you're not a designated judge.");
			return;
		}

		// Format: "judge <matchup_id> <p0 wins|p1 wins|draw>"
		const match = text
			.trim()
			.match(/^judge\s+(\d+)\s+(p0 wins|p1 wins|draw)$/i);
		if (!match || !match[1] || !match[2]) {
			await this.dm.sendDm(
				senderDid,
				"format: judge <matchup_id> <p0 wins|p1 wins|draw>",
			);
			return;
		}

		const matchupId = Number.parseInt(match[1], 10);
		const resolution = match[2].toLowerCase().replace(" ", "_");
		// Normalize: "p0_wins" → "player0_wins"
		const normalized = resolution
			.replace("p0_wins", "player0_wins")
			.replace("p1_wins", "player1_wins");

		resolveMatchup(this.db, matchupId, normalized, senderDid);
		await this.dm.sendDm(
			senderDid,
			`matchup ${matchupId} resolved as: ${normalized}`,
		);
	}
}

// pattern: Imperative Shell

// Bluesky bot for 3CBlue. Handles DMs (deck submissions) and posts (reveals, results).
// Uses @atproto/api for all ATProto interactions.

import { type AtpAgent, RichText } from "@atproto/api";
import type Database from "better-sqlite3";
import {
	type DbSubmission,
	getActiveRound,
	getPlayer,
	getSubmissionsForRound,
	getUnresolvedMatchups,
	isJudge,
	resolveMatchup,
	updateRoundPostUri,
	upsertPlayer,
	upsertSubmission,
} from "./database.js";
import {
	type DeckValidationResult,
	parseCardNames,
	validateDeck,
} from "./deck-validation.js";
import {
	formatMatchupResults,
	formatRevealPost,
	formatStandings,
	formatUnresolvedMatchup,
} from "./post-formatter.js";
import {
	checkJudgingComplete,
	computeStandings,
	resolveRound,
} from "./round-lifecycle.js";

export interface BotConfig {
	service: string;
	identifier: string;
	password: string;
	dbPath: string;
	pollIntervalMs: number;
}

export class ThreeCBlueBot {
	private agent: AtpAgent;
	private chatAgent: AtpAgent;
	private db: Database.Database;
	private config: BotConfig;
	private lastSeenMessageTimestamp: string | undefined;
	private running = false;

	constructor(agent: AtpAgent, db: Database.Database, config: BotConfig) {
		this.agent = agent;
		// Chat API requires proxy header pointing to the chat service
		this.chatAgent = agent.withProxy(
			"bsky_chat",
			"did:web:api.bsky.chat",
		) as AtpAgent;
		this.db = db;
		this.config = config;
	}

	async start(): Promise<void> {
		await this.agent.login({
			identifier: this.config.identifier,
			password: this.config.password,
		});
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
			} catch (err) {
				console.error("poll error:", err);
			}
			await new Promise((resolve) =>
				setTimeout(resolve, this.config.pollIntervalMs),
			);
		}
	}

	private async checkDirectMessages(): Promise<void> {
		// List conversations (DM threads)
		const convos = await this.chatAgent.api.chat.bsky.convo.listConvos({
			limit: 50,
		});

		for (const convo of convos.data.convos) {
			// Get messages in this conversation
			const messages = await this.chatAgent.api.chat.bsky.convo.getMessages({
				convoId: convo.id,
				limit: 20,
			});

			for (const msg of messages.data.messages) {
				if (msg.$type !== "chat.bsky.convo.defs#messageView") continue;
				if (!("text" in msg)) continue;

				// Skip messages we've already processed
				const sentAt = msg.sentAt as string;
				if (
					this.lastSeenMessageTimestamp &&
					sentAt <= this.lastSeenMessageTimestamp
				) {
					continue;
				}

				// Skip our own messages
				const senderDid = (msg.sender as { did: string }).did;
				if (senderDid === this.agent.session?.did) continue;

				await this.handleDirectMessage(convo.id, senderDid, msg.text as string);
			}
		}

		// Update timestamp to avoid re-processing
		this.lastSeenMessageTimestamp = new Date().toISOString();
	}

	private async handleDirectMessage(
		convoId: string,
		senderDid: string,
		text: string,
	): Promise<void> {
		const trimmed = text.trim().toLowerCase();

		// Judge resolution command
		if (trimmed.startsWith("judge ")) {
			await this.handleJudgeCommand(convoId, senderDid, text);
			return;
		}

		// Treat as deck submission
		await this.handleDeckSubmission(convoId, senderDid, text);
	}

	private async handleDeckSubmission(
		convoId: string,
		senderDid: string,
		text: string,
	): Promise<void> {
		const round = getActiveRound(this.db);
		if (!round) {
			await this.sendDm(
				convoId,
				"no active round right now. wait for the next one!",
			);
			return;
		}
		if (round.phase !== "signup" && round.phase !== "submission") {
			await this.sendDm(
				convoId,
				`round ${round.id} is in ${round.phase} phase — submissions are closed.`,
			);
			return;
		}

		const cardNames = parseCardNames(text);
		if (cardNames.length !== 3) {
			await this.sendDm(
				convoId,
				`expected 3 card names (one per line), got ${cardNames.length}. example:\n\nLightning Bolt\nSnapcaster Mage\nDelver of Secrets`,
			);
			return;
		}

		const validation = await validateDeck(cardNames);
		if (!validation.ok) {
			const errorList = validation.errors.map((e) => `• ${e}`).join("\n");
			await this.sendDm(
				convoId,
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

		// Warn about cards with unresolved abilities (still legal, but matchups will need judge)
		const unresolvedCards = validation.cards.filter((c) =>
			c.abilities.some((a) => a.kind === "unresolved"),
		);
		const warning =
			unresolvedCards.length > 0
				? `\n\n⚠️ engine can't fully simulate: ${unresolvedCards.map((c) => c.name).join(", ")}. those matchups will need a judge.`
				: "";

		await this.sendDm(
			convoId,
			`✅ deck submitted for round ${round.id}: ${names}\n\nyou can resend to update your deck before the deadline.${warning}`,
		);
	}

	private async handleJudgeCommand(
		convoId: string,
		senderDid: string,
		text: string,
	): Promise<void> {
		if (!isJudge(this.db, senderDid)) {
			await this.sendDm(convoId, "you're not a designated judge.");
			return;
		}

		// Format: "judge <matchup_id> <p0 wins|p1 wins|draw>"
		const match = text
			.trim()
			.match(/^judge\s+(\d+)\s+(p0 wins|p1 wins|draw)$/i);
		if (!match || !match[1] || !match[2]) {
			await this.sendDm(
				convoId,
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
		await this.sendDm(
			convoId,
			`matchup ${matchupId} resolved as: ${normalized}`,
		);

		// Check if all unresolved matchups are done
		checkJudgingComplete(this.db);
	}

	// --- Public post methods ---

	async postReveal(roundId: number): Promise<string | undefined> {
		const submissions = getSubmissionsForRound(this.db, roundId);
		const handleMap = this.buildHandleMap(submissions.map((s) => s.playerDid));
		const posts = formatRevealPost(roundId, submissions, handleMap);
		return this.postThread(posts);
	}

	async postResults(roundId: number): Promise<string | undefined> {
		const matchups = await this.getMatchupsForRound(roundId);
		const allDids = [
			...new Set(matchups.flatMap((m) => [m.player0Did, m.player1Did])),
		];
		const handleMap = this.buildHandleMap(allDids);

		const resultPosts = formatMatchupResults(roundId, matchups, handleMap);
		const standings = computeStandings(this.db, roundId);
		const standingsPost = formatStandings(roundId, standings, handleMap);

		const allPosts = [...resultPosts, standingsPost];
		return this.postThread(allPosts);
	}

	async postUnresolvedMatchups(roundId: number): Promise<void> {
		const unresolved = getUnresolvedMatchups(this.db, roundId);
		const allDids = [
			...new Set(unresolved.flatMap((m) => [m.player0Did, m.player1Did])),
		];
		const handleMap = this.buildHandleMap(allDids);

		for (const m of unresolved) {
			const text = formatUnresolvedMatchup(m, handleMap);
			await this.createPost(text);
		}
	}

	// --- Helpers ---

	private async sendDm(convoId: string, text: string): Promise<void> {
		await this.chatAgent.api.chat.bsky.convo.sendMessage({
			convoId,
			message: { text },
		});
	}

	private async createPost(text: string): Promise<string | undefined> {
		const rt = new RichText({ text });
		await rt.detectFacets(this.agent);
		const response = await this.agent.post({
			text: rt.text,
			facets: rt.facets,
		});
		return response.uri;
	}

	private async postThread(posts: string[]): Promise<string | undefined> {
		let parentRef: { uri: string; cid: string } | undefined;
		let rootRef: { uri: string; cid: string } | undefined;
		let firstUri: string | undefined;

		for (const text of posts) {
			const rt = new RichText({ text });
			await rt.detectFacets(this.agent);

			const response = await this.agent.post({
				text: rt.text,
				facets: rt.facets,
				reply:
					parentRef && rootRef
						? { parent: parentRef, root: rootRef }
						: undefined,
			});

			const ref = { uri: response.uri, cid: response.cid };
			if (!rootRef) {
				rootRef = ref;
				firstUri = response.uri;
			}
			parentRef = ref;
		}

		return firstUri;
	}

	private async getMatchupsForRound(roundId: number) {
		const { getMatchupsForRound: getMatchups } = await import("./database.js");
		return getMatchups(this.db, roundId);
	}

	private buildHandleMap(dids: readonly string[]): Map<string, string> {
		const map = new Map<string, string>();
		for (const did of dids) {
			const player = getPlayer(this.db, did);
			if (player) {
				map.set(did, player.handle);
			}
		}
		return map;
	}
}

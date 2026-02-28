// pattern: Imperative Shell

// Bluesky bot for 3CBlue. Handles DMs (deck submissions) and posts (reveals, results).
// Uses propter-bsky-kit for all ATProto interactions.

import type { AtpAgent, BlobRef } from "@atproto/api";
import type Database from "better-sqlite3";
import {
	buildFacets,
	createBlueskyDmSender,
	createChatAgent,
	pollInboundDms,
	postMessage,
	replyToPost,
} from "./bot.js";
import type { DmSender, PostRef } from "./bot.js";
import {
	type DbMatchup,
	type DbSubmission,
	getActiveRound,
	getCompletedRoundCount,
	getPlayer,
	getSubmissionsForRound,
	getUnresolvedMatchups,
	isJudge,
	isWinnerBanned,
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
import { renderMatchupImages } from "./matchup-image.js";
import { parseNarrative, verdictDisplayLabel } from "./matchup-narrative.js";
import {
	formatLeaderboard,
	formatMatchupResults,
	formatRevealPost,
	formatStandings,
	formatUnresolvedMatchup,
} from "./post-formatter.js";
import {
	checkJudgingComplete,
	computeLeaderboard,
	computeStandings,
	isRoundPastDeadline,
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
	private dm: DmSender;
	private db: Database.Database;
	private config: BotConfig;
	private dmMessageId: string | undefined;
	private running = false;

	constructor(agent: AtpAgent, db: Database.Database, config: BotConfig) {
		this.agent = agent;
		const chatAgent = createChatAgent(agent);
		this.dm = createBlueskyDmSender(chatAgent);
		this.db = db;
		this.config = config;
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
				await this.checkRoundDeadlines();
			} catch (err) {
				console.error("[bot] poll error:", err);
			}
			await new Promise((resolve) =>
				setTimeout(resolve, this.config.pollIntervalMs),
			);
		}
	}

	private async checkRoundDeadlines(): Promise<void> {
		const round = getActiveRound(this.db);
		if (!round || !isRoundPastDeadline(round)) return;

		console.log(`[round] round ${round.id} deadline passed, resolving...`);

		const result = await resolveRound(this.db);
		if ("error" in result) {
			console.error(
				`[round] failed to resolve round ${round.id}: ${result.error}`,
			);
			return;
		}

		const revealUri = await this.postReveal(round.id);
		if (revealUri) {
			updateRoundPostUri(this.db, round.id, revealUri);
		}

		await this.postResults(round.id);

		if (result.unresolvedCount > 0) {
			await this.postUnresolvedMatchups(round.id);
			console.log(
				`[round] round ${round.id}: ${result.unresolvedCount} unresolved matchups — waiting for judges`,
			);
		} else {
			await this.postLeaderboard();
			console.log(`[round] round ${round.id} complete — leaderboard posted`);
		}
	}

	private async checkDirectMessages(): Promise<void> {
		const chatAgent = createChatAgent(this.agent);
		const { messages, latestMessageId } = await pollInboundDms(
			chatAgent,
			this.dmMessageId,
		);

		for (const msg of messages) {
			await this.handleDirectMessage(msg.senderDid, msg.text);
		}

		if (latestMessageId) {
			this.dmMessageId = latestMessageId;
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

		// Warn about cards with unresolved abilities (still legal, but matchups will need judge)
		const unresolvedCards = validation.cards.filter((c) =>
			c.abilities.some((a) => a.kind === "unresolved"),
		);
		const warning =
			unresolvedCards.length > 0
				? `\n\n⚠️ engine can't fully simulate: ${unresolvedCards.map((c) => c.name).join(", ")}. those matchups will need a judge.`
				: "";

		await this.dm.sendDm(
			senderDid,
			`✅ deck submitted for round ${round.id}: ${names}\n\nyou can resend to update your deck before the deadline.${warning}`,
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

		const round = getActiveRound(this.db);
		resolveMatchup(this.db, matchupId, normalized, senderDid);
		await this.dm.sendDm(
			senderDid,
			`matchup ${matchupId} resolved as: ${normalized}`,
		);

		// If all unresolved matchups are now judged, post final results + leaderboard
		const complete = checkJudgingComplete(this.db);
		if (complete && round) {
			await this.postResults(round.id);
			await this.postLeaderboard();
			console.log(
				`[judge] round ${round.id} judging complete — final results + leaderboard posted`,
			);
		}
	}

	// --- Public post methods ---

	async postAnnouncement(text: string): Promise<string | undefined> {
		const ref = await postMessage(this.agent, text);
		return ref?.uri;
	}

	async postReveal(roundId: number): Promise<string | undefined> {
		const submissions = getSubmissionsForRound(this.db, roundId);
		const handleMap = this.buildHandleMap(submissions.map((s) => s.playerDid));
		const posts = formatRevealPost(roundId, submissions, handleMap);
		return this.postThread(posts);
	}

	async postResults(roundId: number): Promise<string | undefined> {
		const matchups = await this.getMatchupsForRound(roundId);
		const hasNarratives = matchups.some((m) => m.narrative);

		// Use image posts when narratives are available (from /resolve-round)
		if (hasNarratives) {
			return this.postResultsWithImages(roundId);
		}

		// Fall back to text-only posts
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

	async postLeaderboard(): Promise<string | undefined> {
		const entries = computeLeaderboard(this.db);
		if (entries.length === 0) return undefined;
		const totalRounds = getCompletedRoundCount(this.db);
		const handleMap = this.buildHandleMap(entries.map((e) => e.playerDid));
		const posts = formatLeaderboard(entries, totalRounds, handleMap);
		return this.postThread(posts);
	}

	async postUnresolvedMatchups(roundId: number): Promise<void> {
		const unresolved = getUnresolvedMatchups(this.db, roundId);
		const allDids = [
			...new Set(unresolved.flatMap((m) => [m.player0Did, m.player1Did])),
		];
		const handleMap = this.buildHandleMap(allDids);

		for (const m of unresolved) {
			const text = formatUnresolvedMatchup(m, handleMap);
			const ref = await postMessage(this.agent, text);
			if (!ref) {
				console.error("[post] failed to post unresolved matchup");
			}
		}
	}

	/** Post a single matchup with deck images + narrative card. */
	async postMatchupWithImages(
		matchup: DbMatchup,
		submissions: readonly DbSubmission[],
		handleMap: ReadonlyMap<string, string>,
		parentRef?: PostRef,
		rootRef?: PostRef,
	): Promise<PostRef | undefined> {
		const sub0 = submissions.find((s) => s.playerDid === matchup.player0Did);
		const sub1 = submissions.find((s) => s.playerDid === matchup.player1Did);
		if (!sub0 || !sub1) return undefined;

		const h0 = handleMap.get(matchup.player0Did) ?? "?";
		const h1 = handleMap.get(matchup.player1Did) ?? "?";
		const outcome = matchup.judgeResolution ?? matchup.outcome;

		const verdictLabel = verdictDisplayLabel(outcome, h0, h1);

		// Parse structured narrative JSON, or fall back to plain text
		const narrative = matchup.narrative
			? parseNarrative(matchup.narrative)
			: null;
		const playVerdict = narrative
			? verdictDisplayLabel(narrative.onPlayVerdict, h0, h1)
			: verdictLabel;
		const drawVerdict = narrative
			? verdictDisplayLabel(narrative.onDrawVerdict, h0, h1)
			: verdictLabel;
		const playNarrative = narrative?.playNarrative ?? matchup.narrative ?? "";
		const drawNarrative = narrative?.drawNarrative ?? "";

		try {
			const images = await renderMatchupImages({
				handle0: h0,
				handle1: h1,
				cardNames0: [sub0.card1Name, sub0.card2Name, sub0.card3Name],
				cardNames1: [sub1.card1Name, sub1.card2Name, sub1.card3Name],
				verdict: verdictLabel,
				onPlayVerdict: playVerdict,
				onDrawVerdict: drawVerdict,
				playNarrative,
				drawNarrative,
			});

			const [blob0, blob1, blobNarrative] = await Promise.all([
				this.uploadImage(images.deck0),
				this.uploadImage(images.deck1),
				this.uploadImage(images.narrative),
			]);

			const caption = `@${h0} vs @${h1}: ${verdictLabel}`;
			const { text, facets } = await buildFacets(this.agent, caption);

			const response = await this.agent.post({
				text,
				facets,
				embed: {
					$type: "app.bsky.embed.images",
					images: [
						{
							image: blob0,
							alt: `${h0}'s deck: ${sub0.card1Name}, ${sub0.card2Name}, ${sub0.card3Name}`,
						},
						{
							image: blob1,
							alt: `${h1}'s deck: ${sub1.card1Name}, ${sub1.card2Name}, ${sub1.card3Name}`,
						},
						{
							image: blobNarrative,
							alt: `Matchup analysis: ${verdictLabel}. ${playNarrative}`,
						},
					],
				},
				reply:
					parentRef && rootRef
						? { parent: parentRef, root: rootRef }
						: undefined,
			});

			return { uri: response.uri, cid: response.cid };
		} catch (err) {
			console.error(`[post] failed to render/post matchup images: ${err}`);
			// Fall back to text-only post
			const caption = `@${h0} vs @${h1}: ${verdictLabel}`;
			const { text, facets } = await buildFacets(this.agent, caption);
			const response = await this.agent.post({
				text,
				facets,
				reply:
					parentRef && rootRef
						? { parent: parentRef, root: rootRef }
						: undefined,
			});
			return { uri: response.uri, cid: response.cid };
		}
	}

	/** Post all matchup results as image posts in a thread. */
	async postResultsWithImages(roundId: number): Promise<string | undefined> {
		const matchups = await this.getMatchupsForRound(roundId);
		const submissions = getSubmissionsForRound(this.db, roundId);
		const allDids = [
			...new Set(matchups.flatMap((m) => [m.player0Did, m.player1Did])),
		];
		const handleMap = this.buildHandleMap(allDids);

		let rootRef: PostRef | undefined;
		let parentRef: PostRef | undefined;
		let firstUri: string | undefined;

		for (const matchup of matchups) {
			const ref = await this.postMatchupWithImages(
				matchup,
				submissions,
				handleMap,
				parentRef,
				rootRef,
			);
			if (ref) {
				if (!rootRef) {
					rootRef = ref;
					firstUri = ref.uri;
				}
				parentRef = ref;
			}
		}

		// Post standings as final text reply in thread
		const standings = computeStandings(this.db, roundId);
		const standingsPost = formatStandings(roundId, standings, handleMap);
		if (parentRef && rootRef) {
			await replyToPost(this.agent, standingsPost, parentRef, rootRef);
		}

		return firstUri;
	}

	// --- Helpers ---

	private async uploadImage(imageBuffer: Buffer): Promise<BlobRef> {
		const response = await this.agent.uploadBlob(imageBuffer, {
			encoding: "image/png",
		});
		return response.data.blob;
	}

	private async postThread(posts: string[]): Promise<string | undefined> {
		if (posts.length === 0) return undefined;

		const firstRef = await postMessage(this.agent, posts[0]!);
		if (!firstRef) return undefined;

		let parentRef: PostRef = firstRef;
		const rootRef: PostRef = firstRef;

		for (let i = 1; i < posts.length; i++) {
			const ref = await replyToPost(this.agent, posts[i]!, parentRef, rootRef);
			if (ref) {
				parentRef = ref;
			}
		}

		return firstRef.uri;
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

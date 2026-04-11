import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addJudge,
	createDatabase,
	getActiveRound,
	getRound,
	getWinnerBans,
	insertMatchup,
	resolveMatchup,
	updateRoundPhase,
	upsertPlayer,
	upsertSubmission,
} from "./database.js";
import {
	type MatchupEvaluator,
	checkJudgingComplete,
	computeLeaderboard,
	finalizeRound,
	isRoundPastDeadline,
	resolveRound,
} from "./round-lifecycle.js";

const mockEvaluator: MatchupEvaluator = async () => ({
	outcome: "player0_wins",
	reasoning: "test: p0 wins",
});

let db: Database.Database;

beforeEach(() => {
	db = createDatabase(":memory:");
});

afterEach(() => {
	db.close();
});

function createRoundWithDeadline(
	db: Database.Database,
	deadlineOffsetMs: number,
): number {
	const deadline = new Date(Date.now() + deadlineOffsetMs).toISOString();
	const row = db
		.prepare(
			"INSERT INTO rounds (phase, submission_deadline) VALUES ('submission', ?) RETURNING id",
		)
		.get(deadline) as { id: number };
	return row.id;
}

function addTestSubmission(
	db: Database.Database,
	roundId: number,
	did: string,
	handle: string,
): void {
	upsertPlayer(db, did, handle, null);
	upsertSubmission(db, roundId, did, [
		{
			name: "Card A",
			json: '{"name":"Card A","manaCost":"","colors":[],"types":["creature"],"subtypes":[],"power":2,"toughness":2,"abilities":[],"oracleText":""}',
		},
		{
			name: "Card B",
			json: '{"name":"Card B","manaCost":"","colors":[],"types":["creature"],"subtypes":[],"power":3,"toughness":3,"abilities":[],"oracleText":""}',
		},
		{
			name: "Card C",
			json: '{"name":"Card C","manaCost":"","colors":[],"types":["creature"],"subtypes":[],"power":1,"toughness":1,"abilities":[],"oracleText":""}',
		},
	]);
}

describe("isRoundPastDeadline", () => {
	it("returns true when deadline is in the past", () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		const round = getRound(db, roundId)!;
		expect(isRoundPastDeadline(round)).toBe(true);
	});

	it("returns false when deadline is in the future", () => {
		const roundId = createRoundWithDeadline(db, 60_000);
		const round = getRound(db, roundId)!;
		expect(isRoundPastDeadline(round)).toBe(false);
	});

	it("returns false when round is not in submission phase", () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		updateRoundPhase(db, roundId, "resolution");
		const round = getRound(db, roundId)!;
		expect(isRoundPastDeadline(round)).toBe(false);
	});

	it("returns false when round has no deadline", () => {
		const row = db
			.prepare("INSERT INTO rounds (phase) VALUES ('submission') RETURNING *")
			.get() as Record<string, unknown>;
		const round = getRound(db, row.id as number)!;
		expect(isRoundPastDeadline(round)).toBe(false);
	});
});

describe("deadline-triggered resolution", () => {
	it("resolves round with matchups when deadline passes", async () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		addTestSubmission(db, roundId, "did:plc:alice", "alice.bsky.social");
		addTestSubmission(db, roundId, "did:plc:bob", "bob.bsky.social");

		const round = getRound(db, roundId)!;
		expect(isRoundPastDeadline(round)).toBe(true);

		const result = await resolveRound(db, mockEvaluator);
		expect("matchups" in result).toBe(true);
		if (!("matchups" in result)) return;

		expect(result.matchups).toHaveLength(1);

		const resolved = getRound(db, roundId)!;
		expect(resolved.phase).toBe("complete");
	});

	it("returns error when fewer than 2 submissions", async () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		addTestSubmission(db, roundId, "did:plc:alice", "alice.bsky.social");

		const result = await resolveRound(db, mockEvaluator);
		expect("error" in result).toBe(true);
	});

	it("advances to judging when matchups are unresolved", () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		addTestSubmission(db, roundId, "did:plc:alice", "alice.bsky.social");
		addTestSubmission(db, roundId, "did:plc:bob", "bob.bsky.social");

		updateRoundPhase(db, roundId, "resolution");
		insertMatchup(
			db,
			roundId,
			"did:plc:alice",
			"did:plc:bob",
			"unresolved",
			"complex interaction",
			"{}",
		);
		insertMatchup(
			db,
			roundId,
			"did:plc:bob",
			"did:plc:alice",
			"player0_wins",
			null,
			"{}",
		);

		updateRoundPhase(db, roundId, "judging");

		const round = getRound(db, roundId)!;
		expect(round.phase).toBe("judging");
	});
});

describe("judging completion", () => {
	it("completes round when all unresolved matchups are judged", () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		updateRoundPhase(db, roundId, "judging");

		upsertPlayer(db, "did:plc:alice", "alice", null);
		upsertPlayer(db, "did:plc:bob", "bob", null);
		upsertPlayer(db, "did:plc:judge", "judge", null);
		addJudge(db, "did:plc:judge");

		const m = insertMatchup(
			db,
			roundId,
			"did:plc:alice",
			"did:plc:bob",
			"unresolved",
			"complex",
			"{}",
		);

		expect(checkJudgingComplete(db)).toBe(false);

		resolveMatchup(db, m.id, "player0_wins", "did:plc:judge");

		expect(checkJudgingComplete(db)).toBe(true);

		const round = getRound(db, roundId)!;
		expect(round.phase).toBe("complete");
	});

	it("stays in judging when unresolved matchups remain", () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		updateRoundPhase(db, roundId, "judging");

		upsertPlayer(db, "did:plc:alice", "alice", null);
		upsertPlayer(db, "did:plc:bob", "bob", null);
		upsertPlayer(db, "did:plc:charlie", "charlie", null);
		upsertPlayer(db, "did:plc:judge", "judge", null);

		insertMatchup(
			db,
			roundId,
			"did:plc:alice",
			"did:plc:bob",
			"unresolved",
			"complex",
			"{}",
		);
		const m2 = insertMatchup(
			db,
			roundId,
			"did:plc:alice",
			"did:plc:charlie",
			"unresolved",
			"complex",
			"{}",
		);

		resolveMatchup(db, m2.id, "draw", "did:plc:judge");

		expect(checkJudgingComplete(db)).toBe(false);

		const round = getRound(db, roundId)!;
		expect(round.phase).toBe("judging");
	});
});

function addNamedSubmission(
	db: Database.Database,
	roundId: number,
	did: string,
	handle: string,
	cardNames: [string, string, string],
): void {
	upsertPlayer(db, did, handle, null);
	upsertSubmission(
		db,
		roundId,
		did,
		cardNames.map((name) => ({
			name,
			json: JSON.stringify({
				name,
				manaCost: "",
				colors: [],
				types: ["creature"],
				subtypes: [],
				power: 2,
				toughness: 2,
				abilities: [],
				oracleText: "",
			}),
		})),
	);
}

describe("finalizeRound", () => {
	it("sets phase to complete and bans winner's cards", () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		addNamedSubmission(db, roundId, "did:plc:alice", "alice", [
			"Lightning Bolt",
			"Grizzly Bears",
			"Giant Growth",
		]);
		addNamedSubmission(db, roundId, "did:plc:bob", "bob", [
			"Shock",
			"Llanowar Elves",
			"Dark Ritual",
		]);
		updateRoundPhase(db, roundId, "resolution");

		insertMatchup(
			db,
			roundId,
			"did:plc:alice",
			"did:plc:bob",
			"player0_wins",
			null,
			"{}",
		);

		const result = finalizeRound(db, roundId);

		expect(getRound(db, roundId)!.phase).toBe("complete");
		expect(result.winnersFound).toBe(1);
		expect(result.cardsBanned).toEqual([
			"Lightning Bolt",
			"Grizzly Bears",
			"Giant Growth",
		]);

		const bans = getWinnerBans(db);
		expect(bans).toHaveLength(3);
		expect(bans.map((b) => b.cardName).sort()).toEqual([
			"Giant Growth",
			"Grizzly Bears",
			"Lightning Bolt",
		]);
	});

	it("is idempotent — safe to call on already-complete round", () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		addNamedSubmission(db, roundId, "did:plc:alice", "alice", [
			"Lightning Bolt",
			"Grizzly Bears",
			"Giant Growth",
		]);
		addNamedSubmission(db, roundId, "did:plc:bob", "bob", [
			"Shock",
			"Llanowar Elves",
			"Dark Ritual",
		]);
		updateRoundPhase(db, roundId, "complete");
		insertMatchup(
			db,
			roundId,
			"did:plc:alice",
			"did:plc:bob",
			"player0_wins",
			null,
			"{}",
		);

		finalizeRound(db, roundId);
		const result = finalizeRound(db, roundId);

		expect(getRound(db, roundId)!.phase).toBe("complete");
		expect(result.cardsBanned).toHaveLength(3);
		expect(getWinnerBans(db)).toHaveLength(3);
	});

	it("bans cards for all tied winners", () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		addNamedSubmission(db, roundId, "did:plc:alice", "alice", [
			"Lightning Bolt",
			"Grizzly Bears",
			"Giant Growth",
		]);
		addNamedSubmission(db, roundId, "did:plc:bob", "bob", [
			"Shock",
			"Llanowar Elves",
			"Dark Ritual",
		]);
		addNamedSubmission(db, roundId, "did:plc:charlie", "charlie", [
			"Counterspell",
			"Force of Will",
			"Brainstorm",
		]);
		updateRoundPhase(db, roundId, "resolution");

		insertMatchup(
			db,
			roundId,
			"did:plc:alice",
			"did:plc:bob",
			"player0_wins",
			null,
			"{}",
		);
		insertMatchup(
			db,
			roundId,
			"did:plc:charlie",
			"did:plc:alice",
			"player0_wins",
			null,
			"{}",
		);
		insertMatchup(
			db,
			roundId,
			"did:plc:bob",
			"did:plc:charlie",
			"player0_wins",
			null,
			"{}",
		);

		const result = finalizeRound(db, roundId);

		expect(result.winnersFound).toBe(3);
		expect(result.cardsBanned).toHaveLength(9);
		expect(getWinnerBans(db)).toHaveLength(9);
	});

	it("returns empty when round does not exist", () => {
		const result = finalizeRound(db, 999);
		expect(result.winnersFound).toBe(0);
		expect(result.cardsBanned).toHaveLength(0);
	});

	it("returns empty when round has no submissions", () => {
		const roundId = createRoundWithDeadline(db, -60_000);
		const result = finalizeRound(db, roundId);
		expect(result.winnersFound).toBe(0);
		expect(result.cardsBanned).toHaveLength(0);
		expect(getRound(db, roundId)!.phase).toBe("complete");
	});
});

describe("leaderboard", () => {
	it("returns empty for no completed rounds", () => {
		const entries = computeLeaderboard(db);
		expect(entries).toHaveLength(0);
	});

	it("aggregates stats across multiple completed rounds", () => {
		const r1 = createRoundWithDeadline(db, -60_000);
		addTestSubmission(db, r1, "did:plc:alice", "alice");
		addTestSubmission(db, r1, "did:plc:bob", "bob");
		updateRoundPhase(db, r1, "complete");
		insertMatchup(
			db,
			r1,
			"did:plc:alice",
			"did:plc:bob",
			"player0_wins",
			null,
			"{}",
		);
		insertMatchup(
			db,
			r1,
			"did:plc:bob",
			"did:plc:alice",
			"player0_wins",
			null,
			"{}",
		);

		const r2 = createRoundWithDeadline(db, -60_000);
		addTestSubmission(db, r2, "did:plc:bob", "bob");
		addTestSubmission(db, r2, "did:plc:charlie", "charlie");
		addTestSubmission(db, r2, "did:plc:alice", "alice");
		upsertPlayer(db, "did:plc:charlie", "charlie", null);
		updateRoundPhase(db, r2, "complete");
		insertMatchup(
			db,
			r2,
			"did:plc:bob",
			"did:plc:charlie",
			"player0_wins",
			null,
			"{}",
		);
		insertMatchup(
			db,
			r2,
			"did:plc:charlie",
			"did:plc:bob",
			"player1_wins",
			null,
			"{}",
		);
		insertMatchup(
			db,
			r2,
			"did:plc:alice",
			"did:plc:charlie",
			"draw",
			null,
			"{}",
		);
		insertMatchup(
			db,
			r2,
			"did:plc:charlie",
			"did:plc:alice",
			"draw",
			null,
			"{}",
		);
		insertMatchup(
			db,
			r2,
			"did:plc:alice",
			"did:plc:bob",
			"player1_wins",
			null,
			"{}",
		);
		insertMatchup(
			db,
			r2,
			"did:plc:bob",
			"did:plc:alice",
			"player0_wins",
			null,
			"{}",
		);

		const entries = computeLeaderboard(db);
		expect(entries).toHaveLength(3);

		const bob = entries.find((e) => e.playerDid === "did:plc:bob")!;
		expect(bob.points).toBe(30);
		expect(bob.roundsPlayed).toBe(2);

		const alice = entries.find((e) => e.playerDid === "did:plc:alice")!;
		expect(alice.points).toBe(10);
		expect(alice.roundsPlayed).toBe(2);

		const charlie = entries.find((e) => e.playerDid === "did:plc:charlie")!;
		expect(charlie.points).toBe(4);
		expect(charlie.roundsPlayed).toBe(1);

		expect(entries[0]?.playerDid).toBe("did:plc:bob");
		expect(entries[1]?.playerDid).toBe("did:plc:alice");
		expect(entries[2]?.playerDid).toBe("did:plc:charlie");
	});

	it("ignores non-complete rounds", () => {
		const r1 = createRoundWithDeadline(db, -60_000);
		addTestSubmission(db, r1, "did:plc:alice", "alice");
		addTestSubmission(db, r1, "did:plc:bob", "bob");
		insertMatchup(
			db,
			r1,
			"did:plc:alice",
			"did:plc:bob",
			"player0_wins",
			null,
			"{}",
		);

		const entries = computeLeaderboard(db);
		expect(entries).toHaveLength(0);
	});

	it("uses judge resolution over engine outcome", () => {
		const r1 = createRoundWithDeadline(db, -60_000);
		addTestSubmission(db, r1, "did:plc:alice", "alice");
		addTestSubmission(db, r1, "did:plc:bob", "bob");
		upsertPlayer(db, "did:plc:judge", "judge", null);
		updateRoundPhase(db, r1, "complete");

		const m = insertMatchup(
			db,
			r1,
			"did:plc:alice",
			"did:plc:bob",
			"unresolved",
			"complex",
			"{}",
		);
		resolveMatchup(db, m.id, "player0_wins", "did:plc:judge");
		insertMatchup(db, r1, "did:plc:bob", "did:plc:alice", "draw", null, "{}");

		const entries = computeLeaderboard(db);
		const alice = entries.find((e) => e.playerDid === "did:plc:alice")!;
		expect(alice.points).toBe(8);
		expect(alice.wins).toBe(2);
		expect(alice.draws).toBe(2);
	});
});

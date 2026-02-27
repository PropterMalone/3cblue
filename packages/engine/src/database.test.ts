import type Database from "better-sqlite3";
// pattern: Imperative Shell
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addJudge,
	createDatabase,
	createRound,
	getActiveRound,
	getMatchupsForRound,
	getRound,
	getSubmissionsForRound,
	getUnresolvedMatchups,
	insertMatchup,
	isJudge,
	resolveMatchup,
	updateRoundPhase,
	upsertPlayer,
	upsertSubmission,
} from "./database.js";

let db: Database.Database;

beforeEach(() => {
	db = createDatabase(":memory:");
});

afterEach(() => {
	db.close();
});

describe("rounds", () => {
	it("creates a round with deadline", () => {
		const round = createRound(db, 24);
		expect(round.id).toBe(1);
		expect(round.phase).toBe("submission");
		expect(round.submissionDeadline).toBeTruthy();
	});

	it("gets round by id", () => {
		const created = createRound(db);
		const fetched = getRound(db, created.id);
		expect(fetched).toEqual(created);
	});

	it("gets active round (skips complete)", () => {
		const r1 = createRound(db);
		updateRoundPhase(db, r1.id, "complete");
		const r2 = createRound(db);

		const active = getActiveRound(db);
		expect(active?.id).toBe(r2.id);
	});

	it("updates round phase", () => {
		const round = createRound(db);
		updateRoundPhase(db, round.id, "submission");
		const fetched = getRound(db, round.id);
		expect(fetched?.phase).toBe("submission");
	});
});

describe("players", () => {
	it("upserts player", () => {
		upsertPlayer(db, "did:plc:abc", "alice.bsky.social", "Alice");
		upsertPlayer(db, "did:plc:abc", "alice2.bsky.social", "Alice Updated");

		const row = db
			.prepare("SELECT * FROM players WHERE did = ?")
			.get("did:plc:abc") as Record<string, unknown>;
		expect(row.handle).toBe("alice2.bsky.social");
		expect(row.display_name).toBe("Alice Updated");
	});
});

describe("submissions", () => {
	it("creates and retrieves submissions", () => {
		const round = createRound(db);
		upsertPlayer(db, "did:plc:abc", "alice.bsky.social", null);

		const cards = [
			{ name: "Lightning Bolt", json: '{"name":"Lightning Bolt"}' },
			{ name: "Snapcaster Mage", json: '{"name":"Snapcaster Mage"}' },
			{ name: "Delver of Secrets", json: '{"name":"Delver of Secrets"}' },
		];

		const sub = upsertSubmission(db, round.id, "did:plc:abc", cards);
		expect(sub.card1Name).toBe("Lightning Bolt");
		expect(sub.roundId).toBe(round.id);

		const subs = getSubmissionsForRound(db, round.id);
		expect(subs).toHaveLength(1);
	});

	it("upserts (replaces) on resubmission", () => {
		const round = createRound(db);
		upsertPlayer(db, "did:plc:abc", "alice.bsky.social", null);

		const cards1 = [
			{ name: "Card A", json: "{}" },
			{ name: "Card B", json: "{}" },
			{ name: "Card C", json: "{}" },
		];
		upsertSubmission(db, round.id, "did:plc:abc", cards1);

		const cards2 = [
			{ name: "Card X", json: "{}" },
			{ name: "Card Y", json: "{}" },
			{ name: "Card Z", json: "{}" },
		];
		upsertSubmission(db, round.id, "did:plc:abc", cards2);

		const subs = getSubmissionsForRound(db, round.id);
		expect(subs).toHaveLength(1);
		expect(subs[0]?.card1Name).toBe("Card X");
	});
});

describe("matchups", () => {
	it("inserts and retrieves matchups", () => {
		const round = createRound(db);
		upsertPlayer(db, "did:plc:abc", "alice", null);
		upsertPlayer(db, "did:plc:def", "bob", null);

		insertMatchup(
			db,
			round.id,
			"did:plc:abc",
			"did:plc:def",
			"player0_wins",
			null,
			"{}",
		);

		const matchups = getMatchupsForRound(db, round.id);
		expect(matchups).toHaveLength(1);
		expect(matchups[0]?.outcome).toBe("player0_wins");
	});

	it("tracks unresolved matchups and judge resolution", () => {
		const round = createRound(db);
		upsertPlayer(db, "did:plc:abc", "alice", null);
		upsertPlayer(db, "did:plc:def", "bob", null);
		upsertPlayer(db, "did:plc:judge", "judge", null);

		const m = insertMatchup(
			db,
			round.id,
			"did:plc:abc",
			"did:plc:def",
			"unresolved",
			"cards with unresolved abilities",
			"{}",
		);

		expect(getUnresolvedMatchups(db, round.id)).toHaveLength(1);

		resolveMatchup(db, m.id, "player0_wins", "did:plc:judge");
		expect(getUnresolvedMatchups(db, round.id)).toHaveLength(0);
	});
});

describe("judges", () => {
	it("adds and checks judges", () => {
		upsertPlayer(db, "did:plc:judge", "judge.bsky.social", null);
		expect(isJudge(db, "did:plc:judge")).toBe(false);

		addJudge(db, "did:plc:judge");
		expect(isJudge(db, "did:plc:judge")).toBe(true);
	});
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import {
	readUpdates,
	writeUpdates,
	appendUpdate,
	applyUpdates,
	type RoundUpdate,
} from "./round-updates.js";

// Use a test-specific JSONL path by patching the module's path logic
// Actually, the module uses data/round-updates/r{N}-updates.jsonl
// We'll use round 99 to avoid collisions

const TEST_ROUND = 99;
const TEST_PATH = "data/round-updates/r99-updates.jsonl";

function cleanup() {
	if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH);
}

describe("round-updates JSONL I/O", () => {
	beforeEach(() => {
		mkdirSync("data/round-updates", { recursive: true });
		cleanup();
	});
	afterEach(cleanup);

	it("returns empty array when file does not exist", () => {
		expect(readUpdates(TEST_ROUND)).toEqual([]);
	});

	it("writes and reads updates round-trip", () => {
		const updates: RoundUpdate[] = [
			{
				matchup: ["alice.bsky.social", "bob.bsky.social"],
				play: "W",
				draw: "D",
				source: { type: "bsky", uri: "at://did:plc:abc/app.bsky.feed.post/xyz" },
				reason: "Karakas bounces before combat",
				status: "pending",
			},
		];
		writeUpdates(TEST_ROUND, updates);
		const read = readUpdates(TEST_ROUND);
		expect(read).toHaveLength(1);
		expect(read[0]!.matchup).toEqual(["alice.bsky.social", "bob.bsky.social"]);
		expect(read[0]!.status).toBe("pending");
	});

	it("appends without clobbering existing entries", () => {
		const first: RoundUpdate = {
			matchup: ["alice.bsky.social", "bob.bsky.social"],
			play: "W",
			draw: "D",
			source: { type: "bsky", uri: "at://post1" },
			reason: "first",
			status: "pending",
		};
		const second: RoundUpdate = {
			matchup: ["carol.bsky.social", "dave.bsky.social"],
			play: "L",
			draw: "L",
			source: { type: "conversation", date: "2026-03-15", context: "discussed in session" },
			reason: "second",
			status: "pending",
		};
		appendUpdate(TEST_ROUND, first);
		appendUpdate(TEST_ROUND, second);
		const all = readUpdates(TEST_ROUND);
		expect(all).toHaveLength(2);
		expect(all[0]!.reason).toBe("first");
		expect(all[1]!.reason).toBe("second");
	});
});

describe("applyUpdates", () => {
	let db: Database.Database;

	beforeEach(() => {
		mkdirSync("data/round-updates", { recursive: true });
		cleanup();
		db = new Database(":memory:");
		db.pragma("journal_mode = WAL");
		db.pragma("foreign_keys = ON");

		// Minimal schema
		db.exec(`
			CREATE TABLE rounds (id INTEGER PRIMARY KEY, phase TEXT NOT NULL DEFAULT 'resolution');
			CREATE TABLE players (did TEXT PRIMARY KEY, handle TEXT NOT NULL);
			CREATE TABLE submissions (
				id INTEGER PRIMARY KEY, round_id INTEGER, player_did TEXT,
				card1_name TEXT, card2_name TEXT, card3_name TEXT,
				card1_json TEXT, card2_json TEXT, card3_json TEXT
			);
			CREATE TABLE matchups (
				id INTEGER PRIMARY KEY, round_id INTEGER,
				player0_did TEXT, player1_did TEXT,
				outcome TEXT NOT NULL, narrative TEXT,
				on_play_verdict TEXT, on_draw_verdict TEXT,
				correction_count INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE corrections (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				matchup_id INTEGER, old_outcome TEXT NOT NULL, new_outcome TEXT NOT NULL,
				old_narrative TEXT, new_narrative TEXT,
				requested_by TEXT, reason TEXT,
				applied_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
		`);

		db.prepare("INSERT INTO rounds (id) VALUES (?)").run(TEST_ROUND);
		db.prepare("INSERT INTO players VALUES (?, ?)").run("did:alice", "alice.bsky.social");
		db.prepare("INSERT INTO players VALUES (?, ?)").run("did:bob", "bob.bsky.social");
		db.prepare(
			`INSERT INTO matchups (id, round_id, player0_did, player1_did, outcome, on_play_verdict, on_draw_verdict)
			 VALUES (1, ?, 'did:alice', 'did:bob', 'LL', 'L', 'L')`,
		).run(TEST_ROUND);
	});

	afterEach(() => {
		cleanup();
		db.close();
	});

	it("applies pending update and marks it applied", () => {
		const update: RoundUpdate = {
			matchup: ["alice.bsky.social", "bob.bsky.social"],
			play: "W",
			draw: "D",
			source: { type: "bsky", uri: "at://post1" },
			reason: "alice wins on play, draws on draw",
			status: "pending",
		};
		writeUpdates(TEST_ROUND, [update]);

		const result = applyUpdates(db, TEST_ROUND);
		expect(result.applied).toBe(1);
		expect(result.errors).toHaveLength(0);

		// Check DB was updated
		const m = db.prepare("SELECT on_play_verdict, on_draw_verdict FROM matchups WHERE id = 1").get() as any;
		expect(m.on_play_verdict).toBe("W");
		expect(m.on_draw_verdict).toBe("D");

		// Check correction was recorded
		const c = db.prepare("SELECT * FROM corrections WHERE matchup_id = 1").get() as any;
		expect(c.old_outcome).toBe("LL");
		expect(c.new_outcome).toBe("WD");
		expect(c.reason).toBe("alice wins on play, draws on draw");

		// Check JSONL was updated
		const updates = readUpdates(TEST_ROUND);
		expect(updates[0]!.status).toBe("applied");
		expect(updates[0]!.appliedAt).toBeDefined();
	});

	it("skips already-applied updates", () => {
		const update: RoundUpdate = {
			matchup: ["alice.bsky.social", "bob.bsky.social"],
			play: "W",
			draw: "D",
			source: { type: "bsky", uri: "at://post1" },
			reason: "test",
			status: "applied",
			appliedAt: "2026-03-15T00:00:00Z",
		};
		writeUpdates(TEST_ROUND, [update]);

		const result = applyUpdates(db, TEST_ROUND);
		expect(result.applied).toBe(0);
		expect(result.skipped).toBe(1);
	});

	it("flips verdicts when matchup is stored in reverse order", () => {
		// Update written from bob's perspective (bob wins on play)
		const update: RoundUpdate = {
			matchup: ["bob.bsky.social", "alice.bsky.social"],
			play: "W",
			draw: "D",
			source: { type: "conversation", date: "2026-03-15", context: "reviewed together" },
			reason: "bob wins on play",
			status: "pending",
		};
		writeUpdates(TEST_ROUND, [update]);

		applyUpdates(db, TEST_ROUND);

		// DB has alice as p0, so bob winning → alice losing on play
		const m = db.prepare("SELECT on_play_verdict, on_draw_verdict FROM matchups WHERE id = 1").get() as any;
		expect(m.on_play_verdict).toBe("L");
		expect(m.on_draw_verdict).toBe("D");
	});

	it("skips no-op updates where verdicts already match", () => {
		// Set matchup to W/D already
		db.prepare("UPDATE matchups SET on_play_verdict = 'W', on_draw_verdict = 'D' WHERE id = 1").run();

		const update: RoundUpdate = {
			matchup: ["alice.bsky.social", "bob.bsky.social"],
			play: "W",
			draw: "D",
			source: { type: "bsky", uri: "at://post1" },
			reason: "no change",
			status: "pending",
		};
		writeUpdates(TEST_ROUND, [update]);

		const result = applyUpdates(db, TEST_ROUND);
		expect(result.applied).toBe(0);
		expect(result.skipped).toBe(1);

		// No correction record created
		const c = db.prepare("SELECT COUNT(*) as c FROM corrections").get() as any;
		expect(c.c).toBe(0);
	});

	it("dry run does not modify DB or file", () => {
		const update: RoundUpdate = {
			matchup: ["alice.bsky.social", "bob.bsky.social"],
			play: "W",
			draw: "W",
			source: { type: "bsky", uri: "at://post1" },
			reason: "test",
			status: "pending",
		};
		writeUpdates(TEST_ROUND, [update]);

		const result = applyUpdates(db, TEST_ROUND, true);
		expect(result.applied).toBe(1);

		// DB unchanged
		const m = db.prepare("SELECT on_play_verdict FROM matchups WHERE id = 1").get() as any;
		expect(m.on_play_verdict).toBe("L");

		// File unchanged
		const updates = readUpdates(TEST_ROUND);
		expect(updates[0]!.status).toBe("pending");
	});

	it("reports errors for unknown handles", () => {
		const update: RoundUpdate = {
			matchup: ["unknown.bsky.social", "bob.bsky.social"],
			play: "W",
			draw: "W",
			source: { type: "bsky", uri: "at://post1" },
			reason: "test",
			status: "pending",
		};
		writeUpdates(TEST_ROUND, [update]);

		const result = applyUpdates(db, TEST_ROUND);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("could not resolve");
	});
});

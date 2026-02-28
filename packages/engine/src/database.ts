// pattern: Imperative Shell

// SQLite persistence layer for 3CBlue rounds, players, and results.

import Database from "better-sqlite3";

export type RoundPhase = "submission" | "resolution" | "judging" | "complete";

export interface DbRound {
	id: number;
	phase: RoundPhase;
	createdAt: string;
	submissionDeadline: string | null;
	postUri: string | null; // announcement post URI
}

export interface DbPlayer {
	did: string;
	handle: string;
	displayName: string | null;
	createdAt: string;
}

export interface DbSubmission {
	id: number;
	roundId: number;
	playerDid: string;
	card1Name: string;
	card2Name: string;
	card3Name: string;
	card1Json: string; // serialized Card
	card2Json: string;
	card3Json: string;
	submittedAt: string;
}

export interface DbMatchup {
	id: number;
	roundId: number;
	player0Did: string;
	player1Did: string;
	outcome: string; // "player0_wins" | "player1_wins" | "draw" | "unresolved"
	unresolvedReason: string | null;
	judgeResolution: string | null; // "player0_wins" | "player1_wins" | "draw"
	judgedByDid: string | null;
	statsJson: string; // serialized SearchStats or LLM metadata
	llmReasoning: string | null;
	narrative: string | null; // player-facing play-by-play for posting
	postUri: string | null;
}

export function createDatabase(path: string): Database.Database {
	const db = new Database(path);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");
	initSchema(db);
	return db;
}

function initSchema(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS rounds (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			phase TEXT NOT NULL DEFAULT 'submission',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			submission_deadline TEXT,
			post_uri TEXT
		);

		CREATE TABLE IF NOT EXISTS players (
			did TEXT PRIMARY KEY,
			handle TEXT NOT NULL,
			display_name TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS submissions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			round_id INTEGER NOT NULL REFERENCES rounds(id),
			player_did TEXT NOT NULL REFERENCES players(did),
			card1_name TEXT NOT NULL,
			card2_name TEXT NOT NULL,
			card3_name TEXT NOT NULL,
			card1_json TEXT NOT NULL,
			card2_json TEXT NOT NULL,
			card3_json TEXT NOT NULL,
			submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE(round_id, player_did)
		);

		CREATE TABLE IF NOT EXISTS matchups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			round_id INTEGER NOT NULL REFERENCES rounds(id),
			player0_did TEXT NOT NULL REFERENCES players(did),
			player1_did TEXT NOT NULL REFERENCES players(did),
			outcome TEXT NOT NULL,
			unresolved_reason TEXT,
			judge_resolution TEXT,
			judged_by_did TEXT REFERENCES players(did),
			stats_json TEXT NOT NULL,
			llm_reasoning TEXT,
			narrative TEXT,
			post_uri TEXT
		);

		CREATE TABLE IF NOT EXISTS judges (
			did TEXT PRIMARY KEY REFERENCES players(did),
			added_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS banned_cards (
			card_name TEXT NOT NULL,
			banned_from_round INTEGER NOT NULL REFERENCES rounds(id),
			banned_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (card_name)
		);
	`);
}

// --- Round operations ---

export function createRound(
	db: Database.Database,
	deadlineHours = 24,
): DbRound {
	const deadline = new Date(
		Date.now() + deadlineHours * 60 * 60 * 1000,
	).toISOString();

	const stmt = db.prepare(
		"INSERT INTO rounds (phase, submission_deadline) VALUES ('submission', ?) RETURNING *",
	);
	const row = stmt.get(deadline) as Record<string, unknown>;
	return mapRound(row);
}

export function getRound(
	db: Database.Database,
	id: number,
): DbRound | undefined {
	const row = db.prepare("SELECT * FROM rounds WHERE id = ?").get(id) as
		| Record<string, unknown>
		| undefined;
	return row ? mapRound(row) : undefined;
}

export function getActiveRound(db: Database.Database): DbRound | undefined {
	const row = db
		.prepare(
			"SELECT * FROM rounds WHERE phase != 'complete' ORDER BY id DESC LIMIT 1",
		)
		.get() as Record<string, unknown> | undefined;
	return row ? mapRound(row) : undefined;
}

export function updateRoundPhase(
	db: Database.Database,
	roundId: number,
	phase: RoundPhase,
): void {
	db.prepare("UPDATE rounds SET phase = ? WHERE id = ?").run(phase, roundId);
}

export function updateRoundPostUri(
	db: Database.Database,
	roundId: number,
	postUri: string,
): void {
	db.prepare("UPDATE rounds SET post_uri = ? WHERE id = ?").run(
		postUri,
		roundId,
	);
}

// --- Player operations ---

export function upsertPlayer(
	db: Database.Database,
	did: string,
	handle: string,
	displayName: string | null,
): void {
	db.prepare(
		`INSERT INTO players (did, handle, display_name)
		 VALUES (?, ?, ?)
		 ON CONFLICT(did) DO UPDATE SET handle = excluded.handle, display_name = excluded.display_name`,
	).run(did, handle, displayName);
}

export function getPlayer(
	db: Database.Database,
	did: string,
): DbPlayer | undefined {
	const row = db.prepare("SELECT * FROM players WHERE did = ?").get(did) as
		| Record<string, unknown>
		| undefined;
	return row ? mapPlayer(row) : undefined;
}

// --- Submission operations ---

export function upsertSubmission(
	db: Database.Database,
	roundId: number,
	playerDid: string,
	cards: { name: string; json: string }[],
): DbSubmission {
	const c = cards;
	if (c.length !== 3 || !c[0] || !c[1] || !c[2]) {
		throw new Error("exactly 3 cards required");
	}

	const stmt = db.prepare(
		`INSERT INTO submissions (round_id, player_did, card1_name, card2_name, card3_name, card1_json, card2_json, card3_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(round_id, player_did) DO UPDATE SET
			card1_name = excluded.card1_name, card2_name = excluded.card2_name, card3_name = excluded.card3_name,
			card1_json = excluded.card1_json, card2_json = excluded.card2_json, card3_json = excluded.card3_json,
			submitted_at = datetime('now')
		 RETURNING *`,
	);
	const row = stmt.get(
		roundId,
		playerDid,
		c[0].name,
		c[1].name,
		c[2].name,
		c[0].json,
		c[1].json,
		c[2].json,
	) as Record<string, unknown>;
	return mapSubmission(row);
}

export function getSubmissionsForRound(
	db: Database.Database,
	roundId: number,
): DbSubmission[] {
	const rows = db
		.prepare("SELECT * FROM submissions WHERE round_id = ?")
		.all(roundId) as Record<string, unknown>[];
	return rows.map(mapSubmission);
}

// --- Matchup operations ---

export function insertMatchup(
	db: Database.Database,
	roundId: number,
	player0Did: string,
	player1Did: string,
	outcome: string,
	unresolvedReason: string | null,
	statsJson: string,
	llmReasoning?: string | null,
	narrative?: string | null,
): DbMatchup {
	const row = db
		.prepare(
			`INSERT INTO matchups (round_id, player0_did, player1_did, outcome, unresolved_reason, stats_json, llm_reasoning, narrative)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
		)
		.get(
			roundId,
			player0Did,
			player1Did,
			outcome,
			unresolvedReason,
			statsJson,
			llmReasoning ?? null,
			narrative ?? null,
		) as Record<string, unknown>;
	return mapMatchup(row);
}

export function resolveMatchup(
	db: Database.Database,
	matchupId: number,
	resolution: string,
	judgedByDid: string,
): void {
	db.prepare(
		"UPDATE matchups SET judge_resolution = ?, judged_by_did = ? WHERE id = ?",
	).run(resolution, judgedByDid, matchupId);
}

export function getMatchupsForRound(
	db: Database.Database,
	roundId: number,
): DbMatchup[] {
	const rows = db
		.prepare("SELECT * FROM matchups WHERE round_id = ?")
		.all(roundId) as Record<string, unknown>[];
	return rows.map(mapMatchup);
}

export function getUnresolvedMatchups(
	db: Database.Database,
	roundId: number,
): DbMatchup[] {
	const rows = db
		.prepare(
			"SELECT * FROM matchups WHERE round_id = ? AND outcome = 'unresolved' AND judge_resolution IS NULL",
		)
		.all(roundId) as Record<string, unknown>[];
	return rows.map(mapMatchup);
}

/** All matchups from completed rounds, for leaderboard aggregation. */
export function getAllCompletedMatchups(db: Database.Database): DbMatchup[] {
	const rows = db
		.prepare(
			`SELECT m.* FROM matchups m
			 JOIN rounds r ON m.round_id = r.id
			 WHERE r.phase = 'complete'`,
		)
		.all() as Record<string, unknown>[];
	return rows.map(mapMatchup);
}

/** All unique player DIDs who have submitted in completed rounds. */
export function getCompletedRoundPlayerDids(db: Database.Database): string[] {
	const rows = db
		.prepare(
			`SELECT DISTINCT s.player_did FROM submissions s
			 JOIN rounds r ON s.round_id = r.id
			 WHERE r.phase = 'complete'`,
		)
		.all() as Record<string, unknown>[];
	return rows.map((r) => r.player_did as string);
}

/** Count of completed rounds. */
export function getCompletedRoundCount(db: Database.Database): number {
	const row = db
		.prepare("SELECT COUNT(*) as count FROM rounds WHERE phase = 'complete'")
		.get() as { count: number };
	return row.count;
}

// --- Judge operations ---

export function addJudge(db: Database.Database, did: string): void {
	db.prepare("INSERT OR IGNORE INTO judges (did) VALUES (?)").run(did);
}

export function isJudge(db: Database.Database, did: string): boolean {
	const row = db.prepare("SELECT 1 FROM judges WHERE did = ?").get(did);
	return row !== undefined;
}

// --- Winner ban operations ---

export function addWinnerBan(
	db: Database.Database,
	cardName: string,
	roundId: number,
): void {
	db.prepare(
		"INSERT OR IGNORE INTO banned_cards (card_name, banned_from_round) VALUES (?, ?)",
	).run(cardName, roundId);
}

export function getWinnerBans(
	db: Database.Database,
): { cardName: string; bannedFromRound: number }[] {
	const rows = db
		.prepare("SELECT card_name, banned_from_round FROM banned_cards ORDER BY card_name")
		.all() as Record<string, unknown>[];
	return rows.map((r) => ({
		cardName: r.card_name as string,
		bannedFromRound: r.banned_from_round as number,
	}));
}

export function isWinnerBanned(
	db: Database.Database,
	cardName: string,
): boolean {
	const row = db
		.prepare("SELECT 1 FROM banned_cards WHERE card_name = ?")
		.get(cardName);
	return row !== undefined;
}

// --- Row mappers ---

function mapRound(row: Record<string, unknown>): DbRound {
	return {
		id: row.id as number,
		phase: row.phase as RoundPhase,
		createdAt: row.created_at as string,
		submissionDeadline: row.submission_deadline as string | null,
		postUri: row.post_uri as string | null,
	};
}

function mapPlayer(row: Record<string, unknown>): DbPlayer {
	return {
		did: row.did as string,
		handle: row.handle as string,
		displayName: row.display_name as string | null,
		createdAt: row.created_at as string,
	};
}

function mapSubmission(row: Record<string, unknown>): DbSubmission {
	return {
		id: row.id as number,
		roundId: row.round_id as number,
		playerDid: row.player_did as string,
		card1Name: row.card1_name as string,
		card2Name: row.card2_name as string,
		card3Name: row.card3_name as string,
		card1Json: row.card1_json as string,
		card2Json: row.card2_json as string,
		card3Json: row.card3_json as string,
		submittedAt: row.submitted_at as string,
	};
}

function mapMatchup(row: Record<string, unknown>): DbMatchup {
	return {
		id: row.id as number,
		roundId: row.round_id as number,
		player0Did: row.player0_did as string,
		player1Did: row.player1_did as string,
		outcome: row.outcome as string,
		unresolvedReason: row.unresolved_reason as string | null,
		judgeResolution: row.judge_resolution as string | null,
		judgedByDid: row.judged_by_did as string | null,
		statsJson: row.stats_json as string,
		llmReasoning: row.llm_reasoning as string | null,
		narrative: row.narrative as string | null,
		postUri: row.post_uri as string | null,
	};
}

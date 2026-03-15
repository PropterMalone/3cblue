// pattern: Imperative Shell

// Round update system — single source of truth for corrections per round.
// Each round gets a JSONL file in data/round-updates/r{N}-updates.jsonl.
// Every correction is traced to a Bluesky post or a conversation.
// The apply function is idempotent: applied entries are skipped on re-run.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type Database from "better-sqlite3";
import { applyCorrection } from "./database.js";

export interface UpdateSource {
	readonly type: "bsky" | "conversation";
	/** Bluesky post URI (at:// format) for bsky type */
	readonly uri?: string;
	/** Date of conversation for conversation type */
	readonly date?: string;
	/** Brief context for conversation-sourced updates */
	readonly context?: string;
}

export interface RoundUpdate {
	/** Player handles for the matchup (order-independent) */
	readonly matchup: [string, string];
	/** On-play verdict from matchup[0]'s perspective: W/L/D */
	readonly play: string;
	/** On-draw verdict from matchup[0]'s perspective: W/L/D */
	readonly draw: string;
	/** Where this correction came from */
	readonly source: UpdateSource;
	/** Human-readable reason for the correction */
	readonly reason: string;
	/** Status: pending or applied */
	status: "pending" | "applied";
	/** ISO timestamp when applied */
	appliedAt?: string;
}

function updatesPath(roundId: number): string {
	return `data/round-updates/r${roundId}-updates.jsonl`;
}

/** Read all updates for a round. Returns empty array if file doesn't exist. */
export function readUpdates(roundId: number): RoundUpdate[] {
	const path = updatesPath(roundId);
	if (!existsSync(path)) return [];
	const lines = readFileSync(path, "utf-8")
		.split("\n")
		.filter((l) => l.trim());
	return lines.map((line) => JSON.parse(line) as RoundUpdate);
}

/** Write all updates back to the JSONL file. */
export function writeUpdates(roundId: number, updates: RoundUpdate[]): void {
	const path = updatesPath(roundId);
	const content = updates.map((u) => JSON.stringify(u)).join("\n") + "\n";
	writeFileSync(path, content);
}

/** Append a single update to the round's JSONL file. */
export function appendUpdate(roundId: number, update: RoundUpdate): void {
	const path = updatesPath(roundId);
	const line = JSON.stringify(update) + "\n";
	if (existsSync(path)) {
		const existing = readFileSync(path, "utf-8");
		writeFileSync(path, existing.endsWith("\n") ? existing + line : existing + "\n" + line);
	} else {
		writeFileSync(path, line);
	}
}

/** Outcome string from play/draw verdicts (e.g., "WL" → "player0_wins" equivalent) */
function verdictsToOutcome(play: string, draw: string): string {
	// Combine into the matchup outcome format used by the DB
	const map: Record<string, string> = { W: "W", L: "L", D: "D" };
	return `${map[play] ?? "?"}${map[draw] ?? "?"}`;
}

interface ApplyResult {
	readonly applied: number;
	readonly skipped: number;
	readonly errors: string[];
}

/**
 * Apply all pending updates for a round. Idempotent — skips already-applied entries.
 * Looks up matchup IDs by player handles.
 */
export function applyUpdates(
	db: Database.Database,
	roundId: number,
	dryRun = false,
): ApplyResult {
	const updates = readUpdates(roundId);
	let applied = 0;
	let skipped = 0;
	const errors: string[] = [];

	// Build handle→did lookup
	const players = db
		.prepare("SELECT did, handle FROM players")
		.all() as { did: string; handle: string }[];
	const handleToDid = new Map(players.map((p) => [p.handle, p.did]));

	// Normalize handle: strip .bsky.social if needed for lookup
	function resolveDid(handle: string): string | undefined {
		if (handleToDid.has(handle)) return handleToDid.get(handle);
		const full = handle.includes(".") ? handle : `${handle}.bsky.social`;
		if (handleToDid.has(full)) return handleToDid.get(full);
		// Try adding .bsky.social
		const withSuffix = `${handle}.bsky.social`;
		return handleToDid.get(withSuffix);
	}

	for (let i = 0; i < updates.length; i++) {
		const update = updates[i]!;
		if (update.status === "applied") {
			skipped++;
			continue;
		}

		const [hA, hB] = update.matchup;
		const didA = resolveDid(hA);
		const didB = resolveDid(hB);
		if (!didA || !didB) {
			errors.push(`Line ${i + 1}: could not resolve handles: ${hA}, ${hB}`);
			continue;
		}

		// Find the matchup — could be stored in either direction
		const matchup = db
			.prepare(
				`SELECT id, player0_did, on_play_verdict, on_draw_verdict
				 FROM matchups
				 WHERE round_id = ? AND (
					 (player0_did = ? AND player1_did = ?) OR
					 (player0_did = ? AND player1_did = ?)
				 )`,
			)
			.get(roundId, didA, didB, didB, didA) as
			| { id: number; player0_did: string; on_play_verdict: string; on_draw_verdict: string }
			| undefined;

		if (!matchup) {
			errors.push(`Line ${i + 1}: no matchup found for ${hA} vs ${hB}`);
			continue;
		}

		// Determine verdicts from p0's perspective
		let playVerdict = update.play;
		let drawVerdict = update.draw;
		if (matchup.player0_did !== didA) {
			// Flip: update was written from hA's perspective, but DB has hB as p0
			const flip: Record<string, string> = { W: "L", L: "W", D: "D" };
			playVerdict = flip[playVerdict] ?? playVerdict;
			drawVerdict = flip[drawVerdict] ?? drawVerdict;
		}

		// Check if this is actually a change
		if (
			matchup.on_play_verdict === playVerdict &&
			matchup.on_draw_verdict === drawVerdict
		) {
			console.log(
				`  Line ${i + 1}: ${hA} vs ${hB} already ${playVerdict}/${drawVerdict}, skipping`,
			);
			updates[i] = { ...update, status: "applied" as const, appliedAt: new Date().toISOString() };
			skipped++;
			continue;
		}

		const newOutcome = verdictsToOutcome(playVerdict, drawVerdict);
		const sourceLabel =
			update.source.type === "bsky"
				? `bsky:${update.source.uri}`
				: `conversation:${update.source.date}`;

		console.log(
			`  Line ${i + 1}: ${hA} vs ${hB}: ${matchup.on_play_verdict}/${matchup.on_draw_verdict} → ${playVerdict}/${drawVerdict} (${sourceLabel})`,
		);

		if (!dryRun) {
			// Update verdicts on the matchup
			db.prepare(
				"UPDATE matchups SET on_play_verdict = ?, on_draw_verdict = ? WHERE id = ?",
			).run(playVerdict, drawVerdict, matchup.id);

			// Record the correction with audit trail
			applyCorrection(
				db,
				matchup.id,
				newOutcome,
				null, // narrative
				update.source.type === "bsky" ? update.source.uri : `conversation:${update.source.date}`,
				update.reason,
			);

			updates[i] = { ...update, status: "applied" as const, appliedAt: new Date().toISOString() };
		}
		applied++;
	}

	if (!dryRun) {
		writeUpdates(roundId, updates);
	}

	return { applied, skipped, errors };
}

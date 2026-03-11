// pattern: Functional Core

// Structured narrative format for matchup results.
// Stored as JSON in the matchups.narrative column.

export interface MatchupNarrative {
	onPlayVerdict: string; // "player0_wins" | "player1_wins" | "draw"
	onDrawVerdict: string;
	playNarrative: string; // 3-5 sentence play-by-play
	drawNarrative: string;
}

export function serializeNarrative(n: MatchupNarrative): string {
	return JSON.stringify(n);
}

export function parseNarrative(json: string): MatchupNarrative | null {
	try {
		const parsed = JSON.parse(json) as Record<string, unknown>;
		if (
			typeof parsed.onPlayVerdict === "string" &&
			typeof parsed.onDrawVerdict === "string" &&
			typeof parsed.playNarrative === "string" &&
			typeof parsed.drawNarrative === "string"
		) {
			return parsed as unknown as MatchupNarrative;
		}
		// Legacy plain-text narrative — wrap as play narrative only
		return null;
	} catch {
		return null;
	}
}

/** Format a verdict string for display. */
export function verdictDisplayLabel(
	verdict: string,
	handle0: string,
	handle1: string,
): string {
	switch (verdict) {
		case "player0_wins":
			return `@${handle0} wins`;
		case "player1_wins":
			return `@${handle1} wins`;
		case "draw":
			return "Draw";
		default:
			return verdict;
	}
}

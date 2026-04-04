import { describe, expect, it } from "vitest";
import { type DashboardData, generateDashboardHtml } from "./dashboard-html.js";
import type { DbMatchup } from "./database.js";
import type { StandingsEntry } from "./round-lifecycle.js";

function makeMockData(overrides?: Partial<DashboardData>): DashboardData {
	const players = new Map<
		string,
		{ handle: string; cards: [string, string, string] }
	>();
	players.set("did:alice", {
		handle: "alice.bsky.social",
		cards: ["Lightning Bolt", "Snapcaster Mage", "Delver of Secrets"],
	});
	players.set("did:bob", {
		handle: "bob.bsky.social",
		cards: ["Black Lotus", "Ancestral Recall", "Time Walk"],
	});

	const standings: StandingsEntry[] = [
		{
			playerDid: "did:alice",
			points: 3,
			wins: 1,
			draws: 0,
			losses: 0,
			unresolved: 0,
		},
		{
			playerDid: "did:bob",
			points: 0,
			wins: 0,
			draws: 0,
			losses: 1,
			unresolved: 0,
		},
	];

	const matchups: DbMatchup[] = [
		{
			id: 1,
			roundId: 1,
			player0Did: "did:alice",
			player1Did: "did:bob",
			outcome: "player0_wins",
			unresolvedReason: null,
			judgeResolution: null,
			judgedByDid: null,
			statsJson: "{}",
			llmReasoning: null,
			narrative: null,
			postUri: null,
			onPlayVerdict: null,
			onDrawVerdict: null,
			correctionCount: 0,
			reviewStatus: "reviewed" as const,
		},
	];

	return {
		round: { id: 1, phase: "complete", deadline: null, submissionCount: 2 },
		standings,
		matchups,
		players,
		bannedCards: [
			{ cardName: "Lightning Bolt", bannedFromRound: 1 },
			{ cardName: "Snapcaster Mage", bannedFromRound: 1 },
		],
		...overrides,
	};
}

describe("generateDashboardHtml", () => {
	it("includes round info", () => {
		const html = generateDashboardHtml(makeMockData());
		expect(html).toContain("Round 1 Dashboard");
		expect(html).toContain("Complete");
		expect(html).toContain(">2<"); // player count
	});

	it("includes player handles in standings", () => {
		const html = generateDashboardHtml(makeMockData());
		expect(html).toContain("@alice.bsky.social");
		expect(html).toContain("@bob.bsky.social");
	});

	it("includes deck cards in standings for complete phase", () => {
		const html = generateDashboardHtml(makeMockData());
		expect(html).toContain("Lightning Bolt");
		expect(html).toContain("Black Lotus");
	});

	it("includes points in standings", () => {
		const html = generateDashboardHtml(makeMockData());
		expect(html).toContain(">3<");
	});

	it("renders matchup matrix with W/L results", () => {
		const html = generateDashboardHtml(makeMockData());
		expect(html).toContain("Matchup Matrix");
		expect(html).toContain('class="res-w"');
		expect(html).toContain('class="res-l"');
	});

	it("renders banned cards", () => {
		const html = generateDashboardHtml(makeMockData());
		expect(html).toContain("Lightning Bolt");
		expect(html).toContain("Snapcaster Mage");
		expect(html).toContain("(R1)");
	});

	it("shows deadline when present", () => {
		const html = generateDashboardHtml(
			makeMockData({
				round: {
					id: 2,
					phase: "submission",
					deadline: "2026-03-10T00:00:00Z",
					submissionCount: 5,
				},
			}),
		);
		expect(html).toContain("Deadline");
		expect(html).toContain("2026-03-10T00:00:00Z");
	});

	it("shows placeholder when no matchups in resolution", () => {
		const html = generateDashboardHtml(
			makeMockData({
				round: {
					id: 1,
					phase: "resolution",
					deadline: null,
					submissionCount: 2,
				},
				standings: [],
				matchups: [],
			}),
		);
		expect(html).toContain("No matchups resolved yet");
		expect(html).not.toContain("Matchup Matrix");
	});

	it("shows 'None yet' when no banned cards", () => {
		const html = generateDashboardHtml(makeMockData({ bannedCards: [] }));
		expect(html).toContain("None yet");
	});

	it("handles draw outcomes in matrix", () => {
		const matchups: DbMatchup[] = [
			{
				id: 1,
				roundId: 1,
				player0Did: "did:alice",
				player1Did: "did:bob",
				outcome: "draw",
				unresolvedReason: null,
				judgeResolution: null,
				judgedByDid: null,
				statsJson: "{}",
				llmReasoning: null,
				narrative: null,
				postUri: null,
				onPlayVerdict: null,
				onDrawVerdict: null,
				correctionCount: 0,
				reviewStatus: "reviewed" as const,
			},
		];
		const html = generateDashboardHtml(makeMockData({ matchups }));
		expect(html).toContain('class="res-d"');
	});

	it("respects judge resolution over original outcome", () => {
		const matchups: DbMatchup[] = [
			{
				id: 1,
				roundId: 1,
				player0Did: "did:alice",
				player1Did: "did:bob",
				outcome: "unresolved",
				unresolvedReason: "complex interaction",
				judgeResolution: "player1_wins",
				judgedByDid: "did:judge",
				statsJson: "{}",
				llmReasoning: null,
				narrative: null,
				postUri: null,
				onPlayVerdict: null,
				onDrawVerdict: null,
				correctionCount: 0,
				reviewStatus: "reviewed" as const,
			},
		];
		const html = generateDashboardHtml(makeMockData({ matchups }));
		expect(html).toContain('class="res-l"');
		expect(html).toContain('class="res-w"');
		expect(html).not.toContain('class="res-q"');
	});

	it("shows ? for unresolved matchups", () => {
		const matchups: DbMatchup[] = [
			{
				id: 1,
				roundId: 1,
				player0Did: "did:alice",
				player1Did: "did:bob",
				outcome: "unresolved",
				unresolvedReason: "complex interaction",
				judgeResolution: null,
				judgedByDid: null,
				statsJson: "{}",
				llmReasoning: null,
				narrative: null,
				postUri: null,
				onPlayVerdict: null,
				onDrawVerdict: null,
				correctionCount: 0,
				reviewStatus: "reviewed" as const,
			},
		];
		const html = generateDashboardHtml(makeMockData({ matchups }));
		expect(html).toContain('class="res-q"');
	});

	it("escapes HTML in card names", () => {
		const players = new Map<
			string,
			{ handle: string; cards: [string, string, string] }
		>();
		players.set("did:alice", {
			handle: "alice",
			cards: ["<script>alert(1)</script>", "Card 2", "Card 3"],
		});
		const standings: StandingsEntry[] = [
			{
				playerDid: "did:alice",
				points: 0,
				wins: 0,
				draws: 0,
				losses: 0,
				unresolved: 0,
			},
		];
		const html = generateDashboardHtml(
			makeMockData({ players, matchups: [], standings }),
		);
		// malicious name must be escaped even though legitimate <script> blocks exist
		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain('"><script>');
	});

	it("returns valid HTML structure", () => {
		const html = generateDashboardHtml(makeMockData());
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("</html>");
		expect(html).toContain("<title>3CBlue Dashboard");
	});

	it("applies phase-specific CSS class", () => {
		const html = generateDashboardHtml(
			makeMockData({
				round: {
					id: 2,
					phase: "submission",
					deadline: null,
					submissionCount: 0,
				},
			}),
		);
		expect(html).toContain("phase-submission");
	});
});

describe("phase visibility gating", () => {
	it("submission phase hides decklists, standings, and matrix", () => {
		const html = generateDashboardHtml(
			makeMockData({
				round: {
					id: 2,
					phase: "submission",
					deadline: "2026-03-10T00:00:00Z",
					submissionCount: 5,
				},
				bannedCards: [],
			}),
		);
		// Should NOT show card names, standings table, or matrix
		expect(html).not.toContain("Lightning Bolt");
		expect(html).not.toContain("Black Lotus");
		expect(html).not.toContain("Matchup Matrix");
		expect(html).not.toContain("@alice.bsky.social");
		expect(html).not.toContain("<h2>Standings</h2>");
		// Should show player count and deadline
		expect(html).toContain('"value">5<');
		expect(html).toContain("2026-03-10T00:00:00Z");
		expect(html).toContain("Decklists will be revealed");
	});

	it("submission phase still shows banned cards", () => {
		const html = generateDashboardHtml(
			makeMockData({
				round: {
					id: 2,
					phase: "submission",
					deadline: null,
					submissionCount: 3,
				},
				bannedCards: [
					{ cardName: "Chancellor of the Annex", bannedFromRound: 1 },
				],
			}),
		);
		expect(html).toContain("Chancellor of the Annex");
		expect(html).toContain("Banned Cards");
	});

	it("resolution phase shows decklists and standings", () => {
		const html = generateDashboardHtml(
			makeMockData({
				round: {
					id: 2,
					phase: "resolution",
					deadline: null,
					submissionCount: 2,
				},
			}),
		);
		expect(html).toContain("Lightning Bolt");
		expect(html).toContain("@alice.bsky.social");
		expect(html).toContain("Standings");
		expect(html).toContain("Matchup Matrix");
	});

	it("judging phase shows decklists and matrix", () => {
		const html = generateDashboardHtml(
			makeMockData({
				round: {
					id: 2,
					phase: "judging",
					deadline: null,
					submissionCount: 2,
				},
			}),
		);
		expect(html).toContain("Lightning Bolt");
		expect(html).toContain("Matchup Matrix");
	});

	it("submission phase does not show matchup count box", () => {
		const html = generateDashboardHtml(
			makeMockData({
				round: {
					id: 2,
					phase: "submission",
					deadline: null,
					submissionCount: 5,
				},
			}),
		);
		expect(html).not.toContain("Matchups");
	});
});

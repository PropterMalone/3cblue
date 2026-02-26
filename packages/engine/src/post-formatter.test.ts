// pattern: Functional Core
import { describe, expect, it } from "vitest";
import type { DbMatchup, DbSubmission } from "./database.js";
import {
	formatMatchupResults,
	formatRevealPost,
	formatStandings,
	formatUnresolvedMatchup,
} from "./post-formatter.js";
import type { StandingsEntry } from "./round-lifecycle.js";

const handleMap = new Map([
	["did:plc:abc", "alice.bsky.social"],
	["did:plc:def", "bob.bsky.social"],
	["did:plc:ghi", "charlie.bsky.social"],
]);

function makeSub(
	playerDid: string,
	c1: string,
	c2: string,
	c3: string,
): DbSubmission {
	return {
		id: 1,
		roundId: 1,
		playerDid,
		card1Name: c1,
		card2Name: c2,
		card3Name: c3,
		card1Json: "{}",
		card2Json: "{}",
		card3Json: "{}",
		submittedAt: "",
	};
}

describe("formatRevealPost", () => {
	it("formats player decks", () => {
		const subs = [
			makeSub("did:plc:abc", "Lightning Bolt", "Snapcaster Mage", "Delver"),
			makeSub("did:plc:def", "Bear", "Elephant", "Eagle"),
		];
		const posts = formatRevealPost(1, subs, handleMap);
		expect(posts.length).toBeGreaterThanOrEqual(1);
		expect(posts[0]).toContain("Round 1");
		expect(posts[0]).toContain("@alice.bsky.social");
		expect(posts[0]).toContain("Lightning Bolt");
	});

	it("splits long reveals into multiple posts", () => {
		// Create enough submissions to exceed 300 chars
		const subs = Array.from({ length: 10 }, (_, i) =>
			makeSub(
				`did:plc:${i}`,
				"Emrakul the Aeons Torn",
				"Snapcaster Mage",
				"Lightning Bolt",
			),
		);
		const bigHandleMap = new Map(
			Array.from({ length: 10 }, (_, i) => [
				`did:plc:${i}`,
				`player${i}.bsky.social`,
			]),
		);
		const posts = formatRevealPost(1, subs, bigHandleMap);
		expect(posts.length).toBeGreaterThan(1);
		for (const post of posts) {
			expect(post.length).toBeLessThanOrEqual(300);
		}
	});
});

describe("formatMatchupResults", () => {
	it("formats outcomes", () => {
		const matchups: DbMatchup[] = [
			{
				id: 1,
				roundId: 1,
				player0Did: "did:plc:abc",
				player1Did: "did:plc:def",
				outcome: "player0_wins",
				unresolvedReason: null,
				judgeResolution: null,
				judgedByDid: null,
				statsJson: "{}",
				postUri: null,
			},
		];
		const posts = formatMatchupResults(1, matchups, handleMap);
		expect(posts[0]).toContain("P0 wins");
		expect(posts[0]).toContain("@alice.bsky.social");
	});
});

describe("formatStandings", () => {
	it("formats standings table", () => {
		const standings: StandingsEntry[] = [
			{
				playerDid: "did:plc:abc",
				points: 9,
				wins: 3,
				draws: 0,
				losses: 0,
				unresolved: 0,
			},
			{
				playerDid: "did:plc:def",
				points: 3,
				wins: 1,
				draws: 0,
				losses: 2,
				unresolved: 0,
			},
		];
		const text = formatStandings(1, standings, handleMap);
		expect(text).toContain("1. @alice.bsky.social — 9pts");
		expect(text).toContain("2. @bob.bsky.social — 3pts");
	});
});

describe("formatUnresolvedMatchup", () => {
	it("formats judge request", () => {
		const m: DbMatchup = {
			id: 42,
			roundId: 1,
			player0Did: "did:plc:abc",
			player1Did: "did:plc:def",
			outcome: "unresolved",
			unresolvedReason: "cards with unresolved abilities: Snapcaster Mage",
			judgeResolution: null,
			judgedByDid: null,
			statsJson: "{}",
			postUri: null,
		};
		const text = formatUnresolvedMatchup(m, handleMap);
		expect(text).toContain("Needs judge");
		expect(text).toContain("Snapcaster Mage");
	});
});

// pattern: Functional Core
import type { Card } from "@3cblue/shared";
import { describe, expect, it } from "vitest";
import type { DeckInfo, MatchupVerdict } from "./round-resolution-prompts.js";
import {
	buildDeckAgentPrompt,
	crosscheckAllPairs,
	crosscheckVerdicts,
	flipVerdict,
	parseAgentVerdicts,
} from "./round-resolution-prompts.js";

const goblinGuide: Card = {
	name: "Goblin Guide",
	manaCost: "{R}",
	cmc: 1,
	colors: ["R"],
	types: ["creature"],
	supertypes: [],
	subtypes: ["Goblin", "Scout"],
	oracleText: "Haste",
	power: 2,
	toughness: 2,
	abilities: [],
	scryfallId: "test",
};

const island: Card = {
	name: "Island",
	manaCost: "",
	cmc: 0,
	colors: [],
	types: ["land"],
	supertypes: ["basic"],
	subtypes: ["Island"],
	oracleText: "({T}: Add {U}.)",
	abilities: [],
	scryfallId: "test",
};

const bear: Card = {
	name: "Grizzly Bears",
	manaCost: "{1}{G}",
	cmc: 2,
	colors: ["G"],
	types: ["creature"],
	supertypes: [],
	subtypes: ["Bear"],
	oracleText: "",
	power: 2,
	toughness: 2,
	abilities: [],
	scryfallId: "test",
};

function makeDeck(did: string, handle: string, cards: Card[]): DeckInfo {
	return { playerDid: did, handle, cards };
}

const deckA = makeDeck("did:plc:alice", "alice.bsky.social", [
	goblinGuide,
	goblinGuide,
	goblinGuide,
]);
const deckB = makeDeck("did:plc:bob", "bob.bsky.social", [bear, bear, bear]);
const deckC = makeDeck("did:plc:charlie", "charlie.bsky.social", [
	island,
	island,
	island,
]);

describe("buildDeckAgentPrompt", () => {
	it("includes deck cards and opponent cards", () => {
		const prompt = buildDeckAgentPrompt(deckA, [deckB, deckC]);
		expect(prompt).toContain("Your Deck (@alice.bsky.social)");
		expect(prompt).toContain("Goblin Guide");
		expect(prompt).toContain("Opponent: @bob.bsky.social");
		expect(prompt).toContain("Grizzly Bears");
		expect(prompt).toContain("Opponent: @charlie.bsky.social");
		expect(prompt).toContain("Island");
	});

	it("includes 3CB rules", () => {
		const prompt = buildDeckAgentPrompt(deckA, [deckB]);
		expect(prompt).toContain("3CB Rules");
		expect(prompt).toContain("empty library does NOT cause a loss");
	});

	it("includes output format template for each opponent", () => {
		const prompt = buildDeckAgentPrompt(deckA, [deckB, deckC]);
		expect(prompt).toContain("### vs @bob.bsky.social");
		expect(prompt).toContain("### vs @charlie.bsky.social");
		expect(prompt).toContain("#### On the Play");
		expect(prompt).toContain("#### On the Draw");
		expect(prompt).toContain("#### Overall");
	});
});

describe("parseAgentVerdicts", () => {
	const agentOutput = `### vs @bob.bsky.social

#### On the Play
Goblin Guide attacks immediately for 2 each turn.
VERDICT: P0_WINS
NARRATIVE: Goblin Guide's haste lets Alice race before Bears can block.

#### On the Draw
Bears come down same turn as Guides but can trade.
VERDICT: DRAW
NARRATIVE: Bears trade evenly with Guides when Bob goes first.

#### Overall
VERDICT: P0_WINS

### vs @charlie.bsky.social

#### On the Play
Islands do nothing. Goblin Guide races freely.
VERDICT: P0_WINS
NARRATIVE: Three hasty Guides attack unopposed for a quick win.

#### On the Draw
Same result — Islands can't interact.
VERDICT: P0_WINS
NARRATIVE: Islands offer no defense against hasty creatures.

#### Overall
VERDICT: P0_WINS
`;

	it("extracts verdicts for all opponents", () => {
		const verdicts = parseAgentVerdicts(agentOutput, [deckB, deckC]);
		expect(verdicts).toHaveLength(2);

		expect(verdicts[0]?.opponentDid).toBe("did:plc:bob");
		expect(verdicts[0]?.onThePlay).toBe("player0_wins");
		expect(verdicts[0]?.onTheDraw).toBe("draw");
		expect(verdicts[0]?.overall).toBe("player0_wins");

		expect(verdicts[1]?.opponentDid).toBe("did:plc:charlie");
		expect(verdicts[1]?.onThePlay).toBe("player0_wins");
		expect(verdicts[1]?.onTheDraw).toBe("player0_wins");
		expect(verdicts[1]?.overall).toBe("player0_wins");
	});

	it("extracts narratives", () => {
		const verdicts = parseAgentVerdicts(agentOutput, [deckB, deckC]);
		expect(verdicts[0]?.playNarrative).toContain("haste");
		expect(verdicts[0]?.drawNarrative).toContain("Bears trade");
		expect(verdicts[1]?.playNarrative).toContain("unopposed");
	});

	it("throws on missing opponent section", () => {
		expect(() => parseAgentVerdicts("no sections here", [deckB])).toThrow(
			"failed to find section",
		);
	});

	it("throws on missing subsection", () => {
		const partial = `### vs @bob.bsky.social

#### On the Play
VERDICT: P0_WINS
NARRATIVE: test
`;
		expect(() => parseAgentVerdicts(partial, [deckB])).toThrow(
			"missing 'On the Draw' subsection",
		);
	});

	it("uses last verdict when agent self-corrects", () => {
		const selfCorrect = `### vs @bob.bsky.social

#### On the Play
Initially I thought...
VERDICT: DRAW
Wait, actually Goblin Guide has haste.
VERDICT: P0_WINS
NARRATIVE: Guides race ahead.

#### On the Draw
VERDICT: DRAW
NARRATIVE: Even game.

#### Overall
VERDICT: P0_WINS
`;
		const verdicts = parseAgentVerdicts(selfCorrect, [deckB]);
		expect(verdicts[0]?.onThePlay).toBe("player0_wins");
	});
});

describe("flipVerdict", () => {
	it("flips player0_wins to player1_wins", () => {
		expect(flipVerdict("player0_wins")).toBe("player1_wins");
	});

	it("flips player1_wins to player0_wins", () => {
		expect(flipVerdict("player1_wins")).toBe("player0_wins");
	});

	it("leaves draw unchanged", () => {
		expect(flipVerdict("draw")).toBe("draw");
	});
});

describe("crosscheckVerdicts", () => {
	it("detects agreement when both say A wins", () => {
		// Agent A says A wins (P0_WINS from A's perspective)
		const aVerdict: MatchupVerdict = {
			opponentDid: "did:plc:bob",
			onThePlay: "player0_wins",
			onTheDraw: "player0_wins",
			overall: "player0_wins",
			playNarrative: "A wins on play",
			drawNarrative: "A wins on draw",
		};
		// Agent B says A wins (P1_WINS from B's perspective)
		const bVerdict: MatchupVerdict = {
			opponentDid: "did:plc:alice",
			onThePlay: "player1_wins",
			onTheDraw: "player1_wins",
			overall: "player1_wins",
			playNarrative: "A wins (from B's view)",
			drawNarrative: "A wins on draw (from B's view)",
		};

		const result = crosscheckVerdicts(
			"did:plc:alice",
			"did:plc:bob",
			aVerdict,
			bVerdict,
			"raw A",
			"raw B",
		);
		expect(result.agreed).toBe(true);
		expect(result.outcome).toBe("player0_wins");
		// Winner is P0 (alice), so use A's narratives
		expect(result.playNarrative).toBe("A wins on play");
	});

	it("detects disagreement", () => {
		const aVerdict: MatchupVerdict = {
			opponentDid: "did:plc:bob",
			onThePlay: "player0_wins",
			onTheDraw: "player0_wins",
			overall: "player0_wins",
			playNarrative: "A wins",
			drawNarrative: "A wins",
		};
		// Agent B also says B wins (P0_WINS from B's perspective)
		const bVerdict: MatchupVerdict = {
			opponentDid: "did:plc:alice",
			onThePlay: "player0_wins",
			onTheDraw: "player0_wins",
			overall: "player0_wins",
			playNarrative: "B wins",
			drawNarrative: "B wins",
		};

		const result = crosscheckVerdicts(
			"did:plc:alice",
			"did:plc:bob",
			aVerdict,
			bVerdict,
			"raw A",
			"raw B",
		);
		expect(result.agreed).toBe(false);
		expect(result.agentAVerdict).toBeDefined();
		expect(result.agentBVerdict).toBeDefined();
	});

	it("agrees on draw", () => {
		const aVerdict: MatchupVerdict = {
			opponentDid: "did:plc:bob",
			onThePlay: "player0_wins",
			onTheDraw: "player1_wins",
			overall: "draw",
			playNarrative: "A wins on play",
			drawNarrative: "B wins when going first",
		};
		const bVerdict: MatchupVerdict = {
			opponentDid: "did:plc:alice",
			onThePlay: "player0_wins",
			onTheDraw: "player1_wins",
			overall: "draw",
			playNarrative: "B wins on play",
			drawNarrative: "A wins when going first",
		};

		const result = crosscheckVerdicts(
			"did:plc:alice",
			"did:plc:bob",
			aVerdict,
			bVerdict,
			"raw A",
			"raw B",
		);
		expect(result.agreed).toBe(true);
		expect(result.outcome).toBe("draw");
		// For draws, use A's (P0's) narratives
		expect(result.playNarrative).toBe("A wins on play");
	});

	it("uses B's narrative when B wins", () => {
		const aVerdict: MatchupVerdict = {
			opponentDid: "did:plc:bob",
			onThePlay: "player1_wins",
			onTheDraw: "player1_wins",
			overall: "player1_wins",
			playNarrative: "A loses on play",
			drawNarrative: "A loses on draw",
		};
		const bVerdict: MatchupVerdict = {
			opponentDid: "did:plc:alice",
			onThePlay: "player0_wins",
			onTheDraw: "player0_wins",
			overall: "player0_wins",
			playNarrative: "B wins on play",
			drawNarrative: "B wins on draw",
		};

		const result = crosscheckVerdicts(
			"did:plc:alice",
			"did:plc:bob",
			aVerdict,
			bVerdict,
			"raw A",
			"raw B",
		);
		expect(result.agreed).toBe(true);
		expect(result.outcome).toBe("player1_wins");
		// B wins, so use B's narratives (flipped perspective)
		expect(result.playNarrative).toBe("B wins on draw");
		expect(result.drawNarrative).toBe("B wins on play");
	});
});

describe("crosscheckAllPairs", () => {
	it("crosschecks all pairs from agent results", () => {
		const agentResults = new Map<
			string,
			{ verdicts: MatchupVerdict[]; rawOutput: string }
		>();

		// Alice's agent: beats Bob, loses to Charlie
		agentResults.set("did:plc:alice", {
			verdicts: [
				{
					opponentDid: "did:plc:bob",
					onThePlay: "player0_wins",
					onTheDraw: "player0_wins",
					overall: "player0_wins",
					playNarrative: "A beats B",
					drawNarrative: "A beats B",
				},
				{
					opponentDid: "did:plc:charlie",
					onThePlay: "player1_wins",
					onTheDraw: "player1_wins",
					overall: "player1_wins",
					playNarrative: "C beats A",
					drawNarrative: "C beats A",
				},
			],
			rawOutput: "alice raw",
		});

		// Bob's agent: agrees Alice beats him, beats Charlie
		agentResults.set("did:plc:bob", {
			verdicts: [
				{
					opponentDid: "did:plc:alice",
					onThePlay: "player1_wins",
					onTheDraw: "player1_wins",
					overall: "player1_wins",
					playNarrative: "A beats B",
					drawNarrative: "A beats B",
				},
				{
					opponentDid: "did:plc:charlie",
					onThePlay: "player0_wins",
					onTheDraw: "player0_wins",
					overall: "player0_wins",
					playNarrative: "B beats C",
					drawNarrative: "B beats C",
				},
			],
			rawOutput: "bob raw",
		});

		// Charlie's agent: agrees she beats Alice, DISAGREES about Bob (says she beats Bob too)
		agentResults.set("did:plc:charlie", {
			verdicts: [
				{
					opponentDid: "did:plc:alice",
					onThePlay: "player0_wins",
					onTheDraw: "player0_wins",
					overall: "player0_wins",
					playNarrative: "C beats A",
					drawNarrative: "C beats A",
				},
				{
					opponentDid: "did:plc:bob",
					onThePlay: "player0_wins",
					onTheDraw: "player0_wins",
					overall: "player0_wins",
					playNarrative: "C beats B",
					drawNarrative: "C beats B",
				},
			],
			rawOutput: "charlie raw",
		});

		const { agreements, disagreements } = crosscheckAllPairs(agentResults);

		// Alice vs Bob: agree (A wins)
		// Alice vs Charlie: agree (C wins)
		// Bob vs Charlie: disagree (Bob says B wins, Charlie says C wins)
		expect(agreements).toHaveLength(2);
		expect(disagreements).toHaveLength(1);

		expect(disagreements[0]?.player0Did).toBe("did:plc:bob");
		expect(disagreements[0]?.player1Did).toBe("did:plc:charlie");
	});
});

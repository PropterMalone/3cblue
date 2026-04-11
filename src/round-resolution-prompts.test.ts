import { describe, expect, it } from "vitest";
import type { Card } from "./card-types.js";
import type { DeckInfo, MatchupVerdict } from "./round-resolution-prompts.js";
import {
	buildDeckAgentPrompt,
	buildDeckPlansPrompt,
	buildNarrativeOnlyPrompt,
	canonicalDeckKey,
	crosscheckAllPairs,
	crosscheckVerdicts,
	flipVerdict,
	parseAgentVerdicts,
	parseDeckPlans,
	parseNarrativeOnlyOutput,
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
		expect(prompt).not.toContain("#### Overall");
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
		const aVerdict: MatchupVerdict = {
			opponentDid: "did:plc:bob",
			onThePlay: "player0_wins",
			onTheDraw: "player0_wins",
			overall: "player0_wins",
			playNarrative: "A wins on play",
			drawNarrative: "A wins on draw",
		};
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

		expect(agreements).toHaveLength(2);
		expect(disagreements).toHaveLength(1);

		expect(disagreements[0]?.player0Did).toBe("did:plc:bob");
		expect(disagreements[0]?.player1Did).toBe("did:plc:charlie");
	});
});

describe("canonicalDeckKey", () => {
	it("sorts card names case-insensitively", () => {
		const key = canonicalDeckKey([goblinGuide, island, bear]);
		expect(key).toBe("goblin guide|grizzly bears|island");
	});

	it("produces same key regardless of card order", () => {
		const k1 = canonicalDeckKey([bear, island, goblinGuide]);
		const k2 = canonicalDeckKey([island, goblinGuide, bear]);
		expect(k1).toBe(k2);
	});
});

describe("buildNarrativeOnlyPrompt", () => {
	it("includes the known outcome", () => {
		const prompt = buildNarrativeOnlyPrompt(deckA, deckB, "player0_wins");
		expect(prompt).toContain("@alice.bsky.social wins");
		expect(prompt).toContain("already been determined");
	});

	it("includes both decks", () => {
		const prompt = buildNarrativeOnlyPrompt(deckA, deckB, "draw");
		expect(prompt).toContain("Goblin Guide");
		expect(prompt).toContain("Grizzly Bears");
		expect(prompt).toContain("draw");
	});
});

describe("parseNarrativeOnlyOutput", () => {
	it("extracts play and draw narratives", () => {
		const output = `#### On the Play (A goes first)
NARRATIVE: Goblin Guide attacks for 2 on T1, Bolt finishes it.

#### On the Draw (B goes first)
NARRATIVE: Counterspell stops the key play, stalling to a draw.`;

		const result = parseNarrativeOnlyOutput(output);
		expect(result.playNarrative).toContain("Goblin Guide attacks");
		expect(result.drawNarrative).toContain("Counterspell stops");
	});
});

describe("deck plans", () => {
	it("buildDeckAgentPrompt injects deck plans when present", () => {
		const deckWithPlan: DeckInfo = {
			...deckA,
			deckPlan:
				"Three hasty 2/2s race for 6 damage per turn. Wins against anything that can't block or interact on T1.",
		};
		const oppWithPlan: DeckInfo = {
			...deckB,
			deckPlan:
				"Three vanilla 2/2s for 2 mana each. Needs T2 to deploy, loses the race to haste creatures.",
		};
		const prompt = buildDeckAgentPrompt(deckWithPlan, [oppWithPlan]);
		expect(prompt).toContain("**Deck plan:** Three hasty 2/2s");
		expect(prompt).toContain("**Deck plan:** Three vanilla 2/2s");
	});

	it("buildDeckAgentPrompt works without deck plans", () => {
		const prompt = buildDeckAgentPrompt(deckA, [deckB]);
		expect(prompt).not.toContain("**Deck plan:**");
		expect(prompt).toContain("Goblin Guide");
	});

	it("buildNarrativeOnlyPrompt injects deck plans when present", () => {
		const d0: DeckInfo = { ...deckA, deckPlan: "Aggro plan" };
		const d1: DeckInfo = { ...deckB, deckPlan: "Midrange plan" };
		const prompt = buildNarrativeOnlyPrompt(d0, d1, "player0_wins");
		expect(prompt).toContain("**Deck plan:** Aggro plan");
		expect(prompt).toContain("**Deck plan:** Midrange plan");
	});

	it("buildDeckPlansPrompt includes all decks and rules", () => {
		const prompt = buildDeckPlansPrompt([deckA, deckB, deckC]);
		expect(prompt).toContain("3CB Rules");
		expect(prompt).toContain("@alice.bsky.social");
		expect(prompt).toContain("Goblin Guide");
		expect(prompt).toContain("@bob.bsky.social");
		expect(prompt).toContain("Grizzly Bears");
		expect(prompt).toContain("@charlie.bsky.social");
		expect(prompt).toContain("Island");
		expect(prompt).toContain("2-3 sentence game plan");
	});

	it("parseDeckPlans extracts plans from LLM output", () => {
		const output = `### @alice.bsky.social
Three Goblin Guides attack for 6 on T1 with haste. Wins the race against anything without instant-speed interaction. Vulnerable to blockers that come down T1 (e.g., Memnite).

### @bob.bsky.social
Three Grizzly Bears deploy on T2 for 2 mana each. Trades well in combat but loses the race to haste. Needs the opponent to stumble on mana.

### @charlie.bsky.social
Three Islands produce mana but have no payoff. Cannot win — stalemate at best if opponent also has no threats.`;

		const plans = parseDeckPlans(output, [deckA, deckB, deckC]);
		expect(plans.size).toBe(3);
		expect(plans.get("alice.bsky.social")).toContain("Goblin Guides attack");
		expect(plans.get("bob.bsky.social")).toContain("Grizzly Bears deploy");
		expect(plans.get("charlie.bsky.social")).toContain("Three Islands");
	});

	it("parseDeckPlans handles missing sections gracefully", () => {
		const output = `### @alice.bsky.social
Goblin Guide rushes in.`;

		const plans = parseDeckPlans(output, [deckA, deckB]);
		expect(plans.size).toBe(1);
		expect(plans.has("alice.bsky.social")).toBe(true);
		expect(plans.has("bob.bsky.social")).toBe(false);
	});
});

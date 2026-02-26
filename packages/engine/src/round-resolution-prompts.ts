// pattern: Functional Core

// Prompt construction, verdict parsing, and crosscheck logic for per-deck agent evaluation.
// Each agent evaluates all matchups from one deck's perspective (as Player 0).
// Crosscheck compares verdicts from both sides to flag disagreements.

import type { Card } from "@3cblue/shared";

export const THREE_CB_RULES = `## 3CB Rules
- Each player has a 3-card hand and no library. Drawing from an empty library does NOT cause a loss.
- Normal Magic rules apply otherwise. Starting life: 20.
- All of Magic is legal except un-sets, ante, subgames, and wishes/sideboard cards.
- Both players play optimally to maximize their tournament result (3 pts for win, 1 for draw, 0 for loss).
- Coin flips and dice rolls resolve to the worst outcome for the controller.
- If one player wins regardless of who goes first, that player wins the matchup.
- If the result depends on who goes first (each player wins on the play), it's a draw.
- If neither player can force a win in either direction, it's a draw.`;

export interface DeckInfo {
	playerDid: string;
	handle: string;
	cards: Card[];
}

export type Verdict = "player0_wins" | "player1_wins" | "draw";

export interface MatchupVerdict {
	opponentDid: string;
	onThePlay: Verdict;
	onTheDraw: Verdict;
	overall: Verdict;
	playNarrative: string;
	drawNarrative: string;
}

export interface CrosscheckResult {
	player0Did: string;
	player1Did: string;
	agreed: boolean;
	outcome?: Verdict;
	// Winner's narrative (or P0's for draws)
	playNarrative?: string;
	drawNarrative?: string;
	// Full reasoning from both agents (for llm_reasoning column)
	combinedReasoning?: string;
	// Present on disagreement
	agentAVerdict?: MatchupVerdict;
	agentBVerdict?: MatchupVerdict;
}

function formatCardForPrompt(card: Card): string {
	const mana = card.manaCost ? ` ${card.manaCost}` : "";
	const pt =
		card.power !== undefined ? ` — ${card.power}/${card.toughness}` : "";
	return `**${card.name}**${mana}\n${card.types.join(" ")}${pt}\n${card.oracleText || "(no text)"}`;
}

function formatDeckBlock(label: string, cards: readonly Card[]): string {
	return `## ${label}\n${cards.map(formatCardForPrompt).join("\n\n")}`;
}

/** Build the full prompt for a per-deck agent. */
export function buildDeckAgentPrompt(
	myDeck: DeckInfo,
	opponents: readonly DeckInfo[],
): string {
	const sections: string[] = [
		"You are evaluating Three Card Blind (3CB) matchups for one deck against all opponents.",
		"",
		THREE_CB_RULES,
		"",
		formatDeckBlock(`Your Deck (@${myDeck.handle})`, myDeck.cards),
		"",
		"---",
		"",
	];

	for (const opp of opponents) {
		sections.push(formatDeckBlock(`Opponent: @${opp.handle}`, opp.cards), "");
	}

	sections.push(`## Instructions
For each opponent, evaluate the matchup assuming optimal play from both sides.
Analyze both scenarios: you go first (on the play) and opponent goes first (on the draw).

For each matchup, produce:
1. On-the-play verdict + narrative (you go first)
2. On-the-draw verdict + narrative (opponent goes first)
3. Overall verdict

Narratives: 1-2 sentences describing the key plays, written for Magic players.
Keep each narrative under 200 characters.
Think step by step about mana, interaction timing, and combat math.

## Output Format (follow exactly)
`);

	for (const opp of opponents) {
		sections.push(`### vs @${opp.handle}

#### On the Play
[your analysis of this scenario]
VERDICT: P0_WINS | P1_WINS | DRAW
NARRATIVE: [1-2 sentences, under 200 chars]

#### On the Draw
[your analysis of this scenario]
VERDICT: P0_WINS | P1_WINS | DRAW
NARRATIVE: [1-2 sentences, under 200 chars]

#### Overall
VERDICT: P0_WINS | P1_WINS | DRAW
`);
	}

	return sections.join("\n");
}

/** Parse structured verdicts from a per-deck agent's output. */
export function parseAgentVerdicts(
	agentOutput: string,
	opponents: readonly DeckInfo[],
): MatchupVerdict[] {
	const results: MatchupVerdict[] = [];

	for (const opp of opponents) {
		// Find the section for this opponent
		const handlePattern = opp.handle.replace(/\./g, "\\.");
		const sectionRegex = new RegExp(
			`### vs @${handlePattern}([\\s\\S]*?)(?=### vs @|$)`,
		);
		const section = agentOutput.match(sectionRegex);
		if (!section?.[1]) {
			throw new Error(`failed to find section for opponent @${opp.handle}`);
		}
		const sectionText = section[1];

		// Split into on-the-play, on-the-draw, and overall subsections
		const playSection = extractSubsection(sectionText, "On the Play");
		const drawSection = extractSubsection(sectionText, "On the Draw");
		const overallSection = extractSubsection(sectionText, "Overall");

		results.push({
			opponentDid: opp.playerDid,
			onThePlay: extractVerdict(playSection, `@${opp.handle} on-the-play`),
			onTheDraw: extractVerdict(drawSection, `@${opp.handle} on-the-draw`),
			overall: extractVerdict(overallSection, `@${opp.handle} overall`),
			playNarrative: extractNarrative(playSection),
			drawNarrative: extractNarrative(drawSection),
		});
	}

	return results;
}

function extractSubsection(text: string, heading: string): string {
	const regex = new RegExp(`####\\s+${heading}([\\s\\S]*?)(?=####|$)`);
	const match = text.match(regex);
	if (!match?.[1]) {
		throw new Error(`missing '${heading}' subsection`);
	}
	return match[1];
}

function extractVerdict(text: string, context: string): Verdict {
	const matches = [...text.matchAll(/VERDICT:\s*(P0_WINS|P1_WINS|DRAW)\s*$/gm)];
	const last = matches.at(-1);
	if (!last?.[1]) {
		throw new Error(`failed to parse verdict for ${context}`);
	}
	switch (last[1]) {
		case "P0_WINS":
			return "player0_wins";
		case "P1_WINS":
			return "player1_wins";
		case "DRAW":
			return "draw";
		default:
			throw new Error(`unexpected verdict: ${last[1]}`);
	}
}

function extractNarrative(text: string): string {
	const match = text.match(/NARRATIVE:\s*(.+)/);
	return match?.[1]?.trim() ?? "";
}

/** Flip a verdict from one player's perspective to the other. */
export function flipVerdict(v: Verdict): Verdict {
	if (v === "player0_wins") return "player1_wins";
	if (v === "player1_wins") return "player0_wins";
	return "draw";
}

/**
 * Crosscheck verdicts from two agents.
 * Agent A evaluated "A vs B" (A=P0). Agent B evaluated "B vs A" (B=P0).
 * Agreement: agentA.overall === flipVerdict(agentB.overall)
 */
export function crosscheckVerdicts(
	agentADid: string,
	agentBDid: string,
	agentAVerdict: MatchupVerdict,
	agentBVerdict: MatchupVerdict,
	agentARawOutput: string,
	agentBRawOutput: string,
): CrosscheckResult {
	const flippedB = flipVerdict(agentBVerdict.overall);
	const agreed = agentAVerdict.overall === flippedB;

	if (agreed) {
		// Use winner's narrative, or A's for draws
		const isP0Win = agentAVerdict.overall === "player0_wins";
		const isP1Win = agentAVerdict.overall === "player1_wins";
		return {
			player0Did: agentADid,
			player1Did: agentBDid,
			agreed: true,
			outcome: agentAVerdict.overall,
			playNarrative: isP1Win
				? agentBVerdict.drawNarrative // B wins = B's perspective is more interesting
				: agentAVerdict.playNarrative,
			drawNarrative: isP1Win
				? agentBVerdict.playNarrative
				: agentAVerdict.drawNarrative,
			combinedReasoning: formatCombinedReasoning(
				agentADid,
				agentBDid,
				agentARawOutput,
				agentBRawOutput,
			),
		};
	}

	return {
		player0Did: agentADid,
		player1Did: agentBDid,
		agreed: false,
		agentAVerdict,
		agentBVerdict,
	};
}

function formatCombinedReasoning(
	aDid: string,
	bDid: string,
	aOutput: string,
	bOutput: string,
): string {
	return `=== Agent for ${aDid} ===\n${aOutput}\n\n=== Agent for ${bDid} ===\n${bOutput}`;
}

/**
 * Run full crosscheck across all pairs from a map of per-deck agent results.
 * Returns agreements and disagreements.
 */
export function crosscheckAllPairs(
	agentResults: ReadonlyMap<
		string,
		{ verdicts: MatchupVerdict[]; rawOutput: string }
	>,
): { agreements: CrosscheckResult[]; disagreements: CrosscheckResult[] } {
	const agreements: CrosscheckResult[] = [];
	const disagreements: CrosscheckResult[] = [];
	const dids = [...agentResults.keys()];

	for (let i = 0; i < dids.length; i++) {
		for (let j = i + 1; j < dids.length; j++) {
			const aDid = dids[i] as string;
			const bDid = dids[j] as string;
			const aData = agentResults.get(aDid);
			const bData = agentResults.get(bDid);
			if (!aData || !bData) continue;

			// A's verdict about B
			const aVsB = aData.verdicts.find((v) => v.opponentDid === bDid);
			// B's verdict about A
			const bVsA = bData.verdicts.find((v) => v.opponentDid === aDid);
			if (!aVsB || !bVsA) continue;

			const result = crosscheckVerdicts(
				aDid,
				bDid,
				aVsB,
				bVsA,
				aData.rawOutput,
				bData.rawOutput,
			);

			if (result.agreed) {
				agreements.push(result);
			} else {
				disagreements.push(result);
			}
		}
	}

	return { agreements, disagreements };
}

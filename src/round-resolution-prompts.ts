// pattern: Functional Core

// Prompt construction, verdict parsing, crosscheck logic for per-deck agent evaluation.
// Each agent evaluates all matchups from one deck's perspective (as Player 0).
// Crosscheck compares verdicts from both sides to flag disagreements.

import type { Card } from "./card-types.js";

export const THREE_CB_RULES = `## 3CB Rules
- Each player has a 3-card hand and no library. Drawing from an empty library does NOT cause a loss.
- Normal Magic rules apply otherwise. Starting life: 20.
- All of Magic is legal except un-sets, ante, subgames, and wishes/sideboard cards.
- Both players play optimally to maximize their tournament result (3 pts for win, 1 for draw, 0 for loss).
- Coin flips and dice rolls resolve to the worst outcome for the controller.
- If one player wins regardless of who goes first, that player wins the matchup (WW or LL).
- If the result depends on who goes first (each player wins on the play), it's a split (WL) — not a draw.
- If neither player can force a win in either direction, it's a draw (DD).
- Evaluate EACH DIRECTION independently: on the play and on the draw. Report per-direction verdicts.`;

export interface DeckInfo {
	playerDid: string;
	handle: string;
	cards: Card[];
	/** 2-3 sentence game plan from the deck plans step (Step 2c) */
	deckPlan?: string;
}

export type Verdict = "player0_wins" | "player1_wins" | "draw";

export interface MatchupVerdict {
	opponentDid: string;
	onThePlay: Verdict;
	onTheDraw: Verdict;
	/** @deprecated Derived from onThePlay + onTheDraw. Kept for back-compat with R7 crosscheck. */
	overall: Verdict;
	playNarrative: string;
	drawNarrative: string;
}

/** Derive the overall outcome from per-direction verdicts. */
export function deriveOverall(onPlay: Verdict, onDraw: Verdict): Verdict {
	if (onPlay === "player0_wins" && onDraw === "player0_wins")
		return "player0_wins";
	if (onPlay === "player1_wins" && onDraw === "player1_wins")
		return "player1_wins";
	if (onPlay === "draw" && onDraw === "draw") return "draw";
	// Mixed results (WL, WD, DL) — not a draw, not a clean win. Return the better side for p0.
	// WL/LW = split. WD/DW = p0 advantage. DL/LD = p1 advantage.
	if (onPlay === onDraw) return onPlay; // shouldn't reach here but safety
	// For WL splits and mixed: the combined code is the canonical representation.
	// We return "draw" as a fallback label but callers should use per-direction verdicts.
	return "draw";
}

export interface CrosscheckResult {
	player0Did: string;
	player1Did: string;
	agreed: boolean;
	outcome?: Verdict;
	playNarrative?: string;
	drawNarrative?: string;
	combinedReasoning?: string;
	agentAVerdict?: MatchupVerdict;
	agentBVerdict?: MatchupVerdict;
}

function formatCardForPrompt(card: Card): string {
	const mana = card.manaCost ? ` ${card.manaCost}` : "";
	const pt =
		card.power !== undefined ? ` — ${card.power}/${card.toughness}` : "";
	return `**${card.name}**${mana}\n${card.types.join(" ")}${pt}\n${card.oracleText || "(no text)"}`;
}

function formatDeckBlock(
	label: string,
	cards: readonly Card[],
	deckPlan?: string,
): string {
	const block = `## ${label}\n${cards.map(formatCardForPrompt).join("\n\n")}`;
	if (deckPlan) {
		return `${block}\n\n**Deck plan:** ${deckPlan}`;
	}
	return block;
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
		formatDeckBlock(
			`Your Deck (@${myDeck.handle})`,
			myDeck.cards,
			myDeck.deckPlan,
		),
		"",
		"---",
		"",
	];

	for (const opp of opponents) {
		sections.push(
			formatDeckBlock(`Opponent: @${opp.handle}`, opp.cards, opp.deckPlan),
			"",
		);
	}

	sections.push(`## Instructions
For each opponent, evaluate the matchup in both directions: you go first (on the play) and opponent goes first (on the draw).

**For each direction, follow this evaluation order:**

**Step 1 — Win analysis.** Does the active player (the one on the play) have a line that wins regardless of what the opponent does? Consider mana sequencing, interaction timing, and combat math. If yes → that player wins this direction. Move to verdict.

**Step 2 — Opponent win analysis.** If the active player can't force a win: does the opponent have a line that wins regardless? Consider that the active player is now playing *defensively* — they may make completely different plays than in Step 1 (different targets for discard, holding cards instead of casting them, using removal defensively rather than aggressively). If the opponent wins even against best defense → the active player loses this direction. Move to verdict.

**Step 3 — Draw analysis.** If neither side can force a win: both players play to avoid losing. Can either side break the stalemate? Common draw patterns:
- **Commit-first-loses:** Player A holds a threat; Player B holds an answer. If A commits, B answers and wins. If B uses the answer preemptively, A's threat resolves. Neither player acts → DRAW. Example: Oko vs Force of Will — if Oko is cast, Force counters it; if Force is used on something else, Oko resolves. Optimal play for both is to hold forever.
- A threat is neutralized and neither side has a second angle of attack
- A small creature pressures but the opponent can chump/block indefinitely
- A taxing effect (e.g. Mana Tithe, Daze) counters the only threat and neither side has another line
If neither side can force a win through best defense → DRAW.

IMPORTANT: Step 2 and Step 3 are *fresh analyses*, not continuations of Step 1. When a player shifts from "trying to win" to "trying not to lose," their optimal plays often change entirely. Re-evaluate from scratch.

Do NOT produce an "overall" verdict. The combined outcome is derived mechanically from the two per-direction verdicts (e.g. W+L = WL split, W+W = WW, D+D = DD). A WL split is NOT a draw — it scores 3 total points (W=3, L=0), while DD scores 2 (D=1, D=1).

Narratives: 1-2 sentences per direction describing the key plays, written for Magic players. Keep each under 200 characters.

## Output Format (follow exactly)
`);

	for (const opp of opponents) {
		sections.push(`### vs @${opp.handle}

#### On the Play
**Win analysis:** [Can you force a win? What's the line? Can the opponent stop it?]
**If no win — Loss check:** [Does the opponent win even against your best defense? Consider defensive plays you didn't explore in the win analysis.]
**If no win either way — Draw check:** [Can either side break the stalemate? Or do both players stare?]
VERDICT: P0_WINS | P1_WINS | DRAW
NARRATIVE: [1-2 sentences, under 200 chars]

#### On the Draw
**Win analysis:** [Can the opponent (on the play) force a win?]
**If no win — Loss check:** [Can you win against their best defense?]
**If no win either way — Draw check:** [Stalemate?]
VERDICT: P0_WINS | P1_WINS | DRAW
NARRATIVE: [1-2 sentences, under 200 chars]
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
		const handlePattern = opp.handle.replace(/\./g, "\\.");
		const sectionRegex = new RegExp(
			`### vs @${handlePattern}([\\s\\S]*?)(?=### vs @|$)`,
		);
		const section = agentOutput.match(sectionRegex);
		if (!section?.[1]) {
			throw new Error(`failed to find section for opponent @${opp.handle}`);
		}
		const sectionText = section[1];

		const playSection = extractSubsection(sectionText, "On the Play");
		const drawSection = extractSubsection(sectionText, "On the Draw");

		const onThePlay = extractVerdict(playSection, `@${opp.handle} on-the-play`);
		const onTheDraw = extractVerdict(drawSection, `@${opp.handle} on-the-draw`);

		// Overall section is optional (removed in R8+ prompts). Derive if missing.
		let overall: Verdict;
		try {
			const overallSection = extractSubsection(sectionText, "Overall");
			overall = extractVerdict(overallSection, `@${opp.handle} overall`);
		} catch {
			overall = deriveOverall(onThePlay, onTheDraw);
		}

		results.push({
			opponentDid: opp.playerDid,
			onThePlay,
			onTheDraw,
			overall,
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

/** Canonical deck key: sorted lowercase card names. Order-independent. */
export function canonicalDeckKey(cards: readonly Card[]): string {
	return cards
		.map((c) => c.name.toLowerCase())
		.sort()
		.join("|");
}

/** Build a narrative-only prompt for a matchup with a known verdict. */
export function buildNarrativeOnlyPrompt(
	deck0: DeckInfo,
	deck1: DeckInfo,
	knownOutcome: Verdict,
): string {
	const outcomeLabel =
		knownOutcome === "player0_wins"
			? `@${deck0.handle} wins`
			: knownOutcome === "player1_wins"
				? `@${deck1.handle} wins`
				: "draw";

	return `You are writing play-by-play narratives for a Three Card Blind (3CB) matchup.

${THREE_CB_RULES}

${formatDeckBlock(`Deck A (@${deck0.handle})`, deck0.cards, deck0.deckPlan)}

${formatDeckBlock(`Deck B (@${deck1.handle})`, deck1.cards, deck1.deckPlan)}

## Known Result
The outcome of this matchup has already been determined: **${outcomeLabel}**.

## Instructions
Write brief narratives describing how each direction plays out. Do NOT re-evaluate the verdict — it's already decided.

## Output Format (follow exactly)

#### On the Play (A goes first)
NARRATIVE: [1-2 sentences, under 200 chars]

#### On the Draw (B goes first)
NARRATIVE: [1-2 sentences, under 200 chars]
`;
}

/** Parse narratives from a narrative-only prompt response. */
export function parseNarrativeOnlyOutput(output: string): {
	playNarrative: string;
	drawNarrative: string;
} {
	const playSection = output.match(
		/####\s+On the Play[\s\S]*?NARRATIVE:\s*(.+)/,
	);
	const drawSection = output.match(
		/####\s+On the Draw[\s\S]*?NARRATIVE:\s*(.+)/,
	);
	return {
		playNarrative: playSection?.[1]?.trim() ?? "",
		drawNarrative: drawSection?.[1]?.trim() ?? "",
	};
}

/** Flip a verdict from one player's perspective to the other. */
export function flipVerdict(v: Verdict): Verdict {
	if (v === "player0_wins") return "player1_wins";
	if (v === "player1_wins") return "player0_wins";
	return "draw";
}

/** Crosscheck verdicts from two agents.
 *  Agent A evaluated "A vs B" (A=P0). Agent B evaluated "B vs A" (B=P0).
 *  Agreement: per-direction verdicts match when flipped.
 *  A's onThePlay (A goes first) should match flipped(B's onTheDraw) (B goes second = A goes first).
 *  A's onTheDraw (B goes first) should match flipped(B's onThePlay) (B goes first). */
export function crosscheckVerdicts(
	agentADid: string,
	agentBDid: string,
	agentAVerdict: MatchupVerdict,
	agentBVerdict: MatchupVerdict,
	agentARawOutput: string,
	agentBRawOutput: string,
): CrosscheckResult {
	// Compare per-direction only. Ignore overall — it's derived.
	const playAgree =
		agentAVerdict.onThePlay === flipVerdict(agentBVerdict.onTheDraw);
	const drawAgree =
		agentAVerdict.onTheDraw === flipVerdict(agentBVerdict.onThePlay);
	const agreed = playAgree && drawAgree;

	if (agreed) {
		const outcome = deriveOverall(
			agentAVerdict.onThePlay,
			agentAVerdict.onTheDraw,
		);
		const isP1Win = agentAVerdict.onThePlay === "player1_wins";
		return {
			player0Did: agentADid,
			player1Did: agentBDid,
			agreed: true,
			outcome,
			agentAVerdict,
			playNarrative: isP1Win
				? agentBVerdict.drawNarrative
				: agentAVerdict.playNarrative,
			drawNarrative: isP1Win
				? agentBVerdict.playNarrative
				: agentAVerdict.drawNarrative,
			combinedReasoning: `=== Agent for ${agentADid} ===\n${agentARawOutput}\n\n=== Agent for ${agentBDid} ===\n${agentBRawOutput}`,
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

/** Run full crosscheck across all pairs from a map of per-deck agent results. */
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

			const aVsB = aData.verdicts.find((v) => v.opponentDid === bDid);
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

// --- Deck Plans (Step 2c) ---

/** Build the prompt for generating deck plans for all unique decks in a round. */
export function buildDeckPlansPrompt(decks: readonly DeckInfo[]): string {
	const sections: string[] = [
		`You are analyzing decks for a Three Card Blind (3CB) tournament.

${THREE_CB_RULES}

For each deck below, write a 2-3 sentence game plan explaining:
- What the deck is trying to do and how it wins
- Key card interactions and mana sequencing (which turn things happen)
- What beats it (vulnerabilities)

Note that all decks in the tournament are listed — you can reference cross-deck interactions (e.g., "3 opponents have Wasteland, which shuts down this deck's land-based combo").

## Output Format
For each deck, write:

### @{handle}
{2-3 sentence game plan}

---
`,
	];

	for (const deck of decks) {
		sections.push(formatDeckBlock(`@${deck.handle}`, deck.cards), "");
	}

	return sections.join("\n");
}

/** Parse deck plans from the LLM response. Returns a map of handle → plan text. */
export function parseDeckPlans(
	output: string,
	decks: readonly DeckInfo[],
): Map<string, string> {
	const plans = new Map<string, string>();

	for (const deck of decks) {
		const handlePattern = deck.handle.replace(/\./g, "\\.");
		const regex = new RegExp(
			`###\\s+@${handlePattern}\\s*\\n([\\s\\S]*?)(?=###\\s+@|$)`,
		);
		const match = output.match(regex);
		if (match?.[1]) {
			plans.set(deck.handle, match[1].trim());
		}
	}

	return plans;
}

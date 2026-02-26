// pattern: Imperative Shell

// Evaluates 3CB matchups by sending deck oracle text + rules to Claude API.
// Returns a structured verdict (win/loss/draw) with reasoning.

import type { Card } from "@3cblue/shared";
import Anthropic from "@anthropic-ai/sdk";

export interface LlmMatchupVerdict {
	outcome: "player0_wins" | "player1_wins" | "draw";
	reasoning: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
}

const SYSTEM_PROMPT = `You are judging a Three Card Blind (3CB) Magic: The Gathering matchup.

## 3CB Rules
- Each player has a 3-card hand and no library. Drawing from an empty library does NOT cause a loss.
- Normal Magic rules apply otherwise. Starting life: 20.
- All of Magic is legal except un-sets, ante, subgames, and wishes/sideboard cards.
- Both players play optimally to maximize their tournament result (3 pts for win, 1 for draw, 0 for loss).
- Coin flips and dice rolls resolve to the worst outcome for the controller.

## Your Task
Determine the overall matchup result assuming optimal play from both sides.
Consider both "Player 0 goes first" and "Player 1 goes first" scenarios.
If one player wins regardless of who goes first, that player wins the matchup.
If the result depends on who goes first (each player wins their on-the-play game), it's a draw.
If neither player can force a win in either direction, it's a draw.

Think step by step about mana sequencing, interaction, and combat math.
On the FINAL line of your response write exactly one of:
VERDICT: P0_WINS
VERDICT: P1_WINS
VERDICT: DRAW`;

function formatCardForPrompt(card: Card): string {
	const mana = card.manaCost ? ` ${card.manaCost}` : "";
	const pt =
		card.power !== undefined ? ` — ${card.power}/${card.toughness}` : "";
	return `**${card.name}**${mana}\n${card.types.join(" ")}${pt}\n${card.oracleText || "(no text)"}`;
}

export function formatDeckForPrompt(
	label: string,
	cards: readonly Card[],
): string {
	return `## ${label}\n${cards.map(formatCardForPrompt).join("\n\n")}`;
}

export function parseVerdict(text: string): LlmMatchupVerdict["outcome"] {
	const matches = [...text.matchAll(/VERDICT:\s*(P0_WINS|P1_WINS|DRAW)\s*$/gm)];
	const last = matches.at(-1);
	if (!last?.[1]) {
		throw new Error(
			`failed to parse LLM verdict from response: ...${text.slice(-200)}`,
		);
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

export async function evaluateMatchup(
	deck0: readonly Card[],
	deck1: readonly Card[],
	options?: { model?: string },
): Promise<LlmMatchupVerdict> {
	const model =
		options?.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
	const client = new Anthropic();

	const userMessage = [
		formatDeckForPrompt("Player 0's deck", deck0),
		"",
		formatDeckForPrompt("Player 1's deck", deck1),
	].join("\n");

	const response = await client.messages.create({
		model,
		max_tokens: 4096,
		system: SYSTEM_PROMPT,
		messages: [{ role: "user", content: userMessage }],
	});

	const text = response.content
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("\n");

	return {
		outcome: parseVerdict(text),
		reasoning: text,
		model,
		inputTokens: response.usage.input_tokens,
		outputTokens: response.usage.output_tokens,
	};
}

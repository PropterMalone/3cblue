// pattern: Imperative Shell

// Spike: can an LLM evaluate 3CB matchups?
// Sends matchup prompts to Ollama with game rules + oracle text.
// Compares against known historical outcomes.
//
// Prerequisites:
//   - Ollama running with a model pulled (default: qwen2.5:14b)
//   - OLLAMA_URL env var (default: http://localhost:11434)
//   - OLLAMA_MODEL env var (default: qwen2.5:14b)
//
// Usage: npx tsx packages/engine/src/evaluate-llm.ts

import type { ScryfallCard } from "@3cblue/shared";
import { lookupCard } from "./scryfall-client.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:14b";

// Known matchups with historical outcomes.
// Sources: soniccenter.org 3CB archives, manually verified.
interface KnownMatchup {
	round: string;
	deckA: { player: string; cards: string[] };
	deckB: { player: string; cards: string[] };
	// From deckA's perspective
	expectedOutcome: "win" | "loss" | "draw";
	reasoning: string;
}

const KNOWN_MATCHUPS: KnownMatchup[] = [
	{
		round: "GameFAQs R5",
		deckA: {
			player: "Seeker",
			cards: ["Treetop Village", "Treetop Village", "Treetop Village"],
		},
		deckB: {
			player: "ShamblingShell",
			cards: ["City of Traitors", "Isochron Scepter", "Lightning Bolt"],
		},
		expectedOutcome: "loss",
		reasoning:
			"Isochron Scepter imprinting Lightning Bolt kills each Treetop Village as it animates. " +
			"Seeker can never profitably attack.",
	},
	{
		round: "GameFAQs R5",
		deckA: {
			player: "PsoRaven",
			cards: ["Island", "Stifle", "Phyrexian Dreadnought"],
		},
		deckB: {
			player: "Seeker",
			cards: ["Treetop Village", "Treetop Village", "Treetop Village"],
		},
		expectedOutcome: "win",
		reasoning:
			"Stifle counters Dreadnought's ETB sacrifice trigger, yielding a 12/12 on turn 2. " +
			"Treetop Villages are 3/3s — can't race or block profitably.",
	},
	{
		round: "GameFAQs R15 — Poison",
		deckA: {
			player: "dan81",
			cards: ["Unmask", "Pendelhaven", "Virulent Sliver"],
		},
		deckB: {
			player: "Cheerful Chum",
			cards: ["Forest", "Virulent Sliver", "Virulent Sliver"],
		},
		expectedOutcome: "win",
		reasoning:
			"Unmask (pitching nothing relevant or itself) strips one Virulent Sliver from Cheerful Chum's hand. " +
			"Then Pendelhaven pumps dan81's lone Sliver to win the poisonous race.",
	},
	{
		round: "GameFAQs R33",
		deckA: {
			player: "xsuppleotaku",
			cards: ["Orzhov Basilica", "Mutavault", "Vindicate"],
		},
		deckB: { player: "PsoRaven", cards: ["Swamp", "Encroach", "Mutavault"] },
		expectedOutcome: "win",
		reasoning:
			"Vindicate destroys PsoRaven's key permanent (Mutavault or Swamp). " +
			"Orzhov Basilica provides mana despite Encroach hitting it. " +
			"xsuppleotaku's Mutavault eventually wins the damage race.",
	},
	{
		round: "GameFAQs R11",
		deckA: {
			player: "TheSoleSurvivor",
			cards: ["Bottomless Vault", "Smallpox", "Nether Spirit"],
		},
		deckB: { player: "Stormleaf", cards: ["Daze", "Island", "Straw Golem"] },
		expectedOutcome: "win",
		reasoning:
			"Smallpox wrecks Stormleaf's hand and board. Nether Spirit recurs from graveyard. " +
			"Straw Golem's echo is hard to maintain after Smallpox strips resources.",
	},
];

const SYSTEM_PROMPT = `You are an expert Magic: The Gathering judge evaluating Three Card Blind (3CB) matchups.

## 3CB Rules
- Each player has a 3-card hand. There is no library (drawing from an empty library does NOT cause a loss).
- Normal Magic rules apply with these exceptions:
  - Starting life: 20
  - No sideboard, no wishes
  - Coin flips and dice rolls resolve to the WORST outcome for the controller
- Both players play optimally to maximize their tournament result.
- Scoring: Win = 3 pts, Draw = 1 pt, Loss = 0 pts
- Games that reach a stalemate (neither player can force a win) are draws.

## Your Task
Given two 3-card decks with full oracle text, determine the outcome of optimal play.
Consider: mana availability, tempo, interaction, combat math, and whether either player can force a win.

Think step by step:
1. What does each deck's ideal line of play look like?
2. How do the decks interact? Can either player disrupt the other?
3. What is the combat math? Can either player force lethal?
4. Is there a stalemate condition?

Then give your verdict.

IMPORTANT: Respond in this exact format at the end of your analysis:
VERDICT: [A_WINS | B_WINS | DRAW]`;

interface OracleInfo {
	name: string;
	manaCost: string;
	typeLine: string;
	oracleText: string;
	pt?: string;
}

async function getOracleInfo(cardName: string): Promise<OracleInfo | null> {
	const result = await lookupCard(cardName);
	if (!result.ok) {
		console.error(`  failed to look up "${cardName}": ${result.error}`);
		return null;
	}
	const card = result.card as ScryfallCard;
	return {
		name: card.name,
		manaCost: card.mana_cost ?? "",
		typeLine: card.type_line,
		oracleText: card.oracle_text ?? "(no text)",
		pt: card.power != null ? `${card.power}/${card.toughness}` : undefined,
	};
}

function formatDeckForPrompt(label: string, cards: OracleInfo[]): string {
	const lines = [`## Deck ${label}`];
	for (const c of cards) {
		lines.push(`**${c.name}** ${c.manaCost}`);
		lines.push(`${c.typeLine}${c.pt ? ` — ${c.pt}` : ""}`);
		lines.push(c.oracleText);
		lines.push("");
	}
	return lines.join("\n");
}

interface OllamaResponse {
	model: string;
	message: { role: string; content: string };
	total_duration?: number;
	eval_count?: number;
}

async function callOllama(
	prompt: string,
): Promise<{ content: string; durationMs: number }> {
	const start = Date.now();
	const response = await fetch(`${OLLAMA_URL}/api/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: OLLAMA_MODEL,
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: prompt },
			],
			stream: false,
			options: {
				temperature: 0.2,
				num_predict: 2048,
			},
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`ollama API error ${response.status}: ${text}`);
	}

	const data = (await response.json()) as OllamaResponse;
	return {
		content: data.message.content,
		durationMs: Date.now() - start,
	};
}

function parseVerdict(content: string): "win" | "loss" | "draw" | "unknown" {
	// Find the last VERDICT line (LLM might restate it)
	const matches = content.match(
		/\*{0,2}VERDICT\*{0,2}:\s*\[?\s*\*{0,2}(A_WINS|B_WINS|DRAW)\*{0,2}\s*\]?/gi,
	);
	if (!matches) return "unknown";
	const last = matches[matches.length - 1]!;
	const verdict = last
		.replace(/\*{0,2}VERDICT\*{0,2}:\s*\[?\s*\*{0,2}/i, "")
		.replace(/\*{0,2}\s*\]?\s*$/, "")
		.toUpperCase();
	if (verdict === "A_WINS") return "win";
	if (verdict === "B_WINS") return "loss";
	if (verdict === "DRAW") return "draw";
	return "unknown";
}

interface MatchupResult {
	matchup: KnownMatchup;
	verdict: "win" | "loss" | "draw" | "unknown";
	correct: boolean;
	durationMs: number;
}

async function evaluateMatchup(
	matchup: KnownMatchup,
	index: number,
): Promise<MatchupResult> {
	console.log(`\n${"─".repeat(60)}`);
	console.log(
		`Matchup ${index + 1}: ${matchup.deckA.player} vs ${matchup.deckB.player} (${matchup.round})`,
	);
	console.log(
		`Expected: ${matchup.expectedOutcome} (from ${matchup.deckA.player}'s perspective)`,
	);
	console.log(`Known reasoning: ${matchup.reasoning}`);
	console.log("─".repeat(60));

	// Look up oracle text for all cards
	const cardsA: OracleInfo[] = [];
	const cardsB: OracleInfo[] = [];

	for (const name of matchup.deckA.cards) {
		const info = await getOracleInfo(name);
		if (!info)
			return {
				matchup,
				verdict: "unknown" as const,
				correct: false,
				durationMs: 0,
			};
		cardsA.push(info);
	}
	for (const name of matchup.deckB.cards) {
		const info = await getOracleInfo(name);
		if (!info)
			return {
				matchup,
				verdict: "unknown" as const,
				correct: false,
				durationMs: 0,
			};
		cardsB.push(info);
	}

	const prompt = [
		"Evaluate this 3CB matchup. Determine the outcome assuming optimal play from both sides.",
		"",
		formatDeckForPrompt("A", cardsA),
		formatDeckForPrompt("B", cardsB),
		"",
		"Analyze the matchup step by step, then give your VERDICT.",
	].join("\n");

	console.log("\nSending to LLM...");

	const { content, durationMs } = await callOllama(prompt);
	const verdict = parseVerdict(content);
	const correct = verdict === matchup.expectedOutcome;

	console.log(`\n--- LLM Response (${(durationMs / 1000).toFixed(1)}s) ---`);
	console.log(content);
	console.log("--- End Response ---\n");
	console.log(`LLM verdict: ${verdict}`);
	console.log(`Expected:    ${matchup.expectedOutcome}`);
	console.log(
		`Result:      ${correct ? "CORRECT ✓" : verdict === "unknown" ? "PARSE FAILED ✗" : "WRONG ✗"}`,
	);

	return { matchup, verdict, correct, durationMs };
}

async function main(): Promise<void> {
	console.log("3CB LLM Evaluation Spike");
	console.log(`Ollama URL: ${OLLAMA_URL}`);
	console.log(`Model: ${OLLAMA_MODEL}`);
	console.log(`Matchups: ${KNOWN_MATCHUPS.length}`);

	// Quick connectivity check
	try {
		const resp = await fetch(`${OLLAMA_URL}/api/tags`);
		if (!resp.ok) throw new Error(`status ${resp.status}`);
		const data = (await resp.json()) as { models: { name: string }[] };
		console.log(
			`Available models: ${data.models.map((m) => m.name).join(", ") || "(none)"}`,
		);
	} catch (err) {
		console.error(`\nCannot reach Ollama at ${OLLAMA_URL}`);
		console.error("Make sure Ollama is running and accessible.");
		console.error(
			"Hint: OLLAMA_URL=http://host:port npx tsx packages/engine/src/evaluate-llm.ts",
		);
		process.exit(1);
	}

	const results: MatchupResult[] = [];

	for (let i = 0; i < KNOWN_MATCHUPS.length; i++) {
		results.push(await evaluateMatchup(KNOWN_MATCHUPS[i]!, i));
	}

	const correct = results.filter((r) => r.correct).length;
	const wrong = results.filter(
		(r) => !r.correct && r.verdict !== "unknown",
	).length;
	const unknown = results.filter((r) => r.verdict === "unknown").length;
	const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

	console.log(`\n${"=".repeat(60)}`);
	console.log("SUMMARY");
	console.log("=".repeat(60));
	console.log(`Correct: ${correct}/${results.length}`);
	console.log(`Wrong:   ${wrong}/${results.length}`);
	console.log(`Unknown: ${unknown}/${results.length}`);
	console.log(
		`Total time: ${(totalMs / 1000).toFixed(1)}s (avg ${(totalMs / results.length / 1000).toFixed(1)}s per matchup)`,
	);
	console.log(`Model: ${OLLAMA_MODEL}`);
	console.log("=".repeat(60));
}

main().catch((err) => {
	console.error("fatal:", err);
	process.exit(1);
});

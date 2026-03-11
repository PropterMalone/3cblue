// pattern: Imperative Shell

// Evaluation script: runs real 3CB decks from historical games through
// the engine to assess coverage. Reports which matchups resolve vs
// which get flagged as unresolved.
//
// Usage: npx tsx packages/engine/src/evaluate-historical.ts

import { type Card, scryfallToCard, simulateMatchup } from "@3cblue/shared";
import { lookupCard } from "./scryfall-client.js";

interface Deck {
	player: string;
	cards: string[];
}

interface Round {
	name: string;
	source: string;
	decks: Deck[];
}

// Historical rounds from GameFAQs 3CB archive (soniccenter.org)
// Curated for variety: simple creatures, keyword combat, combos, locks
const HISTORICAL_ROUNDS: Round[] = [
	{
		name: "GameFAQs R5 (subset)",
		source: "soniccenter.org/sm/mtg/3cb/3cb_5.html",
		decks: [
			{
				player: "PsoRaven",
				cards: ["Island", "Stifle", "Phyrexian Dreadnought"],
			},
			{
				player: "ShamblingShell",
				cards: ["City of Traitors", "Isochron Scepter", "Lightning Bolt"],
			},
			{
				player: "Asendria",
				cards: ["Stone Rain", "Gruul Turf", "Burning-Tree Shaman"],
			},
			{
				player: "Seeker",
				cards: ["Treetop Village", "Treetop Village", "Treetop Village"],
			},
		],
	},
	{
		name: "GameFAQs R11 (subset)",
		source: "soniccenter.org/sm/mtg/3cb/3cb_11.html",
		decks: [
			{
				player: "TheSoleSurvivor",
				cards: ["Bottomless Vault", "Smallpox", "Nether Spirit"],
			},
			{
				player: "Cheater Hater",
				cards: [
					"Fountain of Cho",
					"Oblivion Ring",
					"Knight of the Holy Nimbus",
				],
			},
			{
				player: "CrossGamer",
				cards: ["Mountain", "Shield Sphere", "Greater Gargadon"],
			},
			{ player: "Stormleaf", cards: ["Daze", "Island", "Straw Golem"] },
		],
	},
	{
		name: "GameFAQs R15 — Poison meta (subset)",
		source: "soniccenter.org/sm/mtg/3cb/3cb_15.html",
		decks: [
			{ player: "dan81", cards: ["Unmask", "Pendelhaven", "Virulent Sliver"] },
			{
				player: "Cheerful Chum",
				cards: ["Forest", "Virulent Sliver", "Virulent Sliver"],
			},
			{
				player: "PsyMar",
				cards: ["Ancient Tomb", "City of Traitors", "Eater of Days"],
			},
		],
	},
	{
		name: "GameFAQs R33 (subset)",
		source: "soniccenter.org/sm/mtg/3cb/3cb_33.html",
		decks: [
			{
				player: "xsuppleotaku",
				cards: ["Orzhov Basilica", "Mutavault", "Vindicate"],
			},
			{
				player: "Chrono007",
				cards: ["Swamp", "Cry of Contrition", "Mutavault"],
			},
			{ player: "PsoRaven", cards: ["Swamp", "Encroach", "Mutavault"] },
		],
	},
	{
		name: "Simple creatures (constructed)",
		source: "manual — testing basic combat resolution",
		decks: [
			{
				player: "Aggro",
				cards: ["Goblin Guide", "Monastery Swiftspear", "Zurgo Bellstriker"],
			},
			{
				player: "Midrange",
				cards: ["Tarmogoyf", "Scavenging Ooze", "Tireless Tracker"],
			},
			{
				player: "Flyers",
				cards: ["Delver of Secrets", "Vendilion Clique", "Spell Queller"],
			},
			{
				player: "Keywords",
				cards: ["Baneslayer Angel", "Questing Beast", "Thrun, the Last Troll"],
			},
		],
	},
	{
		name: "ETB creatures",
		source: "manual — testing ETB abilities",
		decks: [
			{
				player: "Burns",
				cards: ["Siege Rhino", "Flametongue Kavu", "Thragtusk"],
			},
			{
				player: "Tokens",
				cards: ["Cloudgoat Ranger", "Grave Titan", "Avenger of Zendikar"],
			},
			{
				player: "Vanilla",
				cards: ["Kalonian Tusker", "Leatherback Baloth", "Woolly Thoctar"],
			},
		],
	},
];

async function lookupDeck(
	deck: Deck,
): Promise<{ cards: Card[]; errors: string[] }> {
	const cards: Card[] = [];
	const errors: string[] = [];

	for (const name of deck.cards) {
		const result = await lookupCard(name);
		if (result.ok) {
			cards.push(scryfallToCard(result.card));
		} else {
			errors.push(`${name}: ${result.error}`);
		}
	}

	return { cards, errors };
}

function describeAbilities(card: Card): string {
	if (card.abilities.length === 0) return "(no abilities)";
	return card.abilities
		.map((a) => {
			if (a.kind === "keyword") return a.keyword;
			if (a.kind === "unresolved") return `UNRESOLVED: ${a.reason}`;
			return a.kind;
		})
		.join(", ");
}

async function evaluateRound(round: Round): Promise<void> {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`${round.name}`);
	console.log(`Source: ${round.source}`);
	console.log("=".repeat(60));

	// Look up all decks
	const resolvedDecks: { player: string; cards: Card[] }[] = [];
	for (const deck of round.decks) {
		const { cards, errors } = await lookupDeck(deck);
		if (errors.length > 0) {
			console.log(`\n  ⚠ ${deck.player}: lookup errors:`);
			for (const e of errors) console.log(`    - ${e}`);
		}
		if (cards.length === 3) {
			resolvedDecks.push({ player: deck.player, cards });
		} else {
			console.log(
				`  ✗ ${deck.player}: skipping (${cards.length}/3 cards found)`,
			);
		}
	}

	// Show parsed cards
	console.log("\n  Parsed cards:");
	for (const deck of resolvedDecks) {
		console.log(`  ${deck.player}:`);
		for (const card of deck.cards) {
			const type = card.types.join("/");
			const pt =
				card.power !== undefined ? ` ${card.power}/${card.toughness}` : "";
			const abilities = describeAbilities(card);
			console.log(`    ${card.name} [${type}${pt}] — ${abilities}`);
		}
	}

	// Run all pairwise matchups
	let resolved = 0;
	let unresolved = 0;
	const lookupFailed = 0;

	console.log("\n  Matchups:");
	for (let i = 0; i < resolvedDecks.length; i++) {
		for (let j = i + 1; j < resolvedDecks.length; j++) {
			const d0 = resolvedDecks[i]!;
			const d1 = resolvedDecks[j]!;

			const g1 = simulateMatchup(d0.cards, d1.cards);
			const g2 = simulateMatchup(d1.cards, d0.cards);

			const formatResult = (r: typeof g1) => {
				if (r.result.outcome === "unresolved") return `? (${r.result.reason})`;
				if (r.result.outcome === "player0_wins") return "P0 wins";
				if (r.result.outcome === "player1_wins") return "P1 wins";
				return r.result.outcome;
			};

			const r1 = formatResult(g1);
			const r2 = formatResult(g2);

			const g1resolved = g1.result.outcome !== "unresolved";
			const g2resolved = g2.result.outcome !== "unresolved";

			if (g1resolved) resolved++;
			else unresolved++;
			if (g2resolved) resolved++;
			else unresolved++;

			const marker = g1resolved && g2resolved ? "✓" : "?";
			console.log(`    ${marker} ${d0.player} vs ${d1.player}`);
			console.log(`      G1 (${d0.player} first): ${r1}`);
			console.log(`      G2 (${d1.player} first): ${r2}`);
		}
	}

	console.log(`\n  Summary: ${resolved} resolved, ${unresolved} unresolved`);
}

async function main(): Promise<void> {
	console.log("3CB Historical Evaluation");
	console.log("Assessing engine coverage against real 3CB decks\n");

	const totalResolved = 0;
	const totalUnresolved = 0;

	for (const round of HISTORICAL_ROUNDS) {
		await evaluateRound(round);
	}

	console.log(`\n${"=".repeat(60)}`);
	console.log("DONE");
	console.log("=".repeat(60));
}

main().catch((err) => {
	console.error("fatal:", err);
	process.exit(1);
});

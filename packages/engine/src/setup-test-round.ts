// One-off script to create a test round with real 3CB decks
import {
	createDatabase,
	getActiveRound,
	upsertPlayer,
	upsertSubmission,
} from "./database.js";
import { lookupCard } from "./scryfall-client.js";

const DB_PATH = process.env.DB_PATH || "./test-round.db";

// Real 3CB decks from MTG Salvation tournament rounds
const decks = [
	{
		did: "did:plc:alice",
		handle: "alice.bsky.social",
		cards: ["Mishra's Factory", "Sheltered Valley", "Powder Keg"],
	},
	{
		did: "did:plc:bob",
		handle: "bob.bsky.social",
		cards: ["Black Lotus", "Glowrider", "Magus of the Moon"],
	},
	{
		did: "did:plc:charlie",
		handle: "charlie.bsky.social",
		cards: ["City of Traitors", "Isochron Scepter", "Lightning Helix"],
	},
	{
		did: "did:plc:dana",
		handle: "dana.bsky.social",
		cards: ["Force of Will", "Force of Will", "Dryad Arbor"],
	},
];

async function main() {
	const db = createDatabase(DB_PATH);

	// Create a round with deadline in the past (ready to resolve)
	const deadline = new Date(Date.now() - 60_000).toISOString();
	const row = db
		.prepare(
			"INSERT INTO rounds (phase, submission_deadline) VALUES ('submission', ?) RETURNING *",
		)
		.get(deadline) as { id: number };
	const roundId = row.id;
	console.log(`created round ${roundId}`);

	for (const d of decks) {
		upsertPlayer(db, d.did, d.handle, null);

		const cards: { name: string; json: string }[] = [];
		for (const name of d.cards) {
			const result = await lookupCard(name);
			if (!result.ok) {
				console.error(`failed to look up: ${name} — ${result.error}`);
				process.exit(1);
			}
			const sc = result.card;
			const card = {
				name: sc.name,
				manaCost: sc.mana_cost || "",
				cmc: sc.cmc,
				colors: sc.colors || [],
				types: sc.type_line
					.toLowerCase()
					.split(" — ")[0]
					.split(" ")
					.filter((t: string) =>
						[
							"creature",
							"instant",
							"sorcery",
							"enchantment",
							"artifact",
							"land",
							"planeswalker",
						].includes(t),
					),
				supertypes: [],
				subtypes: [],
				oracleText: sc.oracle_text || "",
				power: sc.power ? Number(sc.power) : undefined,
				toughness: sc.toughness ? Number(sc.toughness) : undefined,
				abilities: [],
				scryfallId: sc.id,
			};
			cards.push({ name: sc.name, json: JSON.stringify(card) });
		}

		upsertSubmission(db, roundId, d.did, cards);
		console.log(`  ${d.handle}: ${d.cards.join(", ")}`);
	}

	const round = getActiveRound(db);
	console.log(`\nround state: phase=${round?.phase}, id=${round?.id}`);
	console.log(`db written to: ${DB_PATH}`);
	db.close();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});

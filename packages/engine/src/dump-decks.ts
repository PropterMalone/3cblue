import type { Card } from "@3cblue/shared";
import {
	createDatabase,
	getActiveRound,
	getPlayer,
	getSubmissionsForRound,
} from "./database.js";

const DB_PATH = process.env.DB_PATH || "./test-round.db";
const db = createDatabase(DB_PATH);
const round = getActiveRound(db);
if (!round) {
	console.log("no active round");
	process.exit(0);
}

const subs = getSubmissionsForRound(db, round.id);
for (const s of subs) {
	const p = getPlayer(db, s.playerDid);
	const cards: Card[] = [
		JSON.parse(s.card1Json),
		JSON.parse(s.card2Json),
		JSON.parse(s.card3Json),
	];
	console.log(`@${p?.handle}:`);
	for (const c of cards) {
		const mana = c.manaCost ? ` ${c.manaCost}` : "";
		const pt = c.power !== undefined ? ` — ${c.power}/${c.toughness}` : "";
		console.log(`  **${c.name}**${mana}`);
		console.log(`  ${c.types.join(" ")}${pt}`);
		console.log(`  ${c.oracleText || "(no text)"}`);
		console.log();
	}
	console.log("---");
}
db.close();

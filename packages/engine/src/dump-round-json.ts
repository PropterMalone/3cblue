// One-off script: dump active round data as JSON for resolve-round
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
	console.log(JSON.stringify({ error: "no active round" }));
	process.exit(0);
}
const subs = getSubmissionsForRound(db, round.id);
const data = {
	roundId: round.id,
	phase: round.phase,
	submissions: subs.map((s) => {
		const player = getPlayer(db, s.playerDid);
		return {
			playerDid: s.playerDid,
			handle: player?.handle || s.playerDid,
			cards: [
				{ name: s.card1Name, json: s.card1Json },
				{ name: s.card2Name, json: s.card2Json },
				{ name: s.card3Name, json: s.card3Json },
			],
		};
	}),
};
console.log(JSON.stringify(data, null, 2));
db.close();

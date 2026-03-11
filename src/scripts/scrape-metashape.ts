// pattern: Imperative Shell
//
// Scrapes 3CB Metashape historical results from Google Sheets.
// Outputs structured JSON: matchups with decks, outcomes, and scores.
// Usage: npx tsx packages/engine/src/scrape-metashape.ts [output-path]

const SHEET_IDS: Record<number, string> = {
	1: "1elsSmRG1BtMvh5n_3-uXo3AAMVYAEc5vSIbG51MXQ8s",
	2: "1opsh5IzMfaqGoQNDYdA-mWgFmJgRS3TLnvB4SvnuKeo",
	3: "1tSi6vDXAm-f_ZEjTTUIdfTh7EY28j8Q0haKinqP-kLs",
	4: "1t4FU5Hh2A5y1dB3wcrC4JAbmDUaEF0AYnA6MPuIPaLs",
	5: "16ML40jEJ2XbqO3NS-Hx7NIqqDaHC4NIbqOlFtwj87KY",
	6: "1B-X6-fRWGLe2To_dwlxzyIUgsJwasY2fYyf2nsqvl6Y",
	7: "1kuCiZzzUn7CW6DE8jodkH6OS4hddzyGcNSO7kfuTS20",
	8: "1ntL9AsAGJsO4WLjWrVMzaK4gIMXX1JJTiHb8WB0Mnlk",
	9: "1YKTYjKXXLCqM-8Nuc4YjIzxEE-UAOuoxaBYQjwOcnLc",
	10: "1e3K4EdOOtb_Lom7NNA2RrIqqnwa2BphIw-yKs1rh6-4",
	11: "10lTKMvaDVYRjYibUw2srN5w7j8ns5Fzc6cpnrxi7PCs",
	12: "1jDajGziCsd5XAMSC3FZSzwXye6Q2tJxCfYayC4QJ8G0",
	13: "12mIGyztU4iQaPJiqkHDaJkut6GfOdtb1G9qENVU7QvY",
	14: "1OvprdA7Gm9hYZBcxygpU-A_K4ZJr_mjHZDUcxH8vNfI",
	15: "1Nad7GIYOTk5OBWIWLjSfdPVnMz9-AQeljryp5ZqrwgM",
	16: "1CN_OMNStc2rt939FU05y80ISe1mu68UBgYIr_u1GBr8",
	17: "1iEjY-YR19KpvJFOFtjbZJ-We6cfeuQ9W9y3fnK8vXyY",
	18: "10WR8MLAHiF2eiNGRZJs_ZXddFgULAzG_Nz_qa7oUQQU",
	19: "1dghGlxVsHco18gKNP1nI5fBlOHTLGLYUfQP72P6UgzQ",
	20: "1u_h7FULoE24dZHBQsGquU1ldn3tV8_4oA7ONjtT8wf0",
	21: "1suylmKpadZrBHWHqhOnqIRq5B0tECtZNFJiQL-lnlFA",
	22: "16Ft5mXHpfD1Ay3GieffnCw4aAnsII203LvVasSCGKOM",
	23: "1GnSlqKgKgPBdFaTOQr1GsiSjf2ae6ls2q7LIxJWKMJA",
	24: "1wiuIbfYeZloUmEA5vZIFVWobCNR_mt2AiynXNIF1vRk",
	25: "1fpmqYLMnFyAjeoJasFh-Y-mu0QANQtsqWs1-lFfsu1c",
	26: "16NR_fUA-mGawCcGak3e0scP4gHLDoM4uE7QAyUQsNfs",
	27: "1B9o4JyuVm0apMT_Yo3TETrB6JUyxeitL4DVYlD9lH0I",
	28: "1bUKJTdaqlS1QYQx8pR0PtOYt_YxSNVJOFkM387Q1XtI",
	29: "1qqE6nMxrNmVRBczs1ts3n2CLFe-DKPj4w2JV81J9LwE",
	30: "17jQeOgE1oP9QItD3l6jBsLj_F-X4A2BxWO4Tz-1QNhI",
	31: "1iiPIXcm9GCJ4Oqj_hP9LqivKN_zPTha0VnG_DpMirUA",
	32: "19B-6RRzjh-HyrZGPV4ZiAayX69qIpetCr03-WY4Onq0",
	33: "1gILXBjNlBhXcd_osiQV1Pxg_iTxwt7feGC7gdTWDzWA",
	34: "1dV6pP5GCxsu-N8OpStnow5iPrf5jni5FqGgpgnIZiiE",
	35: "19csLpmGsEDjSlt2X_uTMKdEP19r8Hw75NYBbvZFdCqY",
	36: "19F9T-MyL2B6uMF-LE9P1Q4UVfKXlqr4QEXFNjFt3NZo",
	37: "111fuusGAtStDE2BT0whyGUq82arKzQnRehUe2fI4ySo",
	38: "1D7AIQRsZUAlbhTPAY1if8Yo5bwc328qXoEuUhQgXkNQ",
	39: "1IkPXhxSRgoAXP9GIF_tPyV9QPhUUI2fOwl6Oktq5msw",
	40: "1JiKn0AEElj0rvQ5EhFoYAWBkFGx9COtXHIFCJzLv03g",
	41: "1J74CeRsMWEWu9InRZOTjyVVjXMlh8j6UNb1vCLkZ6mM",
	42: "1n984BsqiCsSkxAJYkYrKDmqLDLLJjonyvgpQoUXWZZs",
	43: "1SlBHGf6NpM_5czK1gp_x3-p_qxkaGkeUXpofUK1QtHg",
	44: "16mdivRK4XYcpkE814pzkTrUBzt48Uz2o_pHUVUmFGeI",
	45: "1EEB7lNzbJMIp-aNMFhPzelaEw6TnBwuRfuUxylskQV4",
	46: "1UDhlMnl0IpMelVbqa4EEn0O3oQD3D_IFT5-xkkZ32qE",
	47: "1KQQDiuXNX5lqyOiLGlTTp0OOc_L03bQrl1dL1oDhRZg",
	48: "1epzKKs12DNvP3QdlJxRvapDGtLG_2d8lEXPk7hncpUA",
	49: "1YOKz3g0xaC0FBxKLtEmO4LfupcZQ3W2Sw-ZXuXefxSE",
	50: "1toAqcoYExDv4ZDLUMTcMVhGfslhwFySNbcckAvRulqY",
	51: "1J6cuJiRaNcMIU1GgNGu0EwkXM0h5cryYqcfXfGmAMWc",
	52: "1bs1pw2xCVFxi1JCXZeOyb-P77KG-Nw7VmptpbDBKNeg",
	53: "1hhO7ZnA0oMBc7jouiJv0b1TqbndcjG_FNobaOvfBGRc",
	54: "15QmiEj12BcMYVuec_236NBRnFg5a_KY5msqIzquE33Q",
	55: "1wOQ_wIcwQa3QlHXoWrXXPxCW9KzmTCnSAcl2FOrgPYA",
	56: "15WELt7asKEQy6ZM0PGTL5jWvannivh8lgBm2W4OBByI",
	57: "1Sxn_-cFU91HKd_XseTFFduh-keuPsgZUaaDVnlHMQH8",
	58: "1FRTAQoaeTyFOJ3wnfJOwMyN-eBituoM-PIUL8NCj9Yk",
	59: "1g_SOE4dsjV2mnL8f3oiLHmR53JaFLjUfs4W8HlW92Pw",
	60: "1Rhe4cmA4AsU9gLPS6tEGZLt89j0IwYygYx0x--ecqoA",
	61: "1X8-VRE1W11w-4CLNwyAB4CwBh_xXCYiLPkJBdGkDajE",
	62: "1HKjbX0u73m0B3yg2uQUGLyLELIETiS7guH9bYtMvvFQ",
	63: "1RRg6Nt6N7MUbe42p9geKLhnPXaGOt3r5VX_VaKctwRQ",
	64: "1aG0aDWAvV0DRPywsbFl_agOZ5-Zv4ULk0oXxH5E2Gr4",
	65: "1XihsMMqBAHcn2KIWB7mZv4TWoy_LMJuZNsGgvK7K-co",
	66: "1Tz6p9HN9cqTP49bA_T8ldrymZPG_DoO5YK0UDZ1Dwp4",
	67: "1ofwZXzbI7lbhONfcSHl5bYmPwKX2cYjIIe3kjXCm0Xo",
	68: "1G8pyJtKJNlH0adSl5yHbT5_gfe3zQGiziL7aN2TVtO4",
	69: "1-ZlA0O9Vt7z9S45Oh17O3crJ7C0wOxMiYvsMXhEDAjs",
	70: "1eSv8LIoHcclZOo_6iBoKx6lEvzUfxGAmenttUQiL3z4",
	71: "1_7iVVeb40x3fX4UtfE8OUbch_jhvYzbYYUKWShOipFU",
	72: "19LiQvXYfLkgR-Iq0IDGv3o1MmFeU3hVhfCFJQ4gRo_o",
	73: "1oT-sS5L-HCqgAoWeyAvuVSAO_ooBV972F0pRr0f8zaA",
	74: "18KN7-L31JL1xx_xqzp1eeVSq4hEx19I4BJn0Q6-LU-Y",
	75: "1V-ROC68y7xQJtwn0f97diR5xEqqsP-s-ki-camYGAvE",
	76: "1vzbKatXmNtC3OVlPXqytCn6D4eixty2aw48_yMD6qfM",
	77: "1YH7TXoCA6ezh4akop0Sh9uKGvtWSDLa-XxzwBKwnw0U",
	78: "1wP1zovRW232jLKa3Si0ZKw0pZ_IOXc-qGt62Zs5WxgI",
	79: "171vJ3NM2mh6UdoWBWwDn67qs_HGTzd6D6FWSsGKYC7M",
	80: "1t-7sCyXHeuA2NOX92e9_O_EBC8ndAAHcrQIOybnY3Pc",
	81: "1LLceeYUdM8Ml7u3BIH6HQ0Nndmhr4dvuJ0pYX77oBlw",
	82: "1UQHvEHRTYBuRvRnDPRHISO4k6dNSmNYWULXBIdZXN50",
	83: "1BiHwFIwIt8oz1RGZnxSU8rM55SAC8sTSFU-6l3J7yeA",
	84: "1mazoKDdsc6oD1T5KHD_5oe8QnpnpcrvPpvEvA9-LSuw",
	85: "1BiHxaBESgEtDyAo_lM9ZhZxXnWFehxk_DZ39eXUjBYs",
	86: "1WnWgoGm_cIV6lQiOJ0bQSWlBUTg7iwnEXhRm3wqRyWY",
	87: "1UwBjqOtSTNmnOmX8a6cQbVEEPwnxqyKYokJEhFyt3G8",
	88: "1XhRkVYjF_j90ijoHgiCP9bhqtpY9lXVdXRP0_1xzSt8",
	89: "1egiDwmVujfSBNfkDnGr0LH-C6eYtKByo0xuB_yH7n2E",
	90: "1eiJP2_VmQ9d4q51BbDIFe3YRKH5kQqrnJgHiKWyq_TQ",
	91: "1RZHtHeZgxJK994levbKtDGXjjMySCftQpUP_917K9RI",
	92: "1wyeQV6z0AZHidBSMnTqXYFo-hWbtKhfIfkznJhwOgS8",
	93: "1z698BdDFqKEMqtpc1Qvzfa5k58BRJodE3DP7XX7M3I4",
	94: "1yQGIfyBMynvil8UrjHb2npm5jxJhur_VHAKwV1-HZYU",
	95: "1Za-ZQAr1KDbiLq7pqlcPDi1cp95U6CLK6vCzdCcfr_A",
	96: "1hNEC2YRUM4HE56hO4K7lwQLq6figuAVM5ld2qwO7ZeI",
	97: "12mUZmb-2BmqgKB1OK8kWYtHmNvLAj3hc_rUfnjLbaS8",
	98: "1ldFnRrJ8v3GgfSw6dF1fN5ODSBvDzcgiel-DuOGuL9E",
	99: "1PLWQbU4eMEJfS3uvBF5mC6ImlqUnSNDjdLWzUs7g15g",
	100: "1GkupIZQZRk0GsRZObuaYSCYvvV4PVG91QjZQFbmbrPY",
	101: "1yrLpByTtXZ39KmVGIFCJ58gMgbGNPgEJE4hbXLZIRYg",
	102: "1vjTD_bhQcHueMs2AVVNdTv8ni2d6Ty33KGe87ruC688",
	103: "1GMvpEZYhQ8A8z46QFSzA5wlVqBMhDtwsTPHk7YObLTw",
	104: "1EPDV6P5d_Y1PH4_f71cCkVtY4RnDtOyKUUfwO0lqmMQ",
	105: "1adtsKgvaKBofbzCdfAnTGY-CR6mtFCNpgpoIjy2HjXg",
	106: "1fEu_tiuBK60yHK1Yi-VqMRFPxJJXzZafAzKSruNR9IA",
};

interface Matchup {
	deck0: string[]; // sorted card names
	deck1: string[]; // sorted card names
	score: number; // from deck0's perspective (0/1/2/3/4/5/6)
	round: number;
	group: string;
}

interface MatchupDb {
	/** key: normalized "cardA|cardB|cardC vs cardD|cardE|cardF" */
	matchups: Record<string, { score: number; sources: string[] }>;
	totalMatchups: number;
	totalRounds: number;
	scrapedAt: string;
}

/** Normalize a deck to a canonical key: sorted lowercase card names joined by | */
function deckKey(cards: string[]): string {
	return cards
		.map((c) => c.trim().toLowerCase())
		.sort()
		.join("|");
}

/** Canonical matchup key: both decks normalized, ordered so smaller key comes first */
function matchupKey(deck0: string[], deck1: string[]): string {
	const k0 = deckKey(deck0);
	const k1 = deckKey(deck1);
	return k0 <= k1 ? `${k0} vs ${k1}` : `${k1} vs ${k0}`;
}

/** Parse CSV with proper handling of quoted multiline fields */
function parseCSV(raw: string): string[][] {
	const rows: string[][] = [];
	let current: string[] = [];
	let field = "";
	let inQuotes = false;

	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i]!;
		if (inQuotes) {
			if (ch === '"' && raw[i + 1] === '"') {
				field += '"';
				i++;
			} else if (ch === '"') {
				inQuotes = false;
			} else {
				field += ch;
			}
		} else {
			if (ch === '"') {
				inQuotes = true;
			} else if (ch === ",") {
				current.push(field);
				field = "";
			} else if (ch === "\n" || ch === "\r") {
				if (ch === "\r" && raw[i + 1] === "\n") i++;
				current.push(field);
				field = "";
				if (current.length > 1) rows.push(current);
				current = [];
			} else {
				field += ch;
			}
		}
	}
	// Final field/row
	current.push(field);
	if (current.length > 1) rows.push(current);

	return rows;
}

/** Parse card names from the VS column (newline-separated, sometimes with extra whitespace) */
function parseCards(vsField: string): string[] {
	return vsField
		.split("\n")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/** Score mapping: 6=win both, 0=lose both, 3=split, 2=draw both, etc. */
function parseScore(val: string): number | null {
	const trimmed = val.trim();
	if (trimmed === "" || trimmed === "-") return null;
	const n = Number(trimmed);
	return Number.isNaN(n) ? null : n;
}

async function fetchSheet(sheetId: string): Promise<string> {
	const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`failed to fetch sheet ${sheetId}: ${response.status}`);
	}
	return response.text();
}

async function scrapeRound(round: number, sheetId: string): Promise<Matchup[]> {
	const csv = await fetchSheet(sheetId);
	const rows = parseCSV(csv);
	if (rows.length < 2) return [];

	const matchups: Matchup[] = [];

	// Find group boundaries — header rows start with "Group X"
	let currentGroup = "A";
	let headerRow: string[] | null = null;
	const playerRows: { name: string; cards: string[]; scores: string[] }[] = [];

	function flushGroup() {
		if (!headerRow || playerRows.length < 2) {
			playerRows.length = 0;
			return;
		}

		const playerNames = headerRow.slice(2, headerRow.length - 1); // skip group label, VS, and Score

		for (let i = 0; i < playerRows.length; i++) {
			const p0 = playerRows[i]!;
			for (let j = i + 1; j < playerRows.length; j++) {
				const p1 = playerRows[j]!;
				// Score at column j is p0's score against p1
				const scoreVal = parseScore(p0.scores[j] ?? "");
				if (scoreVal === null) continue;
				if (p0.cards.length !== 3 || p1.cards.length !== 3) continue;

				matchups.push({
					deck0: p0.cards,
					deck1: p1.cards,
					score: scoreVal,
					round,
					group: currentGroup,
				});
			}
		}
		playerRows.length = 0;
	}

	for (const row of rows) {
		const first = (row[0] ?? "").trim();

		// Detect header row
		if (first.startsWith("Group") || first.startsWith("Final")) {
			flushGroup();
			currentGroup = first.replace(/^Group\s*/, "").replace(/^Final.*/, "F");
			headerRow = row;
			continue;
		}

		// Player data row: name, VS (cards), scores...
		if (headerRow && row.length >= 3) {
			const name = first;
			const vsField = row[1] ?? "";
			const cards = parseCards(vsField);
			// Scores start at column 2, end before last column (Score total)
			const scores = row.slice(2);

			if (name && cards.length > 0) {
				playerRows.push({ name, cards, scores });
			}
		}
	}
	flushGroup();

	return matchups;
}

async function main() {
	const outputPath = process.argv[2] ?? "./data/metashape-matchups.json";

	const allMatchups: Matchup[] = [];
	const rounds = Object.entries(SHEET_IDS).sort(
		(a, b) => Number(a[0]) - Number(b[0]),
	);

	console.log(`scraping ${rounds.length} rounds...`);

	for (const [roundStr, sheetId] of rounds) {
		const round = Number(roundStr);
		try {
			const matchups = await scrapeRound(round, sheetId);
			allMatchups.push(...matchups);
			process.stdout.write(`  round ${round}: ${matchups.length} matchups\n`);
			// Rate limit: Google Sheets export has limits
			await new Promise((resolve) => setTimeout(resolve, 500));
		} catch (err) {
			console.error(
				`  round ${round}: FAILED — ${err instanceof Error ? err.message : err}`,
			);
		}
	}

	// Deduplicate into matchup database keyed by normalized deck pair
	const db: MatchupDb = {
		matchups: {},
		totalMatchups: 0,
		totalRounds: rounds.length,
		scrapedAt: new Date().toISOString(),
	};

	for (const m of allMatchups) {
		const key = matchupKey(m.deck0, m.deck1);
		// Normalize score direction: if decks were swapped in the key, invert the score
		const k0 = deckKey(m.deck0);
		const k1 = deckKey(m.deck1);
		const swapped = k0 > k1;
		const normalizedScore = swapped ? 6 - m.score : m.score;

		if (!db.matchups[key]) {
			db.matchups[key] = { score: normalizedScore, sources: [] };
		}
		db.matchups[key].sources.push(`R${m.round}${m.group}`);
		db.totalMatchups++;
	}

	const uniqueMatchups = Object.keys(db.matchups).length;
	console.log(
		`\n${allMatchups.length} total matchups → ${uniqueMatchups} unique deck pairs`,
	);

	const { writeFileSync, mkdirSync } = await import("node:fs");
	const { dirname } = await import("node:path");
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, JSON.stringify(db, null, 2));
	console.log(`written to ${outputPath}`);
}

main().catch((err) => {
	console.error("fatal:", err);
	process.exit(1);
});

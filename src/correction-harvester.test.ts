import { describe, expect, test } from "vitest";
import {
	buildCardOwnerMap,
	correctionToVerdicts,
	isConfirmation,
	parseSingleCorrection as parseCorrection,
	parseCorrections,
} from "./correction-harvester.js";

const handles = [
	"nickchk.com",
	"achilleslaststand.bsky.social",
	"elyv.bsky.social",
	"brythefryguy.bsky.social",
	"egirlstravinsky.bsky.social",
	"mosheroperandi.bsky.social",
	"jkyu06.bsky.social",
	"tomscud.bsky.social",
	"mutantmell.net",
	"meatballwalrus.bsky.social",
	"nicholaslynn.bsky.social",
	"skis-n-reads.bsky.social",
];

describe("parseCorrection", () => {
	test("parses '@A should WW @B' format", () => {
		const result = parseCorrection(
			"@nickchk.com should WW @tomscud.bsky.social . The lifegain and flying on the bat races the rhinos.",
			"nickchk.com",
			"at://test/1",
			handles,
		);
		expect(result).not.toBeNull();
		expect(result!.playerA).toBe("nickchk.com");
		expect(result!.playerB).toBe("tomscud.bsky.social");
		expect(result!.verdict).toBe("WW");
	});

	test("parses 'A is LL to B' format", () => {
		const result = parseCorrection(
			"Nickchk is LL to achilleslaststand. Force hits the mox and I can't do anything.",
			"nickchk.com",
			"at://test/2",
			handles,
		);
		expect(result).not.toBeNull();
		expect(result!.verdict).toBe("LL");
	});

	test("parses 'VS @B should be XY' format", () => {
		const result = parseCorrection(
			"VS. @egirlstravinsky.bsky.social should be LL instead of DL. Deck too slow.",
			"tomscud.bsky.social",
			"at://test/3",
			handles,
		);
		expect(result).not.toBeNull();
		expect(result!.playerA).toBe("tomscud.bsky.social");
		expect(result!.playerB).toBe("egirlstravinsky.bsky.social");
		expect(result!.verdict).toBe("LL");
	});

	test("parses 'A is DD to B' format", () => {
		const result = parseCorrection(
			"Nickchk is DD to skis-n-reads. Factory + tap + bat is 4 power of blocking.",
			"nickchk.com",
			"at://test/4",
			handles,
		);
		expect(result).not.toBeNull();
		expect(result!.verdict).toBe("DD");
	});

	test("returns null for commentary", () => {
		expect(
			parseCorrection(
				"sweet! I'm pretty sure the bot doesn't understand my deck",
				"tomscud.bsky.social",
				"at://test/5",
				handles,
			),
		).toBeNull();
	});

	test("returns null for lol nvm", () => {
		expect(
			parseCorrection(
				"lol, nvm. just a discard heavy meta",
				"mosheroperandi.bsky.social",
				"at://test/6",
				handles,
			),
		).toBeNull();
	});

	test("returns null for short messages", () => {
		expect(
			parseCorrection("nice", "test.bsky.social", "at://test/7", handles),
		).toBeNull();
	});

	test("resolves partial handle via prefix match", () => {
		const result = parseCorrection(
			"I'm WL vs jkyu, I can't ever play the rootwalla to trade",
			"nicholaslynn.bsky.social",
			"at://test/prefix",
			handles,
		);
		expect(result).not.toBeNull();
		expect(result?.playerA).toBe("nicholaslynn.bsky.social");
		expect(result?.playerB).toBe("jkyu06.bsky.social");
		expect(result?.verdict).toBe("WL");
	});

	test("preserves verdict order as written (play/draw)", () => {
		const result = parseCorrection(
			"VS @brythefryguy.bsky.social should be DL instead of WL.",
			"tomscud.bsky.social",
			"at://test/8",
			handles,
		);
		expect(result).not.toBeNull();
		expect(result!.verdict).toBe("DL");
	});

	test("preserves LW verdict (does not sort to WL)", () => {
		const result = parseCorrection(
			"I'm LW vs @elyv.bsky.social, I lose on the play but win on the draw",
			"tomscud.bsky.social",
			"at://test/lw",
			handles,
		);
		expect(result).not.toBeNull();
		expect(result!.verdict).toBe("LW");
	});

	test("uses two mentions for third-party correction", () => {
		const result = parseCorrection(
			"@nickchk.com should be DL vs @achilleslaststand.bsky.social based on the construct clock",
			"tomscud.bsky.social",
			"at://test/thirdparty",
			handles,
		);
		expect(result).not.toBeNull();
		expect(result!.playerA).toBe("nickchk.com");
		expect(result!.playerB).toBe("achilleslaststand.bsky.social");
		expect(result!.verdict).toBe("DL");
	});

	test("parses natural-language form without should/is/vs keyword", () => {
		const result = parseCorrection(
			"@nickchk.com WW @achilleslaststand.bsky.social — the aggro plan just overwhelms them",
			"tomscud.bsky.social",
			"at://test/nokeyword",
			handles,
		);
		expect(result).not.toBeNull();
		expect(result!.playerA).toBe("nickchk.com");
		expect(result!.playerB).toBe("achilleslaststand.bsky.social");
		expect(result!.verdict).toBe("WW");
	});

	test("accepts trailing-s verdict forms (WLs, LLs, DDs)", () => {
		const result = parseCorrection(
			"@nickchk.com WLs @achilleslaststand.bsky.social on the play, loses on draw",
			"tomscud.bsky.social",
			"at://test/trailings",
			handles,
		);
		expect(result).not.toBeNull();
		expect(result!.verdict).toBe("WL");
	});
});

describe("buildCardOwnerMap + card-name resolution", () => {
	const cardOwners = buildCardOwnerMap([
		{
			playerHandle: "elyv.bsky.social",
			cards: ["Karakas", "Lightstall Inquisitor", "Cenn's Tactician"],
		},
		{
			playerHandle: "brythefryguy.bsky.social",
			cards: ["Urza's Saga", "Sol Ring", "Tel-Jilad Stylus"],
		},
		{
			playerHandle: "proptermalone.bsky.social",
			cards: ["Jace, Wielder of Mysteries", "Sand Silos", "Mental Misstep"],
		},
		{
			playerHandle: "tomscud.bsky.social",
			cards: ["Swamp", "Dark Ritual", "Rotting Regisaur"],
		},
		{
			playerHandle: "mutantmell.net",
			cards: ["Crystal Vein", "Simian Spirit Guide", "Magus of the Moon"],
		},
	]);

	test("maps distinctive tokens to their deck owners", () => {
		expect(cardOwners.get("karakas")).toBe("elyv.bsky.social");
		expect(cardOwners.get("magus")).toBe("mutantmell.net");
		expect(cardOwners.get("regisaur")).toBe("tomscud.bsky.social");
		expect(cardOwners.get("stylus")).toBe("brythefryguy.bsky.social");
		expect(cardOwners.get("saga")).toBe("brythefryguy.bsky.social");
	});

	test("excludes stopwords and short tokens", () => {
		// "of", "the", "and" are too short; stopwords like "play"/"draw" filtered
		expect(cardOwners.has("of")).toBe(false);
		expect(cardOwners.has("the")).toBe(false);
	});

	test("R10 propter: 'Karakas WLs Magus' → elyv WL mutantmell", () => {
		const handles = [
			"elyv.bsky.social",
			"mutantmell.net",
			"proptermalone.bsky.social",
			"tomscud.bsky.social",
			"brythefryguy.bsky.social",
		];
		const result = parseCorrection(
			"Karakas WLs Magus, I think-- on the play they get the 2/1 down and even if the etb effect didn't do anything that would be enough to force a trade with Magus and then the Kithkin wins it.",
			"proptermalone.bsky.social",
			"at://test/r10-karakas-magus",
			handles,
			cardOwners,
		);
		expect(result).not.toBeNull();
		expect(result!.playerA).toBe("elyv.bsky.social");
		expect(result!.playerB).toBe("mutantmell.net");
		expect(result!.verdict).toBe("WL");
	});

	test("R10 propter: 'DL for Karakas v Regisaur' → elyv DL tomscud", () => {
		const handles = [
			"elyv.bsky.social",
			"tomscud.bsky.social",
			"proptermalone.bsky.social",
		];
		const result = parseCorrection(
			"on the play Karakas can draw with Regisaur-- they need 3x Tactician activations to get to 6 power, which happens on t5. DL for Karakas v Regisaur I think.",
			"proptermalone.bsky.social",
			"at://test/r10-karakas-regisaur",
			handles,
			cardOwners,
		);
		expect(result).not.toBeNull();
		expect(result!.playerA).toBe("elyv.bsky.social");
		expect(result!.playerB).toBe("tomscud.bsky.social");
		expect(result!.verdict).toBe("DL");
	});

	test("R10 elyv: 'Karakas also LLs the Saga deck' → elyv LL bry", () => {
		const handles = [
			"elyv.bsky.social",
			"brythefryguy.bsky.social",
		];
		const result = parseCorrection(
			"Karakas also LLs the Saga deck because they get armies of enormous robots too fast.",
			"elyv.bsky.social",
			"at://test/r10-karakas-saga",
			handles,
			cardOwners,
		);
		expect(result).not.toBeNull();
		expect(result!.playerA).toBe("elyv.bsky.social");
		expect(result!.playerB).toBe("brythefryguy.bsky.social");
		expect(result!.verdict).toBe("LL");
	});
});

describe("parseCorrections (multi)", () => {
	test("splits multi-line post into separate corrections", () => {
		const results = parseCorrections(
			"VS. @egirlstravinsky.bsky.social should be LL instead of DL. Deck too slow.\nVS @brythefryguy.bsky.social should be DL instead of WL. On the play either they kill my tapland.",
			"tomscud.bsky.social",
			"at://test/multi",
			handles,
		);
		expect(results).toHaveLength(2);
		expect(results[0]!.playerB).toBe("egirlstravinsky.bsky.social");
		expect(results[0]!.verdict).toBe("LL");
		expect(results[1]!.playerB).toBe("brythefryguy.bsky.social");
		expect(results[1]!.verdict).toBe("DL");
	});

	test("returns empty array for non-correction text", () => {
		const results = parseCorrections(
			"sweet! I'm pretty sure the bot doesn't understand my deck",
			"tomscud.bsky.social",
			"at://test/none",
			handles,
		);
		expect(results).toHaveLength(0);
	});
});

describe("isConfirmation", () => {
	test("matches 'looks right'", () => {
		expect(isConfirmation("looks right")).toBe(true);
	});

	test("matches 'Yep, that's correct'", () => {
		expect(isConfirmation("Yep, that's correct")).toBe(true);
	});

	test("matches 'agreed'", () => {
		expect(isConfirmation("agreed")).toBe(true);
	});

	test("matches 'other results look right'", () => {
		expect(
			isConfirmation(
				"other results look right - I did game out the @achilleslaststand matchup",
			),
		).toBe(true);
	});

	test("does not match correction text", () => {
		expect(isConfirmation("VS @elyv.bsky.social should be WL")).toBe(false);
	});

	test("does not match long analysis", () => {
		expect(
			isConfirmation(
				"I looked at this matchup and the bot got it right because the ooze grows to 5/5 before attacking which means the trade works out in favor of the aggro deck on the play but on the draw the extra turn of growth matters a lot and then the defensive line holds",
			),
		).toBe(false);
	});
});

describe("correctionToVerdicts", () => {
	test("WW → play W draw W", () => {
		expect(correctionToVerdicts("WW")).toEqual({ play: "W", draw: "W" });
	});

	test("WL → play W draw L", () => {
		expect(correctionToVerdicts("WL")).toEqual({ play: "W", draw: "L" });
	});

	test("LL → play L draw L", () => {
		expect(correctionToVerdicts("LL")).toEqual({ play: "L", draw: "L" });
	});

	test("DD → play D draw D", () => {
		expect(correctionToVerdicts("DD")).toEqual({ play: "D", draw: "D" });
	});

	test("DL → play D draw L", () => {
		expect(correctionToVerdicts("DL")).toEqual({ play: "D", draw: "L" });
	});

	test("LW → play L draw W (preserved order)", () => {
		expect(correctionToVerdicts("LW")).toEqual({ play: "L", draw: "W" });
	});

	test("WD → play W draw D", () => {
		expect(correctionToVerdicts("WD")).toEqual({ play: "W", draw: "D" });
	});
});

// pattern: Functional Core

// Parses Oracle text into structured Ability objects.
// Handles the common cases; emits Unresolved for anything it can't parse.
// Coverage expands over time — every Unresolved is a future improvement opportunity.

import type {
	Ability,
	ActivatedTapDamage,
	ActivatedTapLifeGain,
	EtbCreateToken,
	EtbDamage,
	EtbLifeGain,
	EvergreenKeyword,
	KeywordAbility,
	StaticPtModifier,
	UnresolvedAbility,
} from "./card-types.js";

const KEYWORD_MAP: Record<string, EvergreenKeyword> = {
	flying: "flying",
	"first strike": "first_strike",
	"double strike": "double_strike",
	trample: "trample",
	deathtouch: "deathtouch",
	lifelink: "lifelink",
	reach: "reach",
	menace: "menace",
	defender: "defender",
	vigilance: "vigilance",
	indestructible: "indestructible",
	haste: "haste",
	hexproof: "hexproof",
	flash: "flash",
};

/** Parse a full Oracle text block into abilities */
export function parseOracleText(oracleText: string): Ability[] {
	if (!oracleText.trim()) return [];

	const abilities: Ability[] = [];
	const lines = oracleText.split("\n").map((l) => l.trim());

	for (const line of lines) {
		if (!line) continue;
		const parsed = parseLine(line);
		abilities.push(...parsed);
	}

	return abilities;
}

function parseLine(line: string): Ability[] {
	// Try keyword line first (e.g., "Flying, first strike" or just "Flying")
	const keywordResult = tryParseKeywordLine(line);
	if (keywordResult) return keywordResult;

	// Try ward with cost
	const wardResult = tryParseWard(line);
	if (wardResult) return [wardResult];

	// Try protection
	const protectionResult = tryParseProtection(line);
	if (protectionResult) return [protectionResult];

	// Try ETB damage
	const etbDamageResult = tryParseEtbDamage(line);
	if (etbDamageResult) return [etbDamageResult];

	// Try ETB life gain
	const etbLifeGainResult = tryParseEtbLifeGain(line);
	if (etbLifeGainResult) return [etbLifeGainResult];

	// Try ETB create token
	const etbTokenResult = tryParseEtbCreateToken(line);
	if (etbTokenResult) return [etbTokenResult];

	// Try activated tap: damage
	const tapDamageResult = tryParseTapDamage(line);
	if (tapDamageResult) return [tapDamageResult];

	// Try activated tap: life gain
	const tapLifeGainResult = tryParseTapLifeGain(line);
	if (tapLifeGainResult) return [tapLifeGainResult];

	// Try static P/T modifier
	const ptModResult = tryParseStaticPtModifier(line);
	if (ptModResult) return [ptModResult];

	// Can't parse — emit Unresolved
	return [makeUnresolved(line, "no matching parser rule")];
}

function tryParseKeywordLine(line: string): KeywordAbility[] | null {
	const lower = line.toLowerCase();
	// Keyword lines are comma-separated keywords, optionally with reminder text in parens
	const withoutReminder = lower.replace(/\([^)]*\)/g, "").trim();
	const parts = withoutReminder.split(",").map((p) => p.trim());

	const keywords: KeywordAbility[] = [];
	for (const part of parts) {
		if (!part) continue;
		const keyword = KEYWORD_MAP[part];
		if (!keyword) return null; // If any part isn't a keyword, this isn't a keyword line
		keywords.push({ kind: "keyword", keyword });
	}

	return keywords.length > 0 ? keywords : null;
}

function tryParseWard(line: string): KeywordAbility | null {
	const match = line.match(/^ward\s+(\{[^}]+\})/i);
	if (!match?.[1]) return null;
	return { kind: "keyword", keyword: "ward", cost: match[1] };
}

function tryParseProtection(line: string): KeywordAbility | null {
	const match = line.match(/^protection from (.+?)(?:\s*\(.*\))?$/i);
	if (!match?.[1]) return null;
	return { kind: "keyword", keyword: "protection", qualifier: match[1] };
}

function tryParseEtbDamage(line: string): EtbDamage | null {
	// "When CARDNAME enters the battlefield, it deals N damage to any target/target creature/target player"
	const match = line.match(
		/when .+ enters (?:the battlefield)?,? (?:it )?deals (\d+) damage to (any target|target creature|target player|target opponent|each opponent)/i,
	);
	if (!match?.[1]) return null;
	const amount = Number.parseInt(match[1], 10);
	const targetStr = match[2]?.toLowerCase() ?? "";
	const target = targetStr.includes("creature")
		? "creature"
		: targetStr.includes("opponent")
			? "opponent"
			: targetStr.includes("player")
				? "player"
				: "any_target";
	return { kind: "etb_damage", amount, target };
}

function tryParseEtbLifeGain(line: string): EtbLifeGain | null {
	const match = line.match(
		/when .+ enters (?:the battlefield)?,? (?:you )?gain (\d+) life/i,
	);
	if (!match?.[1]) return null;
	return { kind: "etb_life_gain", amount: Number.parseInt(match[1], 10) };
}

function tryParseEtbCreateToken(line: string): EtbCreateToken | null {
	// "When CARDNAME enters the battlefield, create a 1/1 white Soldier creature token"
	// "When CARDNAME enters the battlefield, create two 1/1 white Soldier creature tokens"
	const match = line.match(
		/when .+ enters (?:the battlefield)?,? create (?:a |an |(\w+) )?(\d+)\/(\d+) .+? (?:creature )?tokens?/i,
	);
	if (!match) return null;
	const countWord = match[1]?.toLowerCase();
	const count = countWord ? (wordToNumber(countWord) ?? 1) : 1;
	const power = Number.parseInt(match[2] ?? "0", 10);
	const toughness = Number.parseInt(match[3] ?? "0", 10);
	// Could parse token keywords from the text but keeping simple for now
	return { kind: "etb_create_token", count, power, toughness, keywords: [] };
}

function tryParseTapDamage(line: string): ActivatedTapDamage | null {
	// "{T}: CARDNAME deals N damage to any target"
	const match = line.match(
		/\{T\}.*?:.*?deals (\d+) damage to (any target|target creature|target player|target opponent)/i,
	);
	if (!match?.[1]) return null;
	const amount = Number.parseInt(match[1], 10);
	const targetStr = match[2]?.toLowerCase() ?? "";
	const target = targetStr.includes("creature")
		? "creature"
		: targetStr.includes("opponent")
			? "opponent"
			: targetStr.includes("player")
				? "player"
				: "any_target";
	return { kind: "activated_tap_damage", amount, target };
}

function tryParseTapLifeGain(line: string): ActivatedTapLifeGain | null {
	const match = line.match(/\{T\}.*?:.*?gain (\d+) life/i);
	if (!match?.[1]) return null;
	return {
		kind: "activated_tap_life_gain",
		amount: Number.parseInt(match[1], 10),
	};
}

function tryParseStaticPtModifier(line: string): StaticPtModifier | null {
	// "Other creatures you control get +1/+1"
	// "Enchanted creature gets +2/+2"
	const match = line.match(
		/(other creatures you control|enchanted creature|equipped creature|creatures you control) gets? ([+-]\d+)\/([+-]\d+)/i,
	);
	if (!match?.[1]) return null;
	const targetStr = match[1].toLowerCase();
	const target = targetStr.includes("other")
		? "other_creatures_you_control"
		: targetStr.includes("enchanted")
			? "enchanted_creature"
			: targetStr.includes("equipped")
				? "equipped_creature"
				: "creatures_you_control";
	return {
		kind: "static_pt_modifier",
		power: Number.parseInt(match[2] ?? "0", 10),
		toughness: Number.parseInt(match[3] ?? "0", 10),
		target,
	};
}

function makeUnresolved(oracleText: string, reason: string): UnresolvedAbility {
	return { kind: "unresolved", oracleText, reason };
}

const NUMBER_WORDS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
};

function wordToNumber(word: string): number | undefined {
	return NUMBER_WORDS[word];
}

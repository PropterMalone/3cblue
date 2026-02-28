// pattern: Imperative Shell

// Validates a 3-card deck submission: lookup cards from Scryfall,
// convert to engine Card objects, check format bans.

import {
	type BanCheckResult,
	type Card,
	checkDeckBans,
	scryfallToCard,
} from "@3cblue/shared";
import { type CardLookupResult, lookupCards } from "./scryfall-client.js";

export interface DeckValidationSuccess {
	ok: true;
	cards: [Card, Card, Card];
}

export interface DeckValidationError {
	ok: false;
	errors: string[];
}

export type DeckValidationResult = DeckValidationSuccess | DeckValidationError;

/** Parse card names from a DM message. Expects one card per line (3 lines). */
export function parseCardNames(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("//"));
}

/** Check if a card name is winner-banned. Injectable for testing. */
export type WinnerBanCheck = (cardName: string) => boolean;

/** Validate a 3-card deck: look up, convert, ban-check. */
export async function validateDeck(
	cardNames: readonly string[],
	isWinnerBanned?: WinnerBanCheck,
): Promise<DeckValidationResult> {
	const errors: string[] = [];

	if (cardNames.length !== 3) {
		return {
			ok: false,
			errors: [
				`expected exactly 3 cards, got ${cardNames.length}. send one card name per line.`,
			],
		};
	}

	// Look up all cards from Scryfall
	const lookupResults = await lookupCards(cardNames);

	// Check for lookup failures
	const cards: Card[] = [];
	for (let i = 0; i < lookupResults.length; i++) {
		const result = lookupResults[i] as CardLookupResult;
		if (!result.ok) {
			errors.push(`"${cardNames[i]}": ${result.error}`);
		} else {
			cards.push(scryfallToCard(result.card));
		}
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	// Check format bans
	const banResults = checkDeckBans(
		cards,
		lookupResults
			.filter((r): r is Extract<CardLookupResult, { ok: true }> => r.ok)
			.map((r) => r.card),
	);

	for (let i = 0; i < banResults.length; i++) {
		const ban = banResults[i];
		if (ban?.banned) {
			errors.push(`"${cards[i]?.name}" is banned: ${ban.reason}`);
		}
	}
	if (errors.length > 0) {
		return { ok: false, errors };
	}

	// Check winner bans
	if (isWinnerBanned) {
		for (const card of cards) {
			if (isWinnerBanned(card.name)) {
				errors.push(
					`"${card.name}" is banned (won a previous round).`,
				);
			}
		}
	}
	if (errors.length > 0) {
		return { ok: false, errors };
	}

	// Check for duplicates (same card name)
	const names = cards.map((c) => c.name.toLowerCase());
	const seen = new Set<string>();
	for (const name of names) {
		if (seen.has(name)) {
			errors.push(`duplicate card: "${name}". each card must be unique.`);
		}
		seen.add(name);
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	return { ok: true, cards: cards as [Card, Card, Card] };
}

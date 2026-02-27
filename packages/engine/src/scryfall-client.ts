// pattern: Imperative Shell

// Scryfall API client. Handles card lookup by name with caching.
// Respects Scryfall's rate limit (100ms between requests).

import type { ScryfallCard, ScryfallError } from "@3cblue/shared";

const SCRYFALL_API = "https://api.scryfall.com";
const MIN_REQUEST_INTERVAL_MS = 100;

let lastRequestTime = 0;

async function throttledFetch(url: string): Promise<Response> {
	const now = Date.now();
	const elapsed = now - lastRequestTime;
	if (elapsed < MIN_REQUEST_INTERVAL_MS) {
		await new Promise((resolve) =>
			setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed),
		);
	}
	lastRequestTime = Date.now();
	const response = await fetch(url);

	if (response.status === 429) {
		const retryAfter = response.headers.get("retry-after");
		const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : 1000;
		console.log(`[scryfall] 429 rate limited, retrying in ${waitMs}ms`);
		await new Promise((resolve) => setTimeout(resolve, waitMs));
		lastRequestTime = Date.now();
		return fetch(url);
	}

	return response;
}

export type CardLookupResult =
	| { ok: true; card: ScryfallCard }
	| { ok: false; error: string };

// In-memory cache keyed by lowercase card name
const cardCache = new Map<string, CardLookupResult>();

/** Look up a card by exact name via Scryfall API. */
export async function lookupCard(name: string): Promise<CardLookupResult> {
	const key = name.toLowerCase().trim();
	const cached = cardCache.get(key);
	if (cached) return cached;

	const url = `${SCRYFALL_API}/cards/named?exact=${encodeURIComponent(key)}`;
	const response = await throttledFetch(url);

	let result: CardLookupResult;
	if (response.ok) {
		const card = (await response.json()) as ScryfallCard;
		result = { ok: true, card };
	} else {
		const err = (await response.json()) as ScryfallError;
		result = { ok: false, error: err.details ?? `card not found: ${name}` };
	}

	cardCache.set(key, result);
	return result;
}

/** Look up multiple cards by name. Returns all results (check each for ok/error). */
export async function lookupCards(
	names: readonly string[],
): Promise<CardLookupResult[]> {
	// Sequential to respect rate limit
	const results: CardLookupResult[] = [];
	for (const name of names) {
		results.push(await lookupCard(name));
	}
	return results;
}

/** Clear the in-memory card cache (for testing). */
export function clearCardCache(): void {
	cardCache.clear();
}

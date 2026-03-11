// pattern: Functional Core
// Scryfall API response types — just the fields we use.

export interface ScryfallCard {
	readonly id: string;
	readonly name: string;
	readonly mana_cost?: string;
	readonly cmc: number;
	readonly colors?: string[];
	readonly type_line: string;
	readonly oracle_text?: string;
	readonly power?: string;
	readonly toughness?: string;
	readonly loyalty?: string;
	readonly keywords?: string[];
	readonly image_uris?: {
		readonly small?: string;
		readonly normal?: string;
		readonly large?: string;
	};
	readonly legalities?: Record<string, string>;
	readonly layout?: string;
	// For double-faced / split / adventure cards
	readonly card_faces?: ScryfallCardFace[];
	readonly set_type?: string;
}

export interface ScryfallCardFace {
	readonly name: string;
	readonly mana_cost?: string;
	readonly type_line: string;
	readonly oracle_text?: string;
	readonly power?: string;
	readonly toughness?: string;
	readonly loyalty?: string;
	readonly colors?: string[];
	readonly image_uris?: {
		readonly small?: string;
		readonly normal?: string;
	};
}

export interface ScryfallError {
	readonly status: number;
	readonly code: string;
	readonly details: string;
}

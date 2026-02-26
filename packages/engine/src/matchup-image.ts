// pattern: Imperative Shell

// Renders matchup report images for Bluesky posting.
// Produces up to 3 images per matchup:
//   1. Player 0's deck (3 cards side by side)
//   2. Player 1's deck (3 cards side by side)
//   3. Narrative card (verdict + play-by-play text)

import sharp from "sharp";

const SCRYFALL_IMAGE_URL =
	"https://api.scryfall.com/cards/named?format=image&version=normal&exact=";

// Card image dimensions (Scryfall normal is 488x680)
const CARD_WIDTH = 244;
const CARD_HEIGHT = 340;
const CARD_GAP = 12;
const DECK_PADDING = 16;
const LABEL_HEIGHT = 40;

// Narrative card dimensions
const NARRATIVE_WIDTH = 750;
const NARRATIVE_PADDING = 32;
const LINE_HEIGHT = 24;
const HEADING_LINE_HEIGHT = 32;

/** Fetch a card image from Scryfall and resize it. */
async function fetchCardImage(cardName: string): Promise<Buffer> {
	const url = `${SCRYFALL_IMAGE_URL}${encodeURIComponent(cardName)}`;
	const response = await fetch(url);
	if (!response.ok) {
		// Return a placeholder gray card
		return sharp({
			create: {
				width: CARD_WIDTH,
				height: CARD_HEIGHT,
				channels: 4,
				background: { r: 128, g: 128, b: 128, alpha: 1 },
			},
		})
			.png()
			.toBuffer();
	}
	const buffer = Buffer.from(await response.arrayBuffer());
	return sharp(buffer)
		.resize(CARD_WIDTH, CARD_HEIGHT, { fit: "cover" })
		.png()
		.toBuffer();
}

/** Render a player's 3-card deck as a single image with handle label. */
export async function renderDeckImage(
	handle: string,
	cardNames: readonly string[],
): Promise<Buffer> {
	// Fetch all card images in parallel
	const cardImages = await Promise.all(cardNames.map(fetchCardImage));

	const totalWidth = DECK_PADDING * 2 + CARD_WIDTH * 3 + CARD_GAP * 2;
	const totalHeight = DECK_PADDING + LABEL_HEIGHT + CARD_HEIGHT + DECK_PADDING;

	// SVG label
	const labelSvg = `<svg width="${totalWidth}" height="${LABEL_HEIGHT}">
		<text x="${totalWidth / 2}" y="${LABEL_HEIGHT - 8}" text-anchor="middle"
			font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="bold"
			fill="#e0e0e0">@${escapeXml(handle)}</text>
	</svg>`;

	const composites: sharp.OverlayOptions[] = [
		// Handle label
		{ input: Buffer.from(labelSvg), top: DECK_PADDING, left: 0 },
	];

	// Card images
	for (let i = 0; i < cardImages.length; i++) {
		const img = cardImages[i];
		if (!img) continue;
		composites.push({
			input: img,
			top: DECK_PADDING + LABEL_HEIGHT,
			left: DECK_PADDING + i * (CARD_WIDTH + CARD_GAP),
		});
	}

	return sharp({
		create: {
			width: totalWidth,
			height: totalHeight,
			channels: 4,
			background: { r: 24, g: 24, b: 32, alpha: 1 },
		},
	})
		.composite(composites)
		.png()
		.toBuffer();
}

export interface NarrativeCardInput {
	handle0: string;
	handle1: string;
	verdict: string; // "Player 0 wins" / "Player 1 wins" / "Draw"
	onPlayVerdict: string;
	onDrawVerdict: string;
	playNarrative: string;
	drawNarrative: string;
}

/** Render narrative text as a clean card image. */
export async function renderNarrativeImage(
	input: NarrativeCardInput,
): Promise<Buffer> {
	const lines = buildNarrativeLines(input);
	const textHeight =
		lines.reduce(
			(h, line) =>
				h +
				(line.heading ? HEADING_LINE_HEIGHT : LINE_HEIGHT) +
				(line.gap ?? 0),
			0,
		) +
		NARRATIVE_PADDING * 2;

	const totalHeight = Math.max(textHeight, 200);

	const svgLines: string[] = [];
	let y = NARRATIVE_PADDING + 20; // start below top padding

	for (const line of lines) {
		if (line.gap) y += line.gap;

		const fontSize = line.heading ? 22 : line.small ? 15 : 17;
		const fontWeight = line.heading ? "bold" : "normal";
		const fill = line.dim ? "#888888" : line.accent ? "#e8c44a" : "#e0e0e0";
		const lineH = line.heading ? HEADING_LINE_HEIGHT : LINE_HEIGHT;

		// Word-wrap long lines
		const wrapped = wordWrap(line.text, line.small ? 70 : 55);
		for (const wl of wrapped) {
			svgLines.push(
				`<text x="${NARRATIVE_PADDING}" y="${y}" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}">${escapeXml(wl)}</text>`,
			);
			y += lineH;
		}
	}

	const svgHeight = y + NARRATIVE_PADDING;

	const svg = `<svg width="${NARRATIVE_WIDTH}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
		<rect width="100%" height="100%" fill="#181820"/>
		${svgLines.join("\n\t\t")}
	</svg>`;

	return sharp(Buffer.from(svg)).png().toBuffer();
}

interface NarrativeLine {
	text: string;
	heading?: boolean;
	dim?: boolean;
	small?: boolean;
	accent?: boolean;
	gap?: number; // extra vertical space before this line
}

function buildNarrativeLines(input: NarrativeCardInput): NarrativeLine[] {
	const lines: NarrativeLine[] = [];

	// Title
	lines.push({
		text: `@${input.handle0} vs @${input.handle1}`,
		heading: true,
	});

	// Overall verdict
	lines.push({
		text: input.verdict,
		accent: true,
		gap: 4,
	});

	// On the play
	lines.push({
		text: `On the play: ${input.onPlayVerdict}`,
		dim: true,
		gap: 16,
	});
	if (input.playNarrative) {
		lines.push({ text: input.playNarrative, small: true });
	}

	// On the draw
	lines.push({
		text: `On the draw: ${input.onDrawVerdict}`,
		dim: true,
		gap: 16,
	});
	if (input.drawNarrative) {
		lines.push({ text: input.drawNarrative, small: true });
	}

	return lines;
}

function wordWrap(text: string, maxChars: number): string[] {
	if (text.length <= maxChars) return [text];
	const words = text.split(" ");
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (current.length + word.length + 1 > maxChars && current.length > 0) {
			lines.push(current);
			current = word;
		} else {
			current = current ? `${current} ${word}` : word;
		}
	}
	if (current) lines.push(current);
	return lines;
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** Render all images for a single matchup. Returns [deck0, deck1, narrative] buffers. */
export async function renderMatchupImages(opts: {
	handle0: string;
	handle1: string;
	cardNames0: readonly string[];
	cardNames1: readonly string[];
	verdict: string;
	onPlayVerdict: string;
	onDrawVerdict: string;
	playNarrative: string;
	drawNarrative: string;
}): Promise<{ deck0: Buffer; deck1: Buffer; narrative: Buffer }> {
	const [deck0, deck1, narrative] = await Promise.all([
		renderDeckImage(opts.handle0, opts.cardNames0),
		renderDeckImage(opts.handle1, opts.cardNames1),
		renderNarrativeImage({
			handle0: opts.handle0,
			handle1: opts.handle1,
			verdict: opts.verdict,
			onPlayVerdict: opts.onPlayVerdict,
			onDrawVerdict: opts.onDrawVerdict,
			playNarrative: opts.playNarrative,
			drawNarrative: opts.drawNarrative,
		}),
	]);

	return { deck0, deck1, narrative };
}

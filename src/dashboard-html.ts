// pattern: Functional Core (generateDashboardHtml) + Imperative Shell (generateDashboardFromDb)

import type Database from "better-sqlite3";
import type { DbMatchup } from "./database.js";
import {
	getActiveRound,
	getMatchupsForRound,
	getPlayer,
	getRound,
	getSubmissionsForRound,
	getWinnerBans,
} from "./database.js";
import { computeStandings } from "./round-lifecycle.js";
import type { StandingsEntry } from "./round-lifecycle.js";

export interface DashboardData {
	round: {
		id: number;
		phase: string;
		deadline: string | null;
		submissionCount: number;
	};
	standings: StandingsEntry[];
	matchups: DbMatchup[];
	players: Map<string, { handle: string; cards: [string, string, string] }>;
	bannedCards: { cardName: string; bannedFromRound: number }[];
}

// Phase visibility gates:
// - submission: player count + deadline only
// - resolution/judging: decklists, standings (if matchups exist), matrix as results arrive
// - complete: full dashboard (standings, matrix, banned cards)

function showDecklists(phase: string): boolean {
	return phase !== "submission";
}

function showStandings(phase: string): boolean {
	return phase !== "submission";
}

function showMatrix(phase: string): boolean {
	return phase !== "submission";
}

function verdictChar(verdict: string, isP0: boolean): string {
	if (verdict === "player0_wins") return isP0 ? "W" : "L";
	if (verdict === "player1_wins") return isP0 ? "L" : "W";
	return "D";
}

interface PairResult {
	display: string;
	tooltip: string;
	cardsA?: string[];
	cardsB?: string[];
	handleA?: string;
	handleB?: string;
}

function getPairResult(
	matchups: DbMatchup[],
	playerA: string,
	playerB: string,
	players: Map<string, { handle: string; cards: [string, string, string] }>,
): PairResult | null {
	if (playerA === playerB) return { display: "—", tooltip: "" };

	const m = matchups.find(
		(m) =>
			(m.player0Did === playerA && m.player1Did === playerB) ||
			(m.player0Did === playerB && m.player1Did === playerA),
	);
	if (!m) return null;

	const outcome = m.judgeResolution ?? m.outcome;
	if (outcome === "unresolved") return { display: "?", tooltip: "" };

	const isP0 = m.player0Did === playerA;

	let display: string;
	let tooltip = "";

	// Try per-direction from narrative JSON
	try {
		if (m.narrative) {
			const data = JSON.parse(m.narrative);
			if (data.onPlayVerdict && data.onDrawVerdict) {
				const p0PlayChar = verdictChar(data.onPlayVerdict, isP0);
				const p0DrawChar = verdictChar(data.onDrawVerdict, isP0);
				// Convention: first letter = on-play result, always show as WL/WD/DL not LW/DW/LD
				const sorted = [p0PlayChar, p0DrawChar].sort((a, b) => {
					const order: Record<string, number> = { W: 0, D: 1, L: 2 };
					return (order[a] ?? 9) - (order[b] ?? 9);
				});
				display = `${sorted[0]}${sorted[1]}`;

				// Build tooltip from narratives
				// When hA is not p0, swap both verdicts AND narratives so
				// "hA on play" uses the DB's on_draw data (p0 is on draw when hA is on play)
				const pA = players.get(playerA);
				const pB = players.get(playerB);
				const hA = pA ? pA.handle.replace(".bsky.social", "") : "P0";
				const hB = pB ? pB.handle.replace(".bsky.social", "") : "P1";
				const playNarr = data.playNarrative ?? "";
				const drawNarr = data.drawNarrative ?? "";
				if (playNarr || drawNarr) {
					// hA's on-play char: when hA is p0, use p0PlayChar; when hA is p1, use p0DrawChar (flipped)
					const hAPlayChar = isP0 ? p0PlayChar : p0DrawChar;
					const hADrawChar = isP0 ? p0DrawChar : p0PlayChar;
					const playLabel =
						hAPlayChar === "W"
							? `${hA} wins`
							: hAPlayChar === "L"
								? `${hB} wins`
								: "Draw";
					const drawLabel =
						hADrawChar === "W"
							? `${hA} wins`
							: hADrawChar === "L"
								? `${hB} wins`
								: "Draw";
					const pNarr = isP0 ? playNarr : drawNarr;
					const dNarr = isP0 ? drawNarr : playNarr;
					const cardsA = pA ? pA.cards.join(", ") : "";
					const cardsB = pB ? pB.cards.join(", ") : "";
					tooltip = `${hA}: ${cardsA}\n${hB}: ${cardsB}\n\n${hA} on play (${playLabel}): ${pNarr}\n${hA} on draw (${drawLabel}): ${dNarr}`;
				}
				return { display, tooltip, cardsA: pA?.cards, cardsB: pB?.cards, handleA: hA, handleB: hB };
			}
		}
	} catch {
		// malformed narrative, fall through
	}

	// Legacy fallback: single-char result
	switch (outcome) {
		case "player0_wins":
			display = isP0 ? "W" : "L";
			break;
		case "player1_wins":
			display = isP0 ? "L" : "W";
			break;
		case "draw":
			display = "D";
			break;
		default:
			display = "?";
	}
	return { display, tooltip };
}

function resultClass(result: string | null): string {
	switch (result) {
		case "W":
		case "WW":
			return "res-w";
		case "L":
		case "LL":
			return "res-l";
		case "D":
		case "DD":
			return "res-d";
		case "WD":
		case "DW":
			return "res-wd";
		case "WL":
		case "LW":
			return "res-wl";
		case "DL":
		case "LD":
			return "res-dl";
		case "?":
			return "res-q";
		default:
			return "";
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Pure function: generate dashboard HTML from structured data. */
export function generateDashboardHtml(data: DashboardData): string {
	const { round, standings, matchups, players, bannedCards } = data;
	const phase = round.phase;
	const phaseLabel = phase.charAt(0).toUpperCase() + phase.slice(1);

	// Info boxes — always show phase + players, only show matchups when past submission
	const matchupBox = showMatrix(phase)
		? `<div class="info-box">
		<div class="label">Matchups</div>
		<div class="value">${matchups.length}</div>
	</div>`
		: "";

	// Deadline display
	let deadlineHtml = "";
	if (round.deadline) {
		deadlineHtml = `<p class="deadline">Deadline: <time datetime="${round.deadline}">${round.deadline}</time></p>`;
	}

	// Submission phase: just the header info, deadline, and banned cards
	if (phase === "submission") {
		return wrapHtml(
			round,
			`
<h1>3CBlue <span>Round ${round.id} Dashboard</span></h1>
<div class="info-row">
	<div class="info-box">
		<div class="label">Phase</div>
		<div><span class="phase phase-${phase}">${phaseLabel}</span></div>
	</div>
	<div class="info-box">
		<div class="label">Players</div>
		<div class="value">${round.submissionCount}</div>
	</div>
</div>
${deadlineHtml}

<p class="dim">Decklists will be revealed after the submission deadline.</p>

${bannedSection(bannedCards)}`,
		);
	}

	// Post-submission: show decklists, standings, matrix

	// Standings table
	const deckColumn = showDecklists(phase);
	const standingsRows = standings
		.map((s, i) => {
			const p = players.get(s.playerDid);
			const handle = p ? escapeHtml(p.handle) : s.playerDid.slice(0, 16);
			const deckCell =
				deckColumn && p
					? `<td class="deck-cards">${p.cards.map((c) => escapeHtml(c)).join(", ")}</td>`
					: "";
			return `<tr>
			<td class="rank">${i + 1}</td>
			<td class="handle">@${handle}</td>
			<td class="pts">${s.points}</td>
			<td>${s.wins}</td>
			<td>${s.draws}</td>
			<td>${s.losses}</td>
			${deckCell}
		</tr>`;
		})
		.join("\n");

	const deckHeader = deckColumn ? "<th>Deck</th>" : "";
	let standingsHtml = "";
	if (showStandings(phase) && standings.length > 0) {
		standingsHtml = `
<h2>Standings</h2>
<table class="standings">
	<thead><tr><th>#</th><th>Player</th><th>Pts</th><th>W</th><th>D</th><th>L</th>${deckHeader}</tr></thead>
	<tbody>${standingsRows}</tbody>
</table>`;
	} else if (showStandings(phase)) {
		standingsHtml = `
<h2>Standings</h2>
<p class="dim">No matchups resolved yet.</p>`;
	}

	// Matrix
	let matrixHtml = "";
	if (showMatrix(phase) && matchups.length > 0 && standings.length > 0) {
		const playerOrder = standings.map((s) => s.playerDid);
		const headerCells = playerOrder
			.map((did) => {
				const p = players.get(did);
				const label = p ? escapeHtml(p.handle) : "?";
				return `<th class="matrix-col" title="@${label}">${label.length > 8 ? `${label.slice(0, 7)}…` : label}</th>`;
			})
			.join("");

		const rows = playerOrder
			.map((rowDid) => {
				const p = players.get(rowDid);
				const label = p ? escapeHtml(p.handle) : "?";
				const cells = playerOrder
					.map((colDid) => {
						const result = getPairResult(matchups, rowDid, colDid, players);
						const cls = resultClass(result?.display ?? null);
						const titleAttr = result?.tooltip
							? ` title="${escapeHtml(result.tooltip)}"`
							: "";
						const cardsAttr =
							result?.cardsA && result?.cardsB
								? ` data-cards-a="${escapeHtml(result.cardsA.join("|"))}" data-cards-b="${escapeHtml(result.cardsB.join("|"))}" data-ha="${escapeHtml(result.handleA ?? "")}" data-hb="${escapeHtml(result.handleB ?? "")}"`
								: "";
						return `<td class="${cls}"${titleAttr}${cardsAttr}>${result?.display ?? ""}</td>`;
					})
					.join("");
				return `<tr><th class="matrix-row" title="@${label}">${label.length > 8 ? `${label.slice(0, 7)}…` : label}</th>${cells}</tr>`;
			})
			.join("\n");

		matrixHtml = `
		<h2>Matchup Matrix</h2>
		<div class="matrix-wrap">
			<table class="matrix">
				<thead><tr><th></th>${headerCells}</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`;
	}

	return wrapHtml(
		round,
		`
<h1>3CBlue <span>Round ${round.id} Dashboard</span></h1>
<div class="info-row">
	<div class="info-box">
		<div class="label">Phase</div>
		<div><span class="phase phase-${phase}">${phaseLabel}</span></div>
	</div>
	<div class="info-box">
		<div class="label">Players</div>
		<div class="value">${round.submissionCount}</div>
	</div>
	${matchupBox}
</div>
${deadlineHtml}

${standingsHtml}

${matrixHtml}

${bannedSection(bannedCards)}`,
	);
}

function bannedSection(
	bannedCards: { cardName: string; bannedFromRound: number }[],
): string {
	const bannedHtml =
		bannedCards.length > 0
			? bannedCards
					.map(
						(b) =>
							`<li>${escapeHtml(b.cardName)} <span class="dim">(R${b.bannedFromRound})</span></li>`,
					)
					.join("\n")
			: "<li><em>None yet</em></li>";

	return `<h2>Banned Cards</h2>
<ul class="banned-list">
${bannedHtml}
</ul>`;
}

function wrapHtml(round: { id: number; phase: string }, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>3CBlue Dashboard — Round ${round.id}</title>
<style>
  :root { --bg: #0d1117; --fg: #e6edf3; --accent: #4a9eff; --dim: #8b949e; --card: #161b22; --border: #30363d; --gold: #e5a832; --green: #3fb950; --red: #f85149; --yellow: #d29922; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.6; padding: 2rem 1rem; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.8rem; margin-bottom: 0.3rem; }
  h1 span { color: var(--dim); font-weight: normal; font-size: 1rem; }
  h2 { color: var(--accent); font-size: 1.2rem; margin: 2rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
  p { margin-bottom: 0.5rem; }
  .dim { color: var(--dim); }
  .phase { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 4px; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; }
  .phase-submission { background: #1a3a2a; color: var(--green); }
  .phase-resolution { background: #3a2a1a; color: var(--yellow); }
  .phase-judging { background: #3a1a1a; color: var(--red); }
  .phase-complete { background: #1a2a3a; color: var(--accent); }
  .deadline { color: var(--dim); font-size: 0.9rem; }
  .info-row { display: flex; gap: 2rem; flex-wrap: wrap; margin: 1rem 0; }
  .info-box { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.5rem; }
  .info-box .label { color: var(--dim); font-size: 0.8rem; text-transform: uppercase; }
  .info-box .value { font-size: 1.5rem; font-weight: 700; color: var(--gold); }

  /* Standings table */
  table.standings { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  .standings th, .standings td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border); }
  .standings th { color: var(--accent); font-size: 0.8rem; text-transform: uppercase; }
  .standings .rank { color: var(--dim); width: 2rem; }
  .standings .pts { color: var(--gold); font-weight: 600; }
  .standings .handle { font-weight: 500; }
  .standings .deck-cards { color: var(--dim); font-size: 0.85rem; max-width: 300px; }

  /* Matrix */
  .matrix-wrap { overflow-x: auto; margin: 1rem 0; }
  table.matrix { border-collapse: collapse; font-size: 0.75rem; }
  .matrix th, .matrix td { padding: 0.25rem 0.4rem; border: 1px solid var(--border); text-align: center; min-width: 2rem; }
  .matrix thead th { position: sticky; top: 0; background: var(--bg); writing-mode: vertical-lr; text-orientation: mixed; transform: rotate(180deg); height: 6rem; color: var(--dim); font-weight: 500; }
  .matrix .matrix-row { position: sticky; left: 0; background: var(--bg); text-align: right; padding-right: 0.5rem; color: var(--dim); font-weight: 500; white-space: nowrap; }
  .res-w { background: #1a3a2a; color: var(--green); font-weight: 700; }
  .res-l { background: #3a1a1a; color: var(--red); font-weight: 700; }
  .res-d { background: #3a2a1a; color: var(--yellow); }
  .res-wd { background: #1a3a2a; color: #7ad88e; }
  .res-wl { background: #2a2a1a; color: var(--yellow); font-weight: 600; }
  .res-dl { background: #3a221a; color: #d2793a; }
  .res-q { background: #2a1a3a; color: #b87aff; }

  /* Banned cards */
  .banned-list { list-style: none; padding: 0; column-count: 2; column-gap: 2rem; }
  .banned-list li { padding: 0.2rem 0; }
  @media (max-width: 600px) { .banned-list { column-count: 1; } .standings .deck-cards { display: none; } }

  /* Inline narrative expansion */
  .narr-row td { padding: 0 !important; border: none !important; }
  .narr-inline { background: var(--card); border: 1px solid var(--accent); border-radius: 6px; padding: 0.75rem 1rem; margin: 0.25rem 0; font-size: 0.85rem; line-height: 1.5; }
  .narr-inline .narr-close { float: right; cursor: pointer; color: var(--dim); font-size: 1.1rem; padding: 0 0.3rem; }
  .narr-inline .narr-close:hover { color: var(--fg); }
  .narr-inline .narr-decklist { color: var(--dim); font-size: 0.82rem; margin-bottom: 0.2rem; display: none; }
  .narr-inline .narr-cards { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
  .narr-inline .narr-deck { flex: 1; min-width: 200px; }
  .narr-inline .narr-deck-label { color: var(--dim); font-size: 0.78rem; font-weight: 600; margin-bottom: 0.25rem; }
  .narr-inline .narr-deck-imgs { display: flex; gap: 4px; }
  .narr-inline .narr-deck-imgs img { width: 146px; border-radius: 6px; }
  @media (max-width: 600px) { .narr-inline .narr-deck-imgs img { width: 100px; } }
  .narr-inline .narr-label { color: var(--accent); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; margin-top: 0.4rem; }
  .narr-inline .narr-text { color: var(--fg); margin: 0.15rem 0 0.4rem; }
  .matrix td[data-narr] { cursor: pointer; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }

  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--dim); font-size: 0.85rem; }
  a { color: var(--accent); }
</style>
</head>
<body>

${body}

<footer>
	<p>Auto-generated dashboard. <a href="/3cb/faq">FAQ & Rules</a></p>
</footer>

<script>
(function() {
	var matrix = document.querySelector('.matrix');
	if (!matrix) return;

	// Move title → data-narr to suppress native tooltip on touch
	matrix.querySelectorAll('td[title]').forEach(function(td) {
		td.setAttribute('data-narr', td.getAttribute('title'));
		td.removeAttribute('title');
	});

	function closeNarr() {
		var old = matrix.querySelector('.narr-row');
		if (old) old.remove();
	}

	function cardImgUrl(name) {
		return 'https://api.scryfall.com/cards/named?exact=' + encodeURIComponent(name) + '&format=image&version=normal';
	}

	function buildDeckImgs(label, cards) {
		var html = '<div class="narr-deck"><div class="narr-deck-label">' + label + '</div><div class="narr-deck-imgs">';
		for (var i = 0; i < cards.length; i++) {
			html += '<img src="' + cardImgUrl(cards[i]) + '" alt="' + cards[i] + '" loading="lazy">';
		}
		return html + '</div></div>';
	}

	function buildHtml(raw, td) {
		var lines = raw.split('\\n');
		var html = '<span class="narr-close">\\u2715</span>';
		var cardsA = (td.getAttribute('data-cards-a') || '').split('|').filter(Boolean);
		var cardsB = (td.getAttribute('data-cards-b') || '').split('|').filter(Boolean);
		var hA = td.getAttribute('data-ha') || '';
		var hB = td.getAttribute('data-hb') || '';
		if (cardsA.length && cardsB.length) {
			html += '<div class="narr-cards">' + buildDeckImgs(hA, cardsA) + buildDeckImgs(hB, cardsB) + '</div>';
		}
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if (!line) continue;
			var match = line.match(/^(.+?on (?:play|draw) \\(.+?\\)):\\s*(.+)$/);
			if (match) {
				html += '<div class="narr-label">' + match[1] + '</div>';
				html += '<div class="narr-text">' + match[2] + '</div>';
			} else {
				var m2 = line.match(/^(.+?):\\s*(.+)$/);
				if (m2 && line.indexOf(' on play ') === -1 && line.indexOf(' on draw ') === -1) {
					html += '<div class="narr-decklist">' + line + '</div>';
				} else if (m2) {
					html += '<div class="narr-label">' + m2[1] + '</div>';
					html += '<div class="narr-text">' + m2[2] + '</div>';
				} else {
					html += '<div class="narr-text">' + line + '</div>';
				}
			}
		}
		return html;
	}

	matrix.addEventListener('click', function(e) {
		var td = e.target.closest('td[data-narr]');
		if (!td) {
			if (e.target.closest('.narr-close')) { closeNarr(); }
			return;
		}
		var raw = td.getAttribute('data-narr');
		if (!raw) return;
		closeNarr();
		var tr = td.closest('tr');
		var colCount = tr.children.length;
		var narrTr = document.createElement('tr');
		narrTr.className = 'narr-row';
		var narrTd = document.createElement('td');
		narrTd.setAttribute('colspan', colCount);
		var narrDiv = document.createElement('div');
		narrDiv.className = 'narr-inline';
		narrDiv.innerHTML = buildHtml(raw, td);
		narrTd.appendChild(narrDiv);
		narrTr.appendChild(narrTd);
		tr.parentNode.insertBefore(narrTr, tr.nextSibling);
		narrDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	});

	document.addEventListener('keydown', function(e) {
		if (e.key === 'Escape') closeNarr();
	});
})();
</script>

</body>
</html>`;
}

/** Query the DB and generate dashboard HTML for the active (or most recent) round. */
export function generateDashboardFromDb(db: Database.Database): string {
	// Find active round, fall back to most recent
	let round = getActiveRound(db);
	if (!round) {
		const row = db
			.prepare("SELECT * FROM rounds ORDER BY id DESC LIMIT 1")
			.get() as Record<string, unknown> | undefined;
		if (row) {
			round = getRound(db, row.id as number);
		}
	}
	if (!round) {
		return generateDashboardHtml({
			round: { id: 0, phase: "none", deadline: null, submissionCount: 0 },
			standings: [],
			matchups: [],
			players: new Map(),
			bannedCards: [],
		});
	}

	const submissions = getSubmissionsForRound(db, round.id);
	const matchups = getMatchupsForRound(db, round.id);
	const standings = computeStandings(db, round.id);
	const bannedCards = getWinnerBans(db);

	const players = new Map<
		string,
		{ handle: string; cards: [string, string, string] }
	>();
	for (const sub of submissions) {
		const player = getPlayer(db, sub.playerDid);
		players.set(sub.playerDid, {
			handle: player?.handle ?? sub.playerDid.slice(0, 16),
			cards: [sub.card1Name, sub.card2Name, sub.card3Name],
		});
	}

	return generateDashboardHtml({
		round: {
			id: round.id,
			phase: round.phase,
			deadline: round.submissionDeadline,
			submissionCount: submissions.length,
		},
		standings,
		matchups,
		players,
		bannedCards,
	});
}

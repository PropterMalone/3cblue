# 3CBlue — Three Card Blind on Bluesky

Last verified: 2026-03-11

## GitHub
All `gh` CLI operations use the **PropterMalone** account. Run `gh auth switch --user PropterMalone` before any public-facing `gh` command.

## What Is This

MTG Three Card Blind played on Bluesky. Players DM 3-card decks to the bot. Matchups evaluated by Claude Code agents (per-deck, with crosscheck). Results posted as HTML dashboard + Bluesky threads. Community corrections tracked with full audit trail.

## Tech Stack
- TypeScript (strict), Node.js, Vitest, Biome
- Flat `src/` — no monorepo, no workspaces
- SQLite for persistence (rounds, players, submissions, matchups, corrections)
- Scryfall API for card data + card images
- Sharp for image compositing (matchup report images)
- propter-bsky-kit (PBK) for all Bluesky I/O — posting, DMs, facets, threading, feed server + FAQ
- Deploy: Docker on Malone

## Commands
- `npm run validate` — biome + typecheck + test
- `npm run build` — `tsc -b`
- `npm run test` — vitest
- `npm run dev` — `node --import tsx src/main.ts`

## Key Design Decisions

### Game Rules
- **Normal Magic rules** with one exception: you don't lose from drawing an empty library
- **3-card hand, no library** — each player starts with 3 cards in hand, no deck to draw from
- **All of Magic** is legal except structural bans (un-sets, ante, subgames, wishes/sideboard)
- **Best-play search** — both sides play optimally to maximize tournament points (3 win / 1 draw / 0 loss)
- **No turn cap** — games end at 0 life, poison, alt-win, or stalemate (no winning line exists for either side)
- **Worst-outcome convention** — coin flips, dice rolls resolve to worst outcome for controller
- **`?` results** — engine flags unresolvable interactions with board state context; designated judges resolve
- **Winner's cards banned** — all 3 cards from each round-winning deck are banned for future rounds

### Architecture
- **Agent-based resolution** — Claude Code agents evaluate matchups (one per deck, parallel). No direct Claude API calls from bot.
- **Per-direction scoring** — W=3, D=1, L=0 per direction. WW=6, WD=4, WL=3, DD=2, DL=1, LL=0.
- **Correction tracking** — `corrections` table with full audit trail (old/new outcome+narrative, requested_by, reason)
- **Per-direction verdicts** — `on_play_verdict` and `on_draw_verdict` columns on matchups
- **HTML dashboard** — Primary results UI, Scryfall autocards, posted as link to Bluesky
- **DM-only bot** — Handles deck submissions + judge commands. All posting done manually via scripts.
- **Historical matchup DB** — 10,438 deck pairs from Metashape, short-circuits known matchups

### Round Flow
1. Signup (mention bot)
2. Submission (24h default — bot accepts DMs)
3. Reveal (decklists posted as Bluesky thread)
4. Resolution (`/resolve-round` skill — parallel agents + crosscheck)
5. Community corrections (players flag errors, corrections tracked in DB)
6. Dashboard + standings posted

## Scoring
- Per-direction: W=3, D=1, L=0
- Combined: WW=6, WD=4, WL=3, DD=2, DL=1, LL=0
- Round-robin: every player's deck plays every other player's deck

## Project Structure
```
src/                        — All source (flat, no monorepo)
  card-types.ts             — Card, Ability, keyword types
  scryfall-types.ts         — Scryfall API response types
  scryfall-to-card.ts       — Scryfall → Card converter
  oracle-parser.ts          — Oracle text → structured abilities
  ban-list.ts               — Structural format bans
  scryfall-client.ts        — Scryfall API card lookup with rate limiting + cache
  database.ts               — SQLite persistence (rounds, players, submissions, matchups, corrections, judges)
  deck-validation.ts        — Card lookup + ban check + duplicate check
  matchup-evaluator.ts      — Claude API matchup evaluation + verdict parsing (fallback)
  matchup-image.ts          — Sharp-based image compositing (deck images + narrative cards)
  matchup-narrative.ts      — Structured narrative JSON (on-play/on-draw verdicts + play-by-play)
  matchup-lookup.ts         — Historical matchup DB lookup (order-independent by sorted card names)
  round-resolution-prompts.ts — Per-deck agent prompt building, verdict parsing, crosscheck logic
  round-lifecycle.ts        — Round state machine (signup → resolution → judging → complete)
  dashboard-html.ts         — HTML dashboard generator (phase-gated visibility)
  post-formatter.ts         — Bluesky post text formatting (reveals, results, standings)
  bluesky-bot.ts            — ATProto bot (DM handling, judge commands — no posting)
  main.ts                   — CLI entry point (start round, add judge, run bot, dashboard)
  feed/                     — Feed server + FAQ page

src/scripts/                — Utility scripts (excluded from build)
  dump-decks.ts             — Dump decklists from DB
  dump-round-json.ts        — Export round data as JSON
  scrape-metashape.ts       — Re-scrape Metashape historical data
  setup-test-round.ts       — Create test round with sample data
  evaluate-historical.ts    — Legacy: evaluate using old rules engine

legacy/game-engine/         — Minimax game engine (unused since R1, kept for reference)
```

## Dashboard Hosting

**Served via GitHub Pages** at `https://proptermalone.github.io/3cblue/` from `docs/index.html`.

The dashboard is a **static HTML file committed to git**. It is NOT auto-generated — you must regenerate and push after any change to matchup data, corrections, or dashboard code.

### Regenerating the dashboard
```bash
# Generate for a specific round (e.g. R4):
set -a && source .env && set +a && npx tsx -e "
import Database from 'better-sqlite3';
import { generateDashboardHtml } from './src/dashboard-html.ts';
import { getMatchupsForRound, getSubmissionsForRound, getPlayer, getWinnerBans } from './src/database.ts';
import { computeStandings } from './src/round-lifecycle.ts';
import { writeFileSync } from 'fs';
const db = new Database('data/3cblue.db', { readonly: true });
const roundId = 4;  // <-- change this
const submissions = getSubmissionsForRound(db, roundId);
const matchups = getMatchupsForRound(db, roundId);
const standings = computeStandings(db, roundId);
const bannedCards = getWinnerBans(db);
const players = new Map();
for (const sub of submissions) {
  const player = getPlayer(db, sub.playerDid);
  players.set(sub.playerDid, { handle: player?.handle ?? sub.playerDid.slice(0, 16), cards: [sub.card1Name, sub.card2Name, sub.card3Name] });
}
writeFileSync('docs/index.html', generateDashboardHtml({
  round: { id: roundId, phase: 'complete', deadline: null, submissionCount: submissions.length },
  standings, matchups, players, bannedCards,
}));
"

# Then commit and push:
git add docs/index.html && git commit -m "fix: regenerate dashboard" && git push origin main
# GitHub Pages auto-deploys (usually <1 min)
```

### When to regenerate
- After applying corrections (`applyCorrection()` or `apply-updates`)
- After changing `dashboard-html.ts`
- After round completion (update roundId in script)

### How verdict data flows into the matrix
The dashboard reads matchup verdicts from **three sources** in priority order:
1. **Narrative JSON** (`matchups.narrative` column) — structured `{onPlayVerdict, onDrawVerdict, playNarrative, drawNarrative}`. Used in R2/R3.
2. **Verdict columns** (`matchups.on_play_verdict`, `matchups.on_draw_verdict`) — "W"/"L"/"D" from p0's perspective. Used in R4.
3. **Legacy outcome** (`matchups.outcome`) — single "player0_wins"/"player1_wins"/"draw". Fallback.

If the matrix shows single characters (W/L/D) instead of two-char results (WW/WL/etc), it means both (1) and (2) are missing for those matchups.

## Bot CLI
```bash
# Start the bot (polls for DMs)
BSKY_IDENTIFIER=3cblue.bsky.social BSKY_PASSWORD=... node dist/main.js

# Create a new round (24h deadline)
node dist/main.js start 24

# Check current round status
node dist/main.js status

# Generate HTML dashboard (prints to stdout — prefer the script above for docs/index.html)
node dist/main.js dashboard

# Add a judge
node dist/main.js add-judge did:plc:...
```

## DM Submission Flow
1. Player sends 3 card names (one per line) via DM to bot
2. Bot looks up each on Scryfall, validates, checks bans
3. **Illegal deck**: sends back specific errors ("card not found", "banned", "duplicate")
4. **Legal deck**: confirms with resolved names + warns about unresolved abilities

## Resolution Workflow (`/resolve-round` skill)
1. Load round data from DB
2. Check historical matchup DB for known outcomes
3. Deduplicate identical decks
4. Spawn per-deck Claude Code agents (parallel, 2 at a time)
5. Crosscheck agent verdicts (agreement/disagreement)
6. User resolves disagreements
7. Write results + corrections to DB

## Agent & Token Budget Rules
- **No blind bulk agents.** Group work, resolve obvious cases by hand, only send genuinely ambiguous matchups to agents.
- **Output cap awareness.** Claude Code agents hit a 32K output token ceiling. Split work if >20K tokens likely.
- **Scope each agent tightly.** One agent = one focused question.
- **Prefer main-context analysis** for reasoning work. Agents for parallelizing independent LLM evaluation.
- **Kill early.** If an agent is looping or producing filler, stop it.
- **Write results incrementally.** Agents write partial results to disk (JSON in `/tmp/`).
- **Fail gracefully.** If approaching limits, write state and return summary.

## Phase Status
- [x] Card foundation (types, Scryfall converter, Oracle parser, ban list)
- [x] Bot integration (Scryfall client, SQLite, deck validation, round lifecycle, DM bot)
- [x] Agent-based resolution (per-deck agents, crosscheck, dashboard)
- [x] Correction tracking + per-direction outcomes
- [ ] Deploy polish (Tailscale Funnel, feed generator)

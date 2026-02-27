# 3CBlue — Three Card Blind on Bluesky

Last verified: 2026-02-27

## What Is This

MTG Three Card Blind played on Bluesky. Players DM 3-card decks to the bot. Bot evaluates all pairwise matchups via Claude API (LLM reads oracle text + 3CB rules, determines optimal play). Unresolvable matchups go to designated judges. Everything posts publicly — working out lines is part of the fun.

## Tech Stack
- TypeScript (strict), Node.js, Vitest, Biome
- Monorepo: `packages/shared` (Functional Core), `packages/engine` (Imperative Shell), `packages/feed` (future)
- SQLite for persistence
- Scryfall API for card data + card images
- Sharp for image compositing (matchup report images)
- propter-bsky-kit (PBK) for all Bluesky I/O — posting, DMs, facets, threading, feed server + FAQ
- Deploy: Docker + Tailscale Funnel on Malone (future)

## Commands
- `npm run validate` — biome + typecheck + test
- `npm run build` — `tsc -b`
- `npm run test` — vitest

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
- **LLM matchup evaluation** — Claude API evaluates each matchup given oracle text + 3CB rules. Prompt covers both play/draw directions in one call. Default model: Sonnet, configurable via `ANTHROPIC_MODEL` env var.
- **Injectable evaluator** — `MatchupEvaluator` type allows mock evaluator in tests, Claude API in production
- **LLM reasoning stored** — `matchups.llm_reasoning` column preserves full reasoning chain for audit
- **Graceful degradation** — LLM failures or uncertain verdicts degrade to "unresolved" for judge fallback
- **Legacy rules engine** — `packages/shared` still has game simulation, oracle parser, minimax search (unused by bot, kept for reference)

### Round Flow
1. Signup (mention bot)
2. Submission (24h default, 48h option — judge sets per round)
3. Reveal (all hands posted publicly)
4. Resolution (all pairwise matchups simulated + posted)
5. Judge phase (`?` matchups resolved by designated judge replies)
6. Leaderboard (final standings)

## Scoring
- 3 points for a win, 1 for a draw, 0 for a loss
- Round-robin: every player's deck plays every other player's deck

## Project Structure
```
packages/
  shared/src/           — Functional Core (pure functions, no I/O)
    card-types.ts       — Card, Ability, keyword types
    scryfall-types.ts   — Scryfall API response types
    scryfall-to-card.ts — Scryfall → Card converter
    oracle-parser.ts    — Oracle text → structured abilities
    ban-list.ts         — Structural format bans
    game-state.ts       — Immutable game state, hashing, keyword helpers
    combat.ts           — Combat damage resolution (all keywords)
    game-actions.ts     — Action types, state transitions, game over checks
    search.ts           — Minimax search + alpha-beta + transposition table
    index.ts            — Public API barrel export

  engine/src/           — Imperative Shell (I/O, orchestration)
    scryfall-client.ts  — Scryfall API card lookup with rate limiting + cache
    database.ts         — SQLite persistence (rounds, players, submissions, matchups, judges)
    deck-validation.ts  — Card lookup + ban check + duplicate check
    matchup-evaluator.ts — Claude API matchup evaluation + verdict parsing (fallback)
    matchup-image.ts    — Sharp-based image compositing (deck images + narrative cards)
    matchup-narrative.ts — Structured narrative JSON (on-play/on-draw verdicts + play-by-play)
    round-resolution-prompts.ts — Per-deck agent prompt building, verdict parsing, crosscheck logic
    round-lifecycle.ts  — Round state machine (signup → resolution → judging → complete)
    post-formatter.ts   — Bluesky post text formatting (reveals, results, standings, leaderboard)
    bluesky-bot.ts      — ATProto bot (DM handling, post threading, judge commands)
    main.ts             — CLI entry point (start round, add judge, run bot)
    index.ts            — Public API barrel export
```

## Bot CLI
```bash
# Start the bot (polls for DMs)
BSKY_IDENTIFIER=3cblue.bsky.social BSKY_PASSWORD=... node dist/main.js

# Create a new round (24h deadline) — posts announcement to Bluesky
node dist/main.js start 24

# Check current round status
node dist/main.js status

# Post results + leaderboard (after /resolve-round)
node dist/main.js post-results

# Add a judge
node dist/main.js add-judge did:plc:...
```

## DM Submission Flow
1. Player sends 3 card names (one per line) via DM to bot
2. Bot looks up each on Scryfall, validates, checks bans
3. **Illegal deck**: sends back specific errors ("card not found", "banned", "duplicate")
4. **Legal deck**: confirms with resolved names + warns about unresolved abilities

## Phase Status
- [x] Phase 1: Card foundation (types, Scryfall converter, Oracle parser, ban list) — 38 tests
- [x] Phase 2: Combat engine (game state, minimax search, keyword interactions, scoring) — 35 tests
- [x] Phase 3: Bot integration (Scryfall client, SQLite, deck validation, round lifecycle, Bluesky bot, post formatting, LLM matchup evaluation) — 115 tests
- [ ] Phase 4: Deploy + polish (Docker, Tailscale Funnel, feed generator)

# 3CBlue — Three Card Blind on Bluesky

Last verified: 2026-02-26

## What Is This

MTG Three Card Blind played on Bluesky. Players DM 3-card decks to the bot. Bot simulates all pairwise matchups with a best-effort rules engine. Unresolvable interactions emit `?` markers with board state context for designated judges to resolve. Everything posts publicly — working out lines is part of the fun.

## Tech Stack
- TypeScript (strict), Node.js, Vitest, Biome
- Monorepo: `packages/shared` (Functional Core), `packages/engine` (Imperative Shell), `packages/feed` (future)
- SQLite for persistence
- Scryfall API for card data
- Deploy: Docker + Tailscale Funnel on Malone (future)

## Commands
- `npm run validate` — biome + typecheck + test
- `npm run build` — `tsc -b`
- `npm run test` — vitest

## Key Design Decisions

### Game Rules
- **All of Magic** is legal except structural bans (un-sets, ante, subgames, wishes/sideboard, pure lands)
- **Unlimited mana** — 3CB convention, you always have mana to cast your cards
- **Best-play search** — both sides play optimally to maximize tournament points (3 win / 1 draw / 0 loss)
- **No turn cap** — games end at 0 life or stalemate (no forced-win line exists for either side)
- **Worst-outcome convention** — coin flips, dice rolls resolve to worst outcome for controller
- **`?` results** — engine flags unresolvable interactions with board state context; designated judges resolve

### Architecture
- **Oracle parser** — decomposes card text into structured abilities; emits `Unresolved` for anything it can't parse
- **Game tree search** — minimax to find optimal play for both sides. Objective: maximize tournament points, not just "win"
- **Engine coverage expands over time** — every `Unresolved` is a future improvement, never blocks gameplay

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
    round-lifecycle.ts  — Round state machine (signup → resolution → judging → complete)
    post-formatter.ts   — Bluesky post text formatting (reveals, results, standings)
    bluesky-bot.ts      — ATProto bot (DM handling, post threading, judge commands)
    main.ts             — CLI entry point (start round, add judge, run bot)
    index.ts            — Public API barrel export
```

## Bot CLI
```bash
# Start the bot (polls for DMs)
BSKY_IDENTIFIER=3cblue.bsky.social BSKY_PASSWORD=... node dist/main.js

# Create a new round (24h deadline)
node dist/main.js start 24

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
- [x] Phase 3: Bot integration (Scryfall client, SQLite, deck validation, round lifecycle, Bluesky bot, post formatting) — 18 tests
- [ ] Phase 4: Deploy + polish (Docker, Tailscale Funnel, feed generator, leaderboard)

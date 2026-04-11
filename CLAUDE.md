# 3CBlue — Three Card Blind on Bluesky

Last verified: 2026-03-28

## GitHub
All `gh` CLI operations use the **PropterMalone** account. Run `gh auth switch --user PropterMalone` before any public-facing `gh` command.

## What Is This

MTG Three Card Blind played on Bluesky. Players DM 3-card decks to the bot. Matchups evaluated by Claude Code agents (per-deck, with crosscheck). Results posted as HTML dashboard + Bluesky threads. Community corrections tracked with full audit trail.

## Tech Stack
- TypeScript (strict), Node.js, Vitest, Biome
- SQLite for persistence (rounds, players, submissions, matchups, corrections)
- Scryfall API for card data + Sharp for image compositing
- propter-bsky-kit (PBK) for all Bluesky I/O
- Deploy: Docker on Malone

## Commands
- `npm run validate` — biome + typecheck + test
- `npm run build` — `tsc -b`
- `npm run test` — vitest
- `npm run dev` — `node --import tsx src/main.ts`

## Key Rules

- **Normal Magic** with one exception: you don't lose from drawing an empty library
- **3-card hand, no library** — all of Magic is legal except structural bans (un-sets, ante, subgames, wishes)
- **Best-play search** — both sides play optimally (3 win / 1 draw / 0 loss)
- **Worst-outcome convention** — coin flips, dice rolls resolve to worst outcome for controller
- **`?` results** — engine flags unresolvable interactions; designated judges resolve
- **Winner's cards banned** for future rounds
- **Per-direction scoring** — W=3, D=1, L=0. Combined: WW=6, WD=4, WL=3, DD=2, DL=1, LL=0

## Architecture

- **Agent-based resolution** — Claude Code agents evaluate matchups (one per deck, parallel). No direct Claude API calls.
- **Correction tracking** — `corrections` table with full audit trail
- **Per-direction verdicts** — `on_play_verdict` and `on_draw_verdict` columns
- **DM-only bot** — Handles submissions + judge commands. Posting done manually via scripts.
- **Historical matchup DB** — 10,438 deck pairs from Metashape

### Round Flow
1. Signup (mention bot) → 2. Submission (DMs) → 3. Reveal (decklists thread) → 4. Resolution (`/resolve-round`) → 5. Corrections → 6. Dashboard + standings

## Dashboard

**Served via GitHub Pages** at `https://proptermalone.github.io/3cblue/` from `docs/index.html`.

Static HTML committed to git — must regenerate and push after corrections or round completion. See inline script in `docs/` or use `npm run dev` dashboard command.

**Verdict data priority:** (1) narrative JSON → (2) verdict columns → (3) legacy outcome. If matrix shows single W/L/D instead of WW/WL/etc, sources 1+2 are missing.

## Agent & Token Budget Rules
- No blind bulk agents. Group work, resolve obvious cases by hand.
- Output cap: 32K tokens. Split if >20K likely.
- One agent = one focused question. Kill early if looping.
- Write results incrementally to disk. Fail gracefully.

## Bot CLI
```bash
BSKY_IDENTIFIER=3cblue.bsky.social BSKY_PASSWORD=... node dist/main.js  # Start bot
node dist/main.js start 24   # New round (24h deadline)
node dist/main.js status     # Current round
node dist/main.js dashboard  # Generate HTML to stdout
```

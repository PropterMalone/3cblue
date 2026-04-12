# 3CBlue Output Specification

> Last updated: 2026-03-16. Current through Round 5 submission phase. Incorporates lessons from R3 (per-deck agents worked) and R4 (skipped agents, 56 corrections).

## 1. The Game

Three Card Blind (3CB) is a deckbuilding metagame format for Magic: The Gathering. Players submit secret 3-card decks. Every deck plays every other deck in a round-robin tournament. Both sides play optimally; there is no hidden information during gameplay, only during deck selection.

### Rules

- **3-card hand, no library.** Each player starts with all 3 cards in hand. There is no deck to draw from.
- **Normal Magic rules** with one exception: drawing from an empty library does NOT cause a loss.
- **Starting life total: 20.**
- **All of Magic is legal** except structural bans (un-sets, ante cards, subgames, wishes/sideboard cards) and winner bans from prior rounds. Card text uses **current Scryfall oracle text** (the latest errata/functional version).
- **Duplicates allowed.** A player may submit 3 copies of the same card.
- **Worst-outcome convention.** Coin flips, dice rolls, and random effects resolve to the worst outcome for the controller — meaning the resolution that minimizes the controller's probability of winning the current game. For effects that are random from an opponent's perspective (e.g., "target opponent discards a card at random"), the opponent is not the "controller" — the discard resolves worst for the player who cast the spell.
- **No turn cap.** Games end at 0 life, 10 poison counters (standard Magic threshold), alternate win condition, or stalemate.
- **Both players play optimally** to maximize their tournament points (3 for win, 1 for draw, 0 for loss). In practice, AI agents (Claude) serve as the evaluation oracle. Community corrections provide the appeal mechanism when the AI errs. There is no formal decision procedure for infinite game trees — agents use heuristic best-play reasoning, and contested results are escalated to human judges.

### Stalemate

A game is a **stalemate** (resulting in a Draw) when no winning line of play exists for either player. This includes:
- Neither player can cast any spell (e.g., all lands with no abilities)
- Both players can act but any action leads to their loss, so optimal play is to not act, resulting in an indefinite game
- The game reaches an infinite mandatory loop with no way to break it
- One player cannot win but can prevent the other from winning indefinitely (the defending player draws, not the attacker)

The key principle: if you cannot force a win with optimal play, you play to draw. If you cannot force a win or a draw, you lose.

### Per-Direction Evaluation

Each matchup is evaluated in two independent scenarios:
1. Player A goes first (on the play)
2. Player B goes first (on the draw)

Each direction produces an independent verdict: Win, Loss, or Draw. The combination creates a six-outcome vocabulary:

| Combined | Score | Meaning |
|----------|-------|---------|
| WW | 6 | Win both directions |
| WD | 4 | Win one, draw one |
| WL | 3 | Win one, lose one (split) |
| DD | 2 | Draw both directions |
| DL | 1 | Draw one, lose one |
| LL | 0 | Lose both directions |

A WL is explicitly NOT a draw — it is a split where each player wins when they go first.

### Scoring

Per direction: W=3, D=1, L=0. Standings are ranked by total points. Ties are not broken; co-champions are valid.

### Round Flow (Player Perspective)

1. **Announcement.** Bot posts on Bluesky with deadline.
2. **Submission.** Players DM the bot 3 card names (one per line). Bot validates and confirms. Players may resubmit before deadline; last submission counts.
3. **Reveal.** After deadline, all decklists are posted publicly as a Bluesky thread.
4. **Resolution.** AI agents evaluate all matchups. Complex cases go to human judges.
5. **Community corrections.** Players flag errors in results. Corrections tracked with full audit trail.
6. **Dashboard + standings posted.** HTML dashboard with interactive matchup matrix. Standings thread on Bluesky.

### Ban System (Player Perspective)

After each round, **all 3 cards from every co-champion's deck are banned** for all future rounds. Basic lands (Plains, Island, Swamp, Mountain, Forest, and their snow-covered variants, plus Wastes) are exempt from winner bans. Structural bans are permanent and always enforced.

Banned cards list is visible on the dashboard and FAQ page, with the round of origin for each card.

---

## 2. Bot Behavior

The bot (`@3cblue.bsky.social`) is a DM-only polling bot. It does NOT post to Bluesky — all posting is done via manual scripts. It polls for new DMs every 10 seconds (configurable via `POLL_INTERVAL_MS`).

### DM: Deck Submission

**Trigger:** Any DM that does not start with `judge `.

**Input parsing:** Text split by newlines, trimmed, blank lines and `//`-prefixed lines filtered out. Must produce exactly 3 entries.

**Validation pipeline (sequential):**
1. Line count check (must be exactly 3)
2. Scryfall exact-name lookup (sequential, 100ms rate limit between requests). If Scryfall returns a non-200 response or the card is not found, the error is reported to the player with the card name quoted. There is no automatic retry.
3. Structural ban check (un-set, ante, subgame, wish/sideboard)
4. Winner ban check (against `banned_cards` table)

**Response messages (exact templates):**

No active round:
```
no active round right now. wait for the next one!
```

Round not in submission phase:
```
round {N} is in {phase} phase — submissions are closed.
```

Wrong number of cards:
```
expected 3 card names (one per line), got {N}. example:

Lightning Bolt
Snapcaster Mage
Delver of Secrets
```

Validation failure (card not found, banned, etc.):
```
deck submission failed:

• "{card}": {error}
• "{card}": {error}

fix and resend.
```

Error strings per ban type (note: structural bans do not quote the card name, winner bans do — this is a code convention, not intentional):
- Card not found: `not found on Scryfall` (or similar from Scryfall API)
- Structural ban (name): `{Card} is banned (structural format break)`
- Structural ban (un-set): `{Card} is from an un-set ({set_type})`
- Structural ban (oracle text): `{Card}: references cards outside the game (wish effects)` or `{Card}: references sideboard (no sideboard in 3CB)`
- Winner ban: `"{Card}" is banned (won a previous round).`

Success:
```
✅ deck submitted for round {N}: {Card1}, {Card2}, {Card3}

you can resend to update your deck before the deadline.
```

**Behavior:** Submissions use UPSERT — resubmitting replaces the previous deck for that round. Player profile (handle, display name) is fetched from Bluesky API and upserted on each submission.

### DM: Judge Command (Legacy)

> **Note:** The judge DM command only supports three overall outcomes and cannot express per-direction splits (WL, WD, DL). It is retained for backward compatibility and emergency use. For per-direction corrections, use the JSONL update system (see Section 3, Corrections).

**Trigger:** Message starting with `judge ` (case-insensitive).

**Authorization:** Sender must be in the `judges` table. Non-judges get:
```
you're not a designated judge.
```

**Format:** `judge {matchup_id} {p0 wins|p1 wins|draw}` (case-insensitive).

**Invalid format response:**
```
format: judge <matchup_id> <p0 wins|p1 wins|draw>
```

**Matchup not found:**
```
matchup {id} not found.
```

**Success response:**
```
matchup {id} resolved as: {player0_wins|player1_wins|draw}
```

**Behavior:** Validates that the matchup ID exists before updating. Sets `judge_resolution` and `judged_by_did` on the matchup. The `p0`/`p1` abbreviations are expanded to `player0`/`player1`. Does NOT set `on_play_verdict` or `on_draw_verdict` — the `judge_resolution` column is read as a legacy fallback by the standings computation.

### Deadline Handling

The bot checks if the active round's deadline has passed on each poll cycle. When detected, it logs once:
```
[round] round {N} deadline passed — waiting for manual resolution
```

There is no automatic phase transition — resolution is triggered manually by the operator. The bot enforces the deadline: submissions received after the deadline are rejected with:
```
round {N} deadline has passed — submissions are closed.
```

---

## 3. Resolution Pipeline

Resolution is orchestrated by the `/resolve-round` Claude Code skill, not by the bot itself.

### Overview

After the submission deadline, resolution proceeds through three phases over roughly a week:

**Evaluate.** Every pair of decks needs a verdict for both play directions. First, known matchups are pulled from a historical database (10K+ pairs from prior leagues) to skip redundant work. Identical decks are deduplicated. Then a Claude Code agent is spawned per unique deck, each evaluating all its matchups from one side. Two agents see every matchup from opposite perspectives — when they disagree, the operator reviews both analyses and decides. Results are written to the DB with per-direction verdicts, narratives, and full reasoning for audit.

**Community review.** A preliminary dashboard goes up on GitHub Pages and standings are posted to Bluesky. Players examine the matchup matrix, click into narratives, and flag errors ("Karakas can't bounce tokens", "you missed the LED crack-in-response line"). Corrections are tracked with provenance (Bluesky post URIs) and applied in batches. The dashboard is regenerated after each batch. This phase typically lasts several days.

**Finalize.** Once the correction window closes, the round advances to `complete`. The co-champions' cards are automatically banned for future rounds. Final standings are posted.

### Step 1: Load Round Data

Read all submissions from DB. Display summary: round ID, phase, submission count.

If the round is not in `submission` phase, warn the operator but allow them to proceed (they may be re-evaluating).

### Step 2: Pre-processing

**Historical lookup.** For every pair of decks, check the Metashape database (10,438 historical deck pairs from 106 rounds). Lookup is order-independent: card names are lowercased, sorted, and joined with `|`. A match returns a score (0-6) that maps to an outcome.

The score is the total tournament points from the lex-smaller deck's perspective. When the lex-smaller deck is not player 0 in the current matchup, the score is inverted (`6 - score`) to get player 0's perspective.

Score-to-combined mapping:

| Score | Combined | Meaning |
|-------|----------|---------|
| 6 | WW | Win both directions (3+3) |
| 4 | WD | Win one, draw one (3+1) |
| 3 | WL | Split — win one, lose one (3+0) |
| 2 | DD | Draw both (1+1) |
| 1 | DL | Draw one, lose one (1+0) |
| 0 | LL | Lose both (0+0) |

> **Note:** Score 5 does not correspond to any valid combined result under W=3/D=1/L=0 scoring. It does not appear in the Metashape dataset. If encountered, it would be mapped to "draw" by the conservative fallback.

> **Known limitation:** The current code maps scores 1-5 all to `"draw"` as a conservative simplification, losing per-direction granularity. This means historical WL splits (score 3) are stored as `outcome: "draw"` without `on_play_verdict`/`on_draw_verdict` columns populated. The dashboard falls back to single-character display for these matchups. This is acceptable because historical matchups are relatively rare in current rounds and the narrative text still describes the actual play pattern.

Historical matches skip verdict evaluation but still get a narrative-only LLM call.

> **Diminishing returns:** As the winner ban list grows, the meta shifts away from previously-seen decks. R4 found 0 historical matches out of 325 pairs. The lookup is cheap and worth keeping, but should not be relied on as a significant optimization.

**Deduplication.** Decks with identical cards (by `canonicalDeckKey`: sorted lowercase card names joined with `|`) are evaluated only once. Mirror matches between duplicate decks are always DD (draw both directions) — stored with `outcome: "draw"`, `on_play_verdict: "D"`, `on_draw_verdict: "D"`.

**Deck plans.** A single Opus call generates a 2-3 sentence game plan for each unique deck: what it's trying to do, how it wins, key interactions, and vulnerabilities. All decks are included in one prompt so the model can note cross-deck interactions (e.g., "3 opponents have Wasteland, which shuts down this deck's land-based combo"). Output is written to `/tmp/r{N}-deck-plans.json` (keyed by handle) and injected into each per-deck agent's prompt alongside the card data.

This step prevents the most expensive class of agent error: misunderstanding what a deck does. R4's Shelldock Isle misread (dismissed as "does nothing" when it actually combos with LED) and the Howlpack Alpha timing errors both stemmed from agents independently re-deriving deck strategy from raw oracle text. A single high-quality plan from a stronger model is cheaper than correcting downstream mistakes across dozens of matchups.

### Step 3: Per-Deck Agent Evaluation

One Claude Code agent per unique deck, launched 2 at a time. Each agent evaluates all of that deck's matchups from Player 0's perspective. Agents that have no matchups needing LLM evaluation (all historical) are skipped entirely.

> **Historical note:** R3 used per-deck agents with crosscheck as specified. R4 bypassed agents entirely, using main-context batch evaluation with no crosscheck — this resulted in 56 post-resolution corrections. The crosscheck step has demonstrated value and MUST be followed for R5+. If context pressure makes agents impractical, at minimum evaluate each matchup from both sides and flag disagreements.

**Agent prompt structure:**
- 3CB rules block (see `THREE_CB_RULES` in `round-resolution-prompts.ts`)
- Deck under evaluation: card name, mana cost, type line, P/T, oracle text, **deck plan** (from Step 2)
- All opponent decks in the same format, each with their deck plan
- Instructions to evaluate each direction independently
- Required output format with `VERDICT:` and `NARRATIVE:` lines

**Required output format per opponent:**
```
### vs @{handle}

#### On the Play
[analysis]
VERDICT: P0_WINS | P1_WINS | DRAW
NARRATIVE: [1-2 sentences, under 200 chars]

#### On the Draw
[analysis]
VERDICT: P0_WINS | P1_WINS | DRAW
NARRATIVE: [1-2 sentences, under 200 chars]

#### Overall
VERDICT: P0_WINS | P1_WINS | DRAW
```

**Verdict parsing:** The output is split into per-opponent sections by `### vs @{handle}` headers. Within each section, subsections are extracted by `#### {heading}` headers (`On the Play`, `On the Draw`, `Overall`). Within each subsection, the regex `VERDICT:\s*(P0_WINS|P1_WINS|DRAW)\s*$` (multiline flag) extracts verdicts, taking the LAST match in the subsection. Maps `P0_WINS` to `player0_wins`, etc.

**Narrative parsing:** Within each direction subsection, regex `NARRATIVE:\s*(.+)`, trimmed.

**Narrative-only prompt** (for historical matchups with known outcomes): States the known overall outcome, asks only for play-by-play text per direction, no verdict evaluation. Does NOT produce per-direction verdicts — these come from the historical score.

### Step 4: Crosscheck

For each pair (A, B):
- Agent A evaluated A-vs-B (A is P0)
- Agent B evaluated B-vs-A (B is P0)
- **Agreement:** A's **overall** verdict, when flipped (`player0_wins` swaps with `player1_wins`, draw stays), matches B's overall verdict.
- **Disagreement:** Overall verdicts differ. Presented to operator with both agents' full reasoning for manual resolution.

> **Note:** Crosscheck compares only the overall verdict. Per-direction disagreements where agents agree on the overall result are NOT flagged. On agreement, Agent A's per-direction verdicts are always used as canonical (A is P0 in the stored matchup).
>
> **Narrative selection with perspective flip:** The winner's narratives are preferred. When Agent A's overall verdict is `player0_wins` (A wins), Agent A's narratives are used directly. When the verdict is `player1_wins` (B wins), Agent B's narratives are used — but with play/draw swapped: Agent B's `playNarrative` (B goes first) becomes the stored `drawNarrative` (because in the canonical A-is-P0 matchup, B going first means A is on the draw), and Agent B's `drawNarrative` becomes the stored `playNarrative`. For draws, Agent A's narratives are used.

### Step 5: Write to DB

Matchup rows are created during resolution (not pre-created). Each matchup is written with:
- `outcome`: overall verdict string (`player0_wins`, `player1_wins`, or `draw`). For corrections applied via the JSONL update system, this column may contain combined codes like `WL`, `WD`, etc. — these are not read by standings computation, which uses per-direction columns instead.
- `llm_reasoning`: combined raw output from both agents (`=== Agent for {did} ===\n{output}`)
- `narrative`: JSON string with structure `{onPlayVerdict, onDrawVerdict, playNarrative, drawNarrative}` where verdicts are full strings (`"player0_wins"`, `"player1_wins"`, `"draw"`) from p0's perspective, and narratives are 1-2 sentence play-by-play strings.
- `on_play_verdict`, `on_draw_verdict`: single-char `W`/`L`/`D` from p0's perspective
- `stats_json`: always `"{}"` — vestigial from the retired minimax game engine, retained for schema compatibility

**Error recovery:** If resolution crashes mid-write (some matchups written, some not), delete all matchups for the round and re-run:
```sql
DELETE FROM matchups WHERE round_id = ?;
```
The `resolveRound()` guard checks for existing matchups, so they must be removed before retrying. Correction records referencing deleted matchup IDs will have dangling FK references but are harmless (corrections for a failed run are irrelevant).

**Post-write validation:** After writing all matchups, verify that verdict fields are consistent with the analysis text. This catches template-default bugs where analysis says one thing but verdict fields were left unchanged from defaults. (Known failure mode: 13 entries in R4 had correct notes but stale outcome fields from copy-paste.)

After writing, the round phase advances to `resolution` (NOT `complete` yet).

### Step 6: Community Review

Post a preliminary dashboard to GitHub Pages for community review. Players examine matchups and flag errors in Bluesky threads or DMs.

The community review window is typically several days. During this period:
- Corrections are collected from player feedback (Bluesky post URIs tracked as provenance)
- Corrections are applied via JSONL update files or ad-hoc correction scripts
- Dashboard is regenerated after each batch of corrections
- Round remains in `resolution` phase

### Step 7: Finalize

When the correction window closes and the operator is satisfied:
1. Apply any remaining pending corrections
2. Regenerate the dashboard one final time
3. Advance round phase to `complete`
4. Winner bans are applied automatically by `finalizeRound()`
5. Post final standings to Bluesky

### Corrections

**Correction conflict resolution:** When players disagree about a matchup result, the operator (proptermalone) makes the final call. The standard is: "what would happen under optimal play given current Oracle text?" Players are expected to provide reasoning with card interactions cited. The operator may consult external sources (MTG rules, Scryfall rulings) but the operator's judgment is final. Corrections are tracked with provenance (Bluesky post URI or conversation date) so the reasoning chain is auditable.

Corrections can be applied through three mechanisms. In practice, R3 and R4 corrections were applied via ad-hoc scripts calling `applyCorrection()` directly. The JSONL system was built for R4+ but has not yet been used operationally.

#### 1. JSONL Update System (Preferred for R5+)

Each round has `data/round-updates/r{N}-updates.jsonl`. Each line is a JSON object:

```json
{
  "matchup": ["alice.bsky.social", "bob.bsky.social"],
  "play": "W",
  "draw": "D",
  "source": {"type": "bsky", "uri": "at://did:plc:abc/app.bsky.feed.post/xyz"},
  "reason": "Karakas bounces before combat",
  "status": "pending"
}
```

Source types: `bsky` (with URI) or `conversation` (with date and context). Verdicts are single-char `W`/`L`/`D` from `matchup[0]`'s perspective. When the DB stores the pair in reverse order (player0 is `matchup[1]`), verdicts are automatically flipped (`W`↔`L`, `D` stays).

The `matchup` field can use handles OR raw DIDs (`did:plc:...`). DIDs are preferred for stability — Bluesky handles can change between rounds. The apply function resolves handles via the `players` table, trying: exact match, `.bsky.social` suffix, and direct DID passthrough.

Apply is **idempotent**: already-applied entries are skipped. No-op changes (verdicts already match) are marked applied without creating a correction record. Supports `--dry-run`. The apply function updates both `on_play_verdict`/`on_draw_verdict` columns AND creates a `corrections` audit trail record.

#### 2. Database Correction API (Internal)

`applyCorrection()` is the transactional primitive. Records old/new outcome and narrative in `corrections` table, updates `on_play_verdict`/`on_draw_verdict` columns when provided, increments `correction_count`, checkpoints WAL after. Used by the JSONL apply system internally.

#### 3. Judge DM Command (Legacy)

Sets `judge_resolution` on the matchup, which overrides `outcome` in standings computation. Does not set per-direction verdicts. See Section 2.

---

## 4. Dashboard

Static HTML file served via GitHub Pages at `https://proptermalone.github.io/3cblue/` from `docs/index.html`. Dark theme (background `#0d1117`, text `#e6edf3`).

### Phase Gating

| Phase | Shows |
|-------|-------|
| submission | Player count, deadline, banned cards list. Message: "Decklists will be revealed after the submission deadline." |
| resolution | All of the above + standings table + matchup matrix (populates as results arrive) |
| judging | Same as resolution |
| complete | Full dashboard: standings, matrix, banned cards |

### Header Info Boxes

Three boxes in a flex row: Phase (with color-coded badge), Players (count), Matchups (count, hidden during submission).

Phase badge colors:
- submission: green text on dark green background
- resolution: yellow text on dark yellow-brown background
- judging: red text on dark red background
- complete: blue text on dark blue background

### Standings Table

Columns: Rank (#), Player (@handle), Points (gold color), W, D, L, Deck (comma-separated card names, hidden on mobile via `display: none`, max-width 300px, dim gray color). Sorted by points descending.

Standings computation reads per-direction verdicts in priority order:
1. `on_play_verdict`/`on_draw_verdict` columns (R4+ format)
2. Narrative JSON `onPlayVerdict`/`onDrawVerdict` (R2-R3 format, values are full strings like `"player0_wins"`)
3. Legacy fallback: `judge_resolution ?? outcome` applied to BOTH directions (doubling the result — a `player0_wins` fallback scores as WW)

### Matchup Matrix

NxN grid. Row and column headers are player handles (truncated to 7 chars + ellipsis if over 8). Column headers are rotated vertically (`writing-mode: vertical-lr`). Row headers sticky-left, column headers sticky-top.

**Cell content:** Two-character result code (WW, WL, WD, DD, DL, LL) or single-char fallback (W, L, D) for legacy data, or `?` for unresolved, or `—` for self.

**Cell colors (CSS classes):**
- `res-w` (WW or W): green background `#1a3a2a`, green text `#3fb950`
- `res-l` (LL or L): red background `#3a1a1a`, red text `#f85149`
- `res-d` (DD or D): yellow-brown background `#3a2a1a`, yellow text `#d29922`
- `res-wd` (WD): green background, lighter green text `#7ad88e`
- `res-wl` (WL): olive background `#2a2a1a`, yellow text, bold
- `res-dl` (DL): brown-red background `#3a221a`, orange text `#d2793a`
- `res-q` (?): purple background `#2a1a3a`, purple text `#b87aff`

Single-character results (W, L, D) use the same CSS classes as their double counterparts (WW, LL, DD). The `resultClass()` function handles both.

**Results always show from the row player's perspective.** The display is sorted so W comes before D comes before L (WL never LW, WD never DW, DL never LD).

**Verdict data priority** (same as standings, with display-specific behavior):
1. Narrative JSON column (structured `{onPlayVerdict, onDrawVerdict, playNarrative, drawNarrative}`) — produces two-char display + rich narrative tooltip
2. Per-direction verdict columns (`on_play_verdict`, `on_draw_verdict` as W/L/D from p0's perspective) — produces two-char display + unsplit reasoning tooltip from `llm_reasoning`
3. Legacy single outcome (`player0_wins`/`player1_wins`/`draw`) — produces single-char display (W/L/D)

### Interactive Narratives

Clicking a matrix cell expands an **inline narrative row** below the current row. The `title` attribute is moved to `data-narr` on page load to suppress native tooltips on touch devices.

The expanded narrative contains:
- **Close button** (X, top right, larger on mobile)
- **Card images** for both decks (fetched live from Scryfall: `https://api.scryfall.com/cards/named?exact={name}&format=image&version=normal`). Images are 146px wide (100px on mobile), displayed in two flex columns labeled with player handles (`.bsky.social` suffix stripped for display).
- **Per-direction narrative labels** (e.g., "alice on play (alice wins):") styled as uppercase blue accent headers.
- **Narrative text** in standard body color.

Close triggers: click X button, press Escape, click anywhere outside the narrative.

**Mobile responsive (`max-width: 600px`):**
- Matrix cells get larger padding (0.5rem) and min-width (2.5rem) for tap targets
- Card images shrink to 100px
- Close button enlarges (1.6rem, more padding)
- Deck column in standings hidden
- Banned cards list switches from 2-column to 1-column

### Banned Cards Display

An `<ul>` list with `<li>` items. Each item shows the card name followed by the round of origin in parenthetical dim text: `Card Name (R{N})`. Two-column layout on desktop, single-column on mobile. If no cards are banned, shows "None yet" in italics.

### Footer

Links to FAQ & Rules page.

---

## 5. Bluesky Posts

All posting is done via manual scripts, not the bot. Posts must fit within Bluesky's **300-grapheme limit** (graphemes, not characters — Unicode normalization means some characters count as multiple graphemes).

### Announcement Post

```
📣 3CB Round {N} is open!

DM me your 3-card deck (one card per line) by {deadline}.

All of Magic is legal. Best-play search, both directions. Unresolvable matchups go to judges.
```

Deadline formatted as: `Wed, Mar 1, 6:00 PM ET` (locale en-US, with weekday, month, day, hour, minute, timezone). Uses US Eastern time, following daylight saving transitions (EST in winter, EDT in summer).

### Reveal Thread

Header: `🎴 Round {N} — Reveal!\n\n`

Each line: `@{handle}: {Card1}, {Card2}, {Card3}`

Auto-split into multiple posts at the 300-grapheme boundary, splitting only between player lines (never mid-line). Each continuation post starts with the next player line (no repeated header). If a single player line exceeds 300 graphemes (extremely unlikely but theoretically possible with very long card names), it would need to be handled manually.

### Results Thread

Header: `⚔️ Round {N} — Results\n\n`

Each line: `@{handle0} vs @{handle1}: {outcome}`

Outcomes: `P0 wins`, `P1 wins`, `Draw`, `P0 wins (judged)`, `❓ (needs judge)`.

### Standings Post

```
🏆 Round {N} — Standings

1. @{handle} — {pts}pts ({W}W-{L}L-{D}D)
2. @{handle} — {pts}pts ({W}W-{L}L-{D}D)
...
```

Unresolved matchups shown as `({N}?)` suffix.

### Leaderboard Posts

Header: `📊 Leaderboard — {N} round{s}\n\n`

Each line: `{rank}. @{handle} — {pts}pts ({W}W-{L}L-{D}D, {N}r)`

Auto-split across posts (line-level splitting, same rules as reveal thread).

### Mention Blasts

Participants are tagged when posting decklists and preliminary standings. Bluesky's 300-grapheme limit means mentions are split into posts of approximately 10 handles each.

---

## 6. Data Artifacts

### SQLite Database (`data/3cblue.db`)

WAL journal mode, foreign keys enabled.

**`rounds`**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| phase | TEXT | `submission`, `resolution`, `judging`, `complete` |
| created_at | TEXT | ISO datetime |
| submission_deadline | TEXT | ISO datetime, nullable |
| post_uri | TEXT | Announcement post URI, nullable |

**`players`**
| Column | Type | Notes |
|--------|------|-------|
| did | TEXT PK | Bluesky DID |
| handle | TEXT | Bluesky handle |
| display_name | TEXT | nullable |
| created_at | TEXT | |

**`submissions`**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| round_id | INTEGER FK | |
| player_did | TEXT FK | |
| card1_name, card2_name, card3_name | TEXT | Resolved card names |
| card1_json, card2_json, card3_json | TEXT | Full serialized Card objects |
| submitted_at | TEXT | |
| UNIQUE(round_id, player_did) | | Enables UPSERT |

**`matchups`**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| round_id | INTEGER FK | |
| player0_did, player1_did | TEXT FK | No UNIQUE constraint — ordering is determined by insertion order during resolution (first submission is p0) |
| outcome | TEXT | Legacy: `player0_wins`, `player1_wins`, `draw`, `unresolved`. Post-correction: may contain combined codes like `WL`, `WD` from the JSONL update system. Not used for standings computation when per-direction columns are populated. |
| unresolved_reason | TEXT | nullable; why it needs judging |
| judge_resolution | TEXT | nullable; `player0_wins`/`player1_wins`/`draw` — overrides outcome in legacy fallback path |
| judged_by_did | TEXT FK | nullable |
| stats_json | TEXT | Always `"{}"` — vestigial from retired minimax engine |
| llm_reasoning | TEXT | Full agent output for audit |
| narrative | TEXT | JSON: `{onPlayVerdict, onDrawVerdict, playNarrative, drawNarrative}` — verdicts are full strings (`"player0_wins"` etc.) from p0's perspective |
| post_uri | TEXT | nullable |
| on_play_verdict | TEXT | `W`/`L`/`D` from p0's perspective (added R4) |
| on_draw_verdict | TEXT | `W`/`L`/`D` from p0's perspective (added R4) |
| correction_count | INTEGER DEFAULT 0 | |

**`judges`**
| Column | Type |
|--------|------|
| did | TEXT PK FK |
| added_at | TEXT |

**`banned_cards`**
| Column | Type | Notes |
|--------|------|-------|
| card_name | TEXT PK | |
| banned_from_round | INTEGER FK | |
| banned_at | TEXT | |

**`bot_state`**
| Column | Type | Notes |
|--------|------|-------|
| key | TEXT PK | e.g., `dm_cursor` |
| value | TEXT | |

**`corrections`**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTOINCREMENT | |
| matchup_id | INTEGER FK | |
| old_outcome, new_outcome | TEXT | |
| old_narrative, new_narrative | TEXT | nullable |
| requested_by | TEXT | nullable; overloaded format — either a Bluesky AT URI (`at://did:plc:abc/...`) or `conversation:{date}`. Distinguish by checking for `at://` prefix. |
| reason | TEXT | nullable |
| applied_at | TEXT | |

### JSONL Update Files (`data/round-updates/r{N}-updates.jsonl`)

One line per correction entry. Each line is JSON with fields: `matchup` (pair of handles), `play` (W/L/D), `draw` (W/L/D), `source` (type + uri/date/context), `reason`, `status` (pending/applied), `appliedAt` (ISO timestamp, set when applied).

### Historical Matchup Database (`data/metashape-matchups.json`)

Structure:
```json
{
  "matchups": {
    "card a|card b|card c vs card d|card e|card f": {
      "score": 6,
      "sources": ["R1A", "R45B"]
    }
  },
  "totalMatchups": 10438,
  "totalRounds": 106,
  "scrapedAt": "..."
}
```

Keys: sorted lowercase card names joined by `|`, pairs joined by ` vs `, lexicographically smaller deck first. Score 0-6 from the lex-smaller deck's perspective (total tournament points: WW=6, WD=4 or 5, WL=3, DD=2, DL=1, LL=0).

---

## 7. Operational Assets

### Bot Process

Docker container running `node dist/main.js` (default command = start bot). Built as two-stage: Node 22 slim build + runtime. The `data/` directory is mounted as a volume for DB persistence.

**Docker Compose:**
```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/data
    environment:
      - DB_PATH=/data/3cblue.db
```

**Required environment variables:** `BSKY_IDENTIFIER`, `BSKY_PASSWORD`. Optional: `BSKY_SERVICE` (default `https://bsky.social`), `DB_PATH` (default `./3cblue.db`), `POLL_INTERVAL_MS` (default `10000`), `ANTHROPIC_MODEL` (used by the legacy `matchup-evaluator.ts` — not used in production resolution).

### Legacy Code

Two files are retained but NOT used in production resolution:
- **`matchup-evaluator.ts`** — Direct Claude API evaluator from R1. Produces single-direction verdicts only (no per-direction on_play/on_draw). The `evaluateMatchup()` function should not be called for real resolution. The `parseVerdict()` and `formatDeckForPrompt()` utilities are still useful.
- **`resolveRound()` in `round-lifecycle.ts`** — Automatic resolution function from R1 that calls `matchup-evaluator.ts`. Does not perform dedup, historical lookup, crosscheck, or per-direction evaluation. Retained for integration tests.

The bot must be rebuilt between rounds due to SQLite WAL stale reads across round transitions.

### CLI Commands

```
node dist/main.js                    # Start bot (default)
node dist/main.js start [hours]      # Create new round (default 24h deadline)
node dist/main.js status             # Show active round status
node dist/main.js dashboard          # Print dashboard HTML to stdout
node dist/main.js add-judge <did>    # Add a judge by DID
node dist/main.js apply-updates <N> [--dry-run]  # Apply JSONL corrections for round N
```

**Status output format:**
```
[cli] round {N}
  phase: {phase}
  deadline: {ISO datetime}
  submissions: {count}
  matchups: {count}
  unresolved: {count}          (only if > 0)
```

### Feed Server

Separate process serving the Bluesky feed algorithm and FAQ page. Listens on configurable port (default 3007). The feed surfaces all posts from the `@3cblue.bsky.social` account. Feed registration and `did`/`rkey` details are out of scope for this spec — see `src/feed/` for implementation.

### FAQ Page

Static HTML served by the feed server. Dark-themed, matching dashboard styling. Contains:
- Quick start instructions (follow bot, DM 3 card names)
- How scoring works (per-direction table)
- Full rules
- Strategy tips (lands count as cards, no library means draw/tutor is dead, worst-outcome convention)
- FAQ (split cards, DFCs, resubmission, evaluation method)
- Structural ban list with specific card names
- Winner ban list with round of origin

---

## 8. Ban System

### Structural Bans (Permanent)

**By set type:** `funny` (un-sets). This is checked via Scryfall's `set_type` field.

**By name (hardcoded list):** Shahrazad, Contract from Below, Darkpact, Demonic Attorney, Jeweled Bird, Rebirth, Tempest Efreet, Timmerian Fiends, Bronze Tablet, Amulet of Quoz.

> **Note:** These 10 cards are the historical ante/subgame cards from early Magic. New ante or subgame cards are unlikely to be printed, but if they were, they would need to be added to this list manually. The category descriptions ("ante cards", "subgame cards") in Section 1 are for player-facing explanation; the code enforces the specific list above plus the oracle text patterns below.

**By oracle text pattern:**
- `/from outside the game/i` — "references cards outside the game (wish effects)"
- `/your sideboard/i` — "references sideboard (no sideboard in 3CB)"

### Winner Bans (Cumulative)

When a round is finalized:
1. Compute standings
2. Find all players tied for the top score
3. For each co-champion, ban all 3 cards from their deck
4. Basic lands (hardcoded set of 11 names: Plains, Island, Swamp, Mountain, Forest, Snow-Covered Plains, Snow-Covered Island, Snow-Covered Swamp, Snow-Covered Mountain, Snow-Covered Forest, and Wastes) are silently skipped

Winner bans are stored in `banned_cards` table with the round of origin. Checked during deck validation.

Error message when a player submits a winner-banned card:
```
"{Card Name}" is banned (won a previous round).
```

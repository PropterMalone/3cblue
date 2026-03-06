# Resolve Round

Evaluate all matchups for the current 3CB round using parallel agents with crosscheck. Uses historical matchup data to skip LLM evaluation where possible, and deduplicates identical decks.

## Step 1: Load Round Data

Read the DB to get the active round and all submissions. Run this script and capture the JSON output:

Write a temporary script `_resolve-load.ts` and run it with `npx tsx _resolve-load.ts`:

```ts
import { createDatabase, getActiveRound, getSubmissionsForRound, getPlayer } from "./packages/engine/src/database.ts";
const db = createDatabase("data/3cblue.db");
const round = getActiveRound(db);
if (round === undefined) { console.log(JSON.stringify({ error: "no active round" })); process.exit(0); }
const subs = getSubmissionsForRound(db, round.id);
const data = {
  roundId: round.id,
  phase: round.phase,
  submissions: subs.map((s: any) => {
    const player = getPlayer(db, s.playerDid);
    return {
      playerDid: s.playerDid,
      handle: player?.handle || s.playerDid,
      cards: [
        { name: s.card1Name, json: s.card1Json },
        { name: s.card2Name, json: s.card2Json },
        { name: s.card3Name, json: s.card3Json },
      ]
    };
  })
};
console.log(JSON.stringify(data, null, 2));
```

Delete the script after capturing the output.

If there's no active round or fewer than 2 submissions, stop and tell the user.

If the round is not in `submission` phase, warn the user but let them decide whether to proceed (they may want to re-evaluate).

## Step 2: Build Deck Info + Historical Lookup + Dedup

For each submission, parse the card JSON to get oracle text. Build a `DeckInfo` object for each player.

### 2a: Check Historical Matchup Database

Run the lookup for every pair:

Use the functions from `packages/engine/src/matchup-lookup.ts` (imported via `npx tsx`):

```ts
import { lookupMatchup, loadMatchupDb, getMatchupDbStats } from "./packages/engine/src/matchup-lookup.ts";
const matchupDb = loadMatchupDb();
const stats = getMatchupDbStats(matchupDb);
// For each pair (i, j):
// lookupMatchup(deck0Cards, deck1Cards, matchupDb)
// Returns { found: true, outcome, score, sources } or { found: false }
```

For each pair with a historical match:
- **Use the known outcome** — do NOT send it to the LLM for verdict evaluation
- **Still generate a narrative** — send a narrative-only prompt (much cheaper)
- Track these as "historical" matchups

### 2b: Deduplicate Identical Decks

Use `canonicalDeckKey()` from `round-resolution-prompts.ts` to identify duplicate decks (card names sorted, case-insensitive). If players A and B submitted the same deck:
- Only evaluate the deck once against each opponent
- Copy the results for the duplicate deck's matchups
- A-vs-B (mirror match) is always a draw

### Summary to show user before proceeding:
```
Round N: X submissions, Y unique decks
Historical matches found: Z (will skip LLM verdict)
Matchups needing LLM evaluation: W
```

## Step 3: Spawn Per-Deck Agents

Launch one Task agent per **unique** deck (not per player), **2 at a time** to avoid filling context with notifications. Use `subagent_type: "general-purpose"`, `model: "sonnet"`, `run_in_background: true`.

Each agent should write its output to `/tmp/r{N}-outputs/{handle_sanitized}.txt`. Tell agents: **"Write your complete output to the file. Return only the word DONE."** This minimizes notification size in the parent context.

Wait for both agents in a batch to complete before launching the next pair. After all agents finish, verify all output files exist.

**Context pressure warning**: Each agent notification consumes ~30-50 lines of parent context even with minimal returns. For rounds with >15 unique decks, warn the user:
```
⚠️ {N} unique decks = {N} agents. This will consume significant context.
Consider: run agents in this session, then start a fresh session for crosscheck.
All state is in /tmp/r{N}-* files.
```

**Important**: Only include opponents that need LLM evaluation (exclude matchups with historical results). If ALL of a deck's matchups have historical results, skip the agent entirely.

Each agent gets the prompt built by `buildDeckAgentPrompt()` from `round-resolution-prompts.ts`:

---

You are evaluating Three Card Blind (3CB) matchups for one deck against all opponents.

## 3CB Rules
- Each player has a 3-card hand and no library. Drawing from an empty library does NOT cause a loss.
- Normal Magic rules apply otherwise. Starting life: 20.
- All of Magic is legal except un-sets, ante, subgames, and wishes/sideboard cards.
- Both players play optimally to maximize their tournament result (3 pts for win, 1 for draw, 0 for loss).
- Coin flips and dice rolls resolve to the worst outcome for the controller.
- If one player wins regardless of who goes first, that player wins the matchup.
- If the result depends on who goes first (each player wins on the play), it's a draw.
- If neither player can force a win in either direction, it's a draw.

## Your Deck (@{handle})
{formatted cards with oracle text — name, mana cost, type line, power/toughness, oracle text}

## Opponents
{for each opponent that needs LLM evaluation: formatted deck with handle, oracle text}

## Instructions
For each opponent, evaluate the matchup assuming optimal play from both sides.
Analyze both scenarios: you go first (on the play) and opponent goes first (on the draw).

For each matchup, produce:
1. On-the-play verdict + narrative (you go first)
2. On-the-draw verdict + narrative (opponent goes first)
3. Overall verdict

Narratives: 1-2 sentences describing the key plays, written for Magic players.
Keep each narrative under 200 characters.
Think step by step about mana sequencing, interaction timing, and combat math.

Players play to win if they can. If they have no line that wins, they play to force a draw instead. If they have no line that wins or draws, they lose.

## Output Format (follow exactly)

### vs @{opponent_handle}

#### On the Play
[your analysis of this scenario]
VERDICT: P0_WINS | P1_WINS | DRAW
NARRATIVE: [1-2 sentences, under 200 chars]

#### On the Draw
[your analysis of this scenario]
VERDICT: P0_WINS | P1_WINS | DRAW
NARRATIVE: [1-2 sentences, under 200 chars]

#### Overall
VERDICT: P0_WINS | P1_WINS | DRAW

{repeat for each opponent}

---

## Step 3b: Generate Narratives for Historical Matchups

For matchups with known outcomes, spawn **one** Task agent to generate all narratives in batch. Use `buildNarrativeOnlyPrompt()` from `round-resolution-prompts.ts`. These are much shorter prompts — just asking for the play-by-play, not the verdict.

Can run in parallel with the evaluation agents from Step 3.

## Step 4: Collect and Crosscheck

**This step can run in a fresh session.** All agent outputs are in `/tmp/r{N}-outputs/*.txt`, manifest in `/tmp/r{N}-manifest.json`, dedup map in `/tmp/r{N}-dedup.json`. If context is tight after Step 3, tell the user to start a new session and re-invoke `/resolve-round` — it should detect the existing output files and skip to crosscheck.

### For LLM-evaluated matchups:
After all agents return, crosscheck results using `crosscheckAllPairs()`:

For each pair (A, B):
- Agent-A evaluated "A vs B" where A is Player 0
- Agent-B evaluated "B vs A" where B is Player 0
- **Agreement**: Agent-A's overall verdict, when flipped (player0_wins ↔ player1_wins, draw stays draw), matches Agent-B's overall verdict
- **Disagreement**: they differ

Parse each agent's output to extract per-opponent verdicts and narratives.

### For historical matchups:
No crosscheck needed — these are already known. Just pair the narrative output with the known verdict.

### For duplicate decks:
Copy results from the canonical deck's matchups.

## Step 5: Present Results

Show the user a summary:

### Historical Matches (from Metashape DB)
```
@alice vs @bob — Alice wins (historical: R45A, R67B)
```

### Agreements (LLM crosscheck passed)
```
@alice vs @charlie — Alice wins (both agents agree)
  On play: Alice wins — {narrative}
  On draw: Alice wins — {narrative}
```

### Disagreements
```
⚠️ @charlie vs @dave — DISAGREEMENT
  Charlie's agent says: Charlie wins (P0_WINS)
  Dave's agent says: Dave wins (P0_WINS from Dave's perspective)

  Charlie's agent reasoning: ...
  Dave's agent reasoning: ...
```

Ask the user to resolve each disagreement by picking: "p0 wins", "p1 wins", or "draw".

## Step 6: Write Results to DB

After all matchups are resolved, write them to the database:

Write a temporary script `_resolve-write.ts` and run it with `npx tsx _resolve-write.ts`:

```ts
import { createDatabase, insertMatchup, updateRoundPhase } from "./packages/engine/src/database.ts";
const db = createDatabase("data/3cblue.db");
// For each matchup:
// insertMatchup(db, roundId, player0Did, player1Did, outcome, unresolvedReason, statsJson, llmReasoning, narrative)
//   outcome: "player0_wins" | "player1_wins" | "draw"
//   unresolvedReason: null (or string if unresolved)
//   statsJson: "{}" (unused for LLM-evaluated matchups)
//   llmReasoning: string | null — full agent output for audit
//   narrative: string | null — JSON.stringify({ onPlayVerdict, onDrawVerdict, playNarrative, drawNarrative })
insertMatchup(db, roundId, player0Did, player1Did, outcome, null, "{}", reasoning, narrative);
// After all matchups written:
updateRoundPhase(db, roundId, "complete");
```

Delete the script after running.

The `narrative` column stores JSON with this structure:
```json
{
  "onPlayVerdict": "player0_wins",
  "onDrawVerdict": "draw",
  "playNarrative": "3-5 sentence play-by-play for on-the-play",
  "drawNarrative": "3-5 sentence play-by-play for on-the-draw"
}
```

Use `JSON.stringify()` to serialize before inserting.

For agreed matchups:
- `outcome`: the agreed verdict
- `reasoning`: combined reasoning from both agents
- `narrative`: JSON with per-scenario verdicts and narratives

For historical matchups:
- `outcome`: the known verdict from Metashape DB
- `reasoning`: `"historical match: R45A, R67B"` (source rounds)
- `narrative`: JSON with narratives from the narrative-only agent

For user-resolved disagreements:
- `outcome`: the user's decision
- `reasoning`: both agents' full output
- `narrative`: JSON — ask the user which narrative to use, or write a brief one

## Step 7: Confirm

Tell the user:
- How many matchups were resolved
- Breakdown: historical / agreed / disagreements
- How many LLM calls were saved by historical lookup + dedup
- The round is now in `complete` phase
- Remind them to run `node dist/main.js post-results` or offer to do it

## Notes
- **Multi-session design**: Steps 1-3 (load data, build prompts, run agents) and Steps 4-7 (crosscheck, present, write DB) are independent sessions connected by `/tmp/r{N}-*` files. Always prefer splitting across sessions over risking context overflow.
- Card images: Scryfall provides card images at `https://api.scryfall.com/cards/named?exact={name}&format=image`
- Narratives are stored in the `narrative` column and rendered to images for Bluesky posts
- Full LLM reasoning goes in `llm_reasoning` for audit
- The matchup lookup DB is at `./data/metashape-matchups.json` (10,438 unique deck pairs from 106 Metashape rounds)
- To re-scrape: `npx tsx packages/engine/src/scrape-metashape.ts`

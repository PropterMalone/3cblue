# Resolve Round

Evaluate all matchups for the current 3CB round using parallel agents with crosscheck.

## Step 1: Load Round Data

Read the DB to get the active round and all submissions. Run this script and capture the JSON output:

```bash
cd /home/karl/Projects/3cblue
node -e "
const { createDatabase, getActiveRound, getSubmissionsForRound, getPlayer } = require('./packages/engine/dist/database.js');
const dbPath = process.env.DB_PATH || './3cblue.db';
const db = createDatabase(dbPath);
const round = getActiveRound(db);
if (!round) { console.log(JSON.stringify({ error: 'no active round' })); process.exit(0); }
const subs = getSubmissionsForRound(db, round.id);
const data = {
  roundId: round.id,
  phase: round.phase,
  submissions: subs.map(s => {
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
db.close();
"
```

If there's no active round or fewer than 2 submissions, stop and tell the user.

If the round is not in `submission` or `signup` phase, warn the user but let them decide whether to proceed (they may want to re-evaluate).

## Step 2: Build Deck Info

For each submission, parse the card JSON to get oracle text. Build a `DeckInfo` object for each player:

```typescript
interface DeckInfo {
  playerDid: string;
  handle: string;
  cards: Card[]; // parsed from card1Json, card2Json, card3Json
}
```

## Step 3: Spawn Per-Deck Agents

Launch one Task agent per deck, **all in parallel** (single message with multiple Task tool calls). Use `subagent_type: "general-purpose"`.

Each agent gets the following prompt (fill in the deck data):

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
{for each opponent: formatted deck with handle, oracle text}

## Instructions
For each opponent, evaluate the matchup assuming optimal play from both sides.
Analyze both scenarios: you go first (on the play) and opponent goes first (on the draw).

For each matchup, produce:
1. On-the-play verdict + narrative (you go first)
2. On-the-draw verdict + narrative (opponent goes first)
3. Overall verdict

Narratives: Write a 3-5 sentence play-by-play of how the game unfolds, aimed at Magic players.
Describe the key turns, interactions, and why the result is what it is.
These will be shown to players alongside card images.

Think step by step about mana sequencing, interaction timing, and combat math.

Players play to win if they can. If they have no line that wins, they play to force a draw instead. If they have no line that wins or draws, they lose.

## Output Format (follow EXACTLY)

### vs @{opponent_handle}

#### On the Play
{your analysis}
VERDICT: P0_WINS | P1_WINS | DRAW
NARRATIVE: {3-5 sentence play-by-play}

#### On the Draw
{your analysis}
VERDICT: P0_WINS | P1_WINS | DRAW
NARRATIVE: {3-5 sentence play-by-play}

#### Overall
VERDICT: P0_WINS | P1_WINS | DRAW

{repeat for each opponent}

---

**Important**: Format card info like this for each card:
```
**Card Name** {mana cost}
type line — P/T
Oracle text
```

## Step 4: Collect and Crosscheck

After all agents return, crosscheck results:

For each pair (A, B):
- Agent-A evaluated "A vs B" where A is Player 0
- Agent-B evaluated "B vs A" where B is Player 0
- **Agreement**: Agent-A's overall verdict, when flipped (player0_wins ↔ player1_wins, draw stays draw), matches Agent-B's overall verdict
- **Disagreement**: they differ

Parse each agent's output to extract per-opponent verdicts and narratives. The output follows a structured format with `### vs @handle` sections, `#### On the Play` / `#### On the Draw` / `#### Overall` subsections, `VERDICT:` lines, and `NARRATIVE:` lines.

## Step 5: Present Results

Show the user a summary:

### Agreements
For each agreed matchup:
```
@alice vs @bob — Alice wins (both agents agree)
  On play: Alice wins — {narrative}
  On draw: Alice wins — {narrative}
```

### Disagreements
For each disagreed matchup, show BOTH agents' reasoning side by side:
```
⚠️ @alice vs @bob — DISAGREEMENT
  Alice's agent says: Alice wins (P0_WINS)
  Bob's agent says: Bob wins (P0_WINS from Bob's perspective)

  Alice's agent reasoning: ...
  Bob's agent reasoning: ...
```

Ask the user to resolve each disagreement by picking: "p0 wins", "p1 wins", or "draw".

## Step 6: Write Results to DB

After all matchups are resolved (agreements + user-resolved disagreements), write them to the database:

```bash
node -e "
const { createDatabase, insertMatchup, updateRoundPhase } = require('./packages/engine/dist/database.js');
const db = createDatabase(process.env.DB_PATH || './3cblue.db');
// For each matchup:
insertMatchup(db, roundId, player0Did, player1Did, outcome, null, '{}', reasoning, narrative);
// Advance round to complete:
updateRoundPhase(db, roundId, 'complete');
db.close();
"
```

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
- `narrative`: JSON with per-scenario verdicts and narratives (from winner's agent perspective; for draws, from P0's agent)

For user-resolved disagreements:
- `outcome`: the user's decision
- `reasoning`: both agents' full output
- `narrative`: JSON — ask the user which narrative to use, or write a brief one

## Step 7: Confirm

Tell the user:
- How many matchups were resolved
- How many agreements vs disagreements
- The round is now in `complete` phase
- Remind them to run the bot to post results (or offer to do it if posting logic is available)

## Notes
- Card images: Scryfall provides card images at `https://api.scryfall.com/cards/named?exact={name}&format=image` — useful for the image generation step later
- Narratives are stored in the `narrative` column and will be rendered to images for Bluesky posts
- Full LLM reasoning goes in `llm_reasoning` for audit

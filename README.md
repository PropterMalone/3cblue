# 3CBlue

Three Card Blind on Bluesky — an MTG game bot with LLM-powered matchup evaluation.

**Bot profile:** [@3cblue.bsky.social](https://bsky.app/profile/3cblue.bsky.social)
**FAQ:** [malone.taildf301e.ts.net/3cb/faq](https://malone.taildf301e.ts.net/3cb/faq)

## What is Three Card Blind?

Each player secretly submits a deck of 3 Magic: The Gathering cards. All pairwise matchups are evaluated under normal Magic rules (with a few format-specific conventions), and players are scored round-robin style: 3 points for a win, 1 for a draw, 0 for a loss. The round winner's cards are banned for future rounds.

## Features

- **Scryfall API integration** for card lookup and validation
- **Structural ban list** — un-sets, ante, subgames, wishes, sideboard, pure lands
- **LLM matchup evaluation** — Claude API reads oracle text + 3CB rules, determines optimal play for both sides
- **Judge fallback** — unresolvable matchups (`?` results) go to designated judges
- **DM-based submission** — players DM decks to the bot, get validation feedback
- **Round-robin scoring** (3/1/0) with public reveal and result posts
- **Winner's cards banned** for future rounds
- Built on [propter-bsky-kit](https://github.com/PropterMalone/propter-bsky-kit)

## Project Structure

Monorepo with two packages:

- **`packages/shared`** — Functional core: card types, oracle text parser, combat engine, ban list, minimax search
- **`packages/engine`** — Imperative shell: Bluesky bot, SQLite persistence, Scryfall client, LLM evaluator, image compositing, round lifecycle

The shared package also includes a legacy minimax combat engine with alpha-beta pruning and transposition tables. It's not used by the bot (the LLM evaluator handles matchups), but is kept for reference.

## Development

```bash
npm install
npm run validate   # biome + typecheck + test
npm run build      # tsc -b
npm test           # vitest
```

## License

[MIT](LICENSE)

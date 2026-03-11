## Legacy Game Engine

Minimax game engine with alpha-beta pruning and transposition tables. Used in Round 1 prototype, replaced by Claude API-based matchup evaluation.

Kept for reference only — not built, not tested, not imported by anything.

Files:
- `game-state.ts` — Immutable game state, hashing, keyword helpers
- `game-actions.ts` — Action types, state transitions, game over checks
- `combat.ts` — Combat damage resolution
- `search.ts` — Minimax search + alpha-beta + transposition table
- `combat.test.ts`, `search.test.ts` — Tests (may not pass without shared dependencies)

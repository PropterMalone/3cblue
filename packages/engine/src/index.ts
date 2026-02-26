// pattern: Imperative Shell

export { ThreeCBlueBot } from "./bluesky-bot.js";
export type { BotConfig } from "./bluesky-bot.js";

export {
	createDatabase,
	createRound,
	getRound,
	getActiveRound,
	updateRoundPhase,
	upsertPlayer,
	upsertSubmission,
	getSubmissionsForRound,
	insertMatchup,
	resolveMatchup,
	getMatchupsForRound,
	getUnresolvedMatchups,
	addJudge,
	isJudge,
} from "./database.js";
export type {
	RoundPhase,
	DbRound,
	DbPlayer,
	DbSubmission,
	DbMatchup,
} from "./database.js";

export { lookupCard, lookupCards, clearCardCache } from "./scryfall-client.js";
export type { CardLookupResult } from "./scryfall-client.js";

export { validateDeck, parseCardNames } from "./deck-validation.js";
export type {
	DeckValidationResult,
	DeckValidationSuccess,
	DeckValidationError,
} from "./deck-validation.js";

export {
	resolveRound,
	computeStandings,
	checkJudgingComplete,
} from "./round-lifecycle.js";
export type {
	MatchupResultWithPlayers,
	RoundResolutionResult,
	StandingsEntry,
} from "./round-lifecycle.js";

export {
	formatRevealPost,
	formatMatchupResults,
	formatStandings,
	formatUnresolvedMatchup,
} from "./post-formatter.js";

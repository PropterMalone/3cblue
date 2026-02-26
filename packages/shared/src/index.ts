// pattern: Functional Core
export type {
	Card,
	CardType,
	Color,
	EvergreenKeyword,
	Ability,
	AbilityKind,
	KeywordAbility,
	StaticPtModifier,
	EtbDamage,
	EtbLifeGain,
	EtbCreateToken,
	ActivatedTapDamage,
	ActivatedTapLifeGain,
	UnresolvedAbility,
} from "./card-types.js";

export {
	hasUnresolvedAbilities,
	getKeywords,
	isCreature,
} from "./card-types.js";

export type {
	ScryfallCard,
	ScryfallCardFace,
	ScryfallError,
} from "./scryfall-types.js";

export { parseOracleText } from "./oracle-parser.js";
export { scryfallToCard } from "./scryfall-to-card.js";
export { checkBan, checkDeckBans } from "./ban-list.js";
export type { BanCheckResult } from "./ban-list.js";

export type {
	GameState,
	PlayerState,
	Permanent,
	CombatState,
	Phase,
	PlayerId,
} from "./game-state.js";

export {
	createInitialState,
	canAttack,
	canBlock,
	getEffectivePower,
	getEffectiveToughness,
	hasKeyword,
	hashState,
} from "./game-state.js";

export type {
	Action,
	CastAction,
	DeclareAttackersAction,
	DeclareBlockersAction,
	PassAction,
	GameResult,
} from "./game-actions.js";

export {
	enumerateLegalActions,
	applyAction,
	checkGameOver,
	checkAndRecordStalemate,
} from "./game-actions.js";

export type {
	MatchupResult,
	SearchStats,
	TournamentMatchup,
	TournamentStandings,
} from "./search.js";

export { simulateMatchup, runRoundRobin } from "./search.js";

export { resolveCombatDamage, enumerateBlockAssignments } from "./combat.js";
export type { CombatResult } from "./combat.js";

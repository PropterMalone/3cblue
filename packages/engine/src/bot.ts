// pattern: Imperative Shell
// Re-exports from propter-bsky-kit — all Bluesky I/O now lives in the shared package.

export { createAgent, buildFacets } from "propter-bsky-kit";
export { postMessage, replyToPost } from "propter-bsky-kit";
export {
	createChatAgent,
	createBlueskyDmSender,
	createConsoleDmSender,
	pollInboundDms,
} from "propter-bsky-kit";
export type { PostRef, DmSender, DmResult, InboundDm } from "propter-bsky-kit";

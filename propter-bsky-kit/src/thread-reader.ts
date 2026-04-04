// pattern: Imperative Shell

import type { AtpAgent } from "@atproto/api";
import type { RateLimiter, ThreadReply } from "./types.js";

type ThreadNode = {
	$type?: string;
	post?: {
		uri?: string;
		indexedAt?: string;
		replyCount?: number;
		author?: { did?: string; handle?: string };
		record?: { text?: string; reply?: { parent?: { uri?: string } } };
	};
	replies?: ThreadNode[];
};

export interface GetThreadRepliesOptions {
	maxFetches?: number;
	rateLimiter?: RateLimiter;
}

/**
 * Fetch all replies in a thread, recursively descending past Bluesky's ~depth-10 truncation.
 * When a post has replyCount > 0 but no replies returned, we fetch its sub-thread separately.
 */
export async function getThreadReplies(
	agent: AtpAgent,
	postUri: string,
	options?: GetThreadRepliesOptions,
): Promise<ThreadReply[]> {
	const maxFetches = options?.maxFetches ?? 20;
	const rateLimiter = options?.rateLimiter;
	const seen = new Set<string>();
	const replies: ThreadReply[] = [];
	let fetchCount = 0;

	async function fetchAndWalk(uri: string): Promise<void> {
		if (fetchCount >= maxFetches) return;
		fetchCount++;

		if (rateLimiter) await rateLimiter.acquire();
		const response = await agent.api.app.bsky.feed.getPostThread({
			uri,
			depth: 100,
		});

		const thread = response.data.thread;
		if (thread.$type !== "app.bsky.feed.defs#threadViewPost") return;

		const truncatedUris: string[] = [];

		function walk(nodes: unknown[]): void {
			for (const node of nodes) {
				const r = node as ThreadNode;
				if (r.$type !== "app.bsky.feed.defs#threadViewPost" || !r.post)
					continue;

				const nodeUri = r.post.uri ?? "";
				if (seen.has(nodeUri)) continue;
				seen.add(nodeUri);

				replies.push({
					uri: nodeUri,
					parentUri: r.post.record?.reply?.parent?.uri ?? "",
					authorDid: r.post.author?.did ?? "",
					authorHandle: r.post.author?.handle ?? "",
					text: r.post.record?.text ?? "",
					indexedAt: r.post.indexedAt ?? "",
				});

				if (Array.isArray(r.replies) && r.replies.length > 0) {
					walk(r.replies);
				} else if ((r.post.replyCount ?? 0) > 0) {
					truncatedUris.push(nodeUri);
				}
			}
		}

		const threadView = thread as ThreadNode;
		if (Array.isArray(threadView.replies)) walk(threadView.replies);

		for (const truncUri of truncatedUris) {
			await fetchAndWalk(truncUri);
		}
	}

	await fetchAndWalk(postUri);
	replies.sort((a, b) =>
		a.indexedAt < b.indexedAt ? -1 : a.indexedAt > b.indexedAt ? 1 : 0,
	);
	return replies;
}

// pattern: Functional Core

export interface BotConfig {
	identifier: string;
	password: string;
	service?: string;
}

export type PostRef = { uri: string; cid: string };

export type DmResult = "sent" | "blocked" | "error";

export interface MentionNotification {
	uri: string;
	cid: string;
	authorDid: string;
	authorHandle: string;
	text: string;
	indexedAt: string;
}

export interface InboundDm {
	senderDid: string;
	convoId: string;
	messageId: string;
	text: string;
	sentAt: string;
}

/** Outbound DM capabilities */
export interface DmSender {
	sendDm(recipientDid: string, text: string): Promise<DmResult>;
}

/** DmSender with bot-relayed group messaging (Bluesky has no native group DMs) */
export interface RelayDmSender extends DmSender {
	createRelayGroup(groupId: string, memberDids: string[]): void;
	sendToRelayGroup(groupId: string, text: string): Promise<void>;
}

export interface RateLimiter {
	/** Wait if needed, then mark a request. Returns when safe to proceed. */
	acquire(): Promise<void>;
}

export interface ThreadReply {
	uri: string;
	parentUri: string;
	authorDid: string;
	authorHandle: string;
	text: string;
	indexedAt: string;
}

export interface FeedSkeleton {
	feed: { post: string }[];
	cursor?: string;
}

export interface FeedInfo {
	uri: string;
}

export interface FeedHandler {
	(params: URLSearchParams): FeedSkeleton;
	listFeeds(): FeedInfo[];
	close?: () => void;
}

export interface LabelerClient {
	labelPost(uri: string, val: string): Promise<boolean>;
	watchThread(threadUri: string, label: string): Promise<boolean>;
	unwatchThread(threadUri: string): Promise<boolean>;
}

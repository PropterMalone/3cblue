// pattern: Imperative Shell

// Minimal feed server for 3CBlue. Serves FAQ page, future feed generator.

import { createFeedServer } from "propter-bsky-kit";
import { FAQ_HTML } from "./faq.js";

const PORT = Number.parseInt(process.env.FEED_PORT ?? "3007", 10);
const HOSTNAME = process.env.FEED_HOSTNAME ?? "localhost";

createFeedServer({
	port: PORT,
	hostname: HOSTNAME,
	serviceDid: `did:web:${HOSTNAME}`,
	botName: "3CBlue",
	faqHtml: FAQ_HTML,
});

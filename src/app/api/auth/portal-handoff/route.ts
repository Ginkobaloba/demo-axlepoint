import { makeHandler } from "@/lib/portal-handoff-handler";

/**
 * Portal handoff route (chunk 4b).
 *
 * The Paradigm Portal redirects the user here with a one-shot JWT in the
 * URL fragment (#portal_token=<JWT>). The landing page reads the fragment
 * client-side, scrubs it out of window.location, and POSTs the token to
 * this route. The verification logic lives in @/lib/portal-handoff-handler
 * so this route file exports only what the App Router allows.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = makeHandler();

/**
 * Input hygiene for work-order creation.
 *
 * The seed generator never produces junk, but the create endpoint is open
 * and the running container persists drafts until the next redeploy
 * (decisions D-005). Without screening, ad-hoc API pokes ("Test", "JSON API
 * test order") accumulate in the live demo where a prospect can see them.
 * This is the guard that keeps that from happening again.
 */

export const MIN_TITLE_LEN = 6;

// Titles that are obviously a developer poking the endpoint rather than a
// real maintenance request. Matched against the trimmed, lowercased title.
const JUNK_PATTERNS: RegExp[] = [
  /^test\b/, // "test", "test order", "test audit work order"
  /\btest (order|work order|wo)\b/,
  /^json\b/, // "JSON API test order"
  /\bapi test\b/,
  /^(foo|bar|baz|asdf|qwerty|xxx+|todo|tbd|placeholder|sample|dummy|lorem)\b/,
];

export interface TitleScreen {
  ok: boolean;
  reason?: string;
}

/**
 * Screens a proposed work-order title. Returns ok:false with a
 * human-readable reason when the title looks like a test fixture or is too
 * short to be a real request.
 */
export function screenWorkOrderTitle(rawTitle: string): TitleScreen {
  const title = rawTitle.trim();
  if (title.length < MIN_TITLE_LEN) {
    return {
      ok: false,
      reason: `Title must be at least ${MIN_TITLE_LEN} characters.`,
    };
  }
  const lowered = title.toLowerCase();
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(lowered)) {
      return {
        ok: false,
        reason: "Title looks like a test fixture. Use a real work description.",
      };
    }
  }
  return { ok: true };
}

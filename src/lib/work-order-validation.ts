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
//
// These are deliberately narrow to avoid rejecting legitimate industrial
// titles: "Test bench calibration" and "Sample collection port reseal" are
// real work and must pass. So we only reject "test"/"sample" when the whole
// title is the bare word, or when "test" co-occurs with a fixture word
// (order/audit/api/fixture/...) that signals a poke rather than a job.
const JUNK_PATTERNS: RegExp[] = [
  /\btest\b.*\b(order|audit|api|fixture|record|entry|wo|ignore|delete)\b/, // "Test audit work order", "JSON API test order"
  /\b(api|json)\b.*\btest\b/, // "JSON API test order"
  /\blorem ipsum\b/,
];

// Titles that are junk only when the entire (trimmed, lowercased) title is
// exactly the word. "Sample line pressure check" is real; "sample" alone is not.
const JUNK_EXACT = new Set([
  "test",
  "testing",
  "sample",
  "foo",
  "bar",
  "baz",
  "asdf",
  "qwerty",
  "todo",
  "tbd",
  "placeholder",
  "dummy",
  "lorem",
  "ignore",
  "delete me",
  "dummy data",
]);

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
  const isJunk =
    JUNK_EXACT.has(lowered) || JUNK_PATTERNS.some((p) => p.test(lowered));
  if (isJunk) {
    return {
      ok: false,
      reason: "Title looks like a test fixture. Use a real work description.",
    };
  }
  return { ok: true };
}

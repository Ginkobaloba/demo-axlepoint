/**
 * Input hygiene for work-order creation.
 *
 * The seed generator never produces junk, but the create endpoint is open,
 * and drafts persist until the next scheduled seed reset (decisions D-005,
 * D-012). Without screening, ad-hoc API pokes ("Test", "JSON API test
 * order") could otherwise sit in the live demo until then, where a
 * prospect can see them. This is the guard that keeps that from happening.
 *
 * As of D-012, screenWorkOrderTitle only validates the shape of what a
 * visitor typed; the literal text is never stored (see
 * deriveWorkOrderTitle below and api/work-orders/route.ts).
 */

import { WO_TYPE_LABELS, type WorkOrderType } from "./types";

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

/**
 * Anonymous by design (council item 1.2, docs/demos/axlepoint/decisions.md
 * D-012): the shared demo database is readable by every later visitor, so
 * nothing a visitor types into the "New work order" form or the
 * "Recommend Preventive Action" button is ever stored. What lands in the
 * title column instead is derived purely from structured, non-free-text
 * fields already validated by the route (the asset and the work-order
 * type), so it carries no visitor-typed content and stays stable across
 * requests for the same asset/type pair.
 */
export function deriveWorkOrderTitle(
  assetName: string,
  type: WorkOrderType,
): string {
  return `${WO_TYPE_LABELS[type]} - ${assetName}`;
}

/**
 * Stored in the description column in place of whatever a visitor typed.
 * Honest rather than blank: a reader of the work order (including the
 * visitor who created it) sees why the field is empty instead of a
 * confusing gap.
 */
export const DISCARDED_DESCRIPTION_NOTICE =
  "Description text isn't stored in this demo -- anything typed here is discarded, not shown to other visitors.";

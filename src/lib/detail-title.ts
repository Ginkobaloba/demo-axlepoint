/**
 * Browser-tab titles for the record detail pages.
 *
 * WHY: every detail page rendered the identical "Operations | AxlePoint
 * Industrial", because none of them set a title and they inherited the /app
 * layout's. Open an asset, a work order and a part side by side and all three
 * tabs read the same; bookmark one and the name says nothing.
 *
 * The id alone is enough to tell them apart and costs NO database read, which
 * matters: generateMetadata runs per request, so reading the record again to
 * title the page would double the tenant-scoped queries on the hottest pages.
 *
 * The id arrives from the URL, so it is untrusted. Next escapes metadata, so
 * this is not an injection guard; it is a "do not reflect arbitrary path text
 * into the page title" guard. Anything that is not a plain record id gets the
 * generic kind instead, which is also what a 404 wants, since generateMetadata
 * runs BEFORE the page can call notFound().
 */
const RECORD_ID = /^[A-Za-z]{2,5}-\d{1,8}$/;

export function detailTitle(kind: string, id: string): string {
  return RECORD_ID.test(id) ? `${kind} ${id}` : kind;
}

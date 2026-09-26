import Link from "next/link";
import { ArrowLeft, LayoutDashboard } from "lucide-react";

export const metadata = {
  title: "Not found",
};

/**
 * In-app 404, for a notFound() raised inside the app shell: an asset, work
 * order, part or purchase order id that does not exist.
 *
 * This one renders INSIDE the /app layout, so the sidebar and header come for
 * free and the visitor keeps their bearings. The root not-found.tsx covers the
 * other case, a URL that matched no route at all and therefore has no layout.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p className="font-mono text-sm font-semibold tracking-widest text-gold">
        404
      </p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">
        That record does not exist
      </h1>
      <p className="mt-3 text-sm text-ink-soft">
        It may have been reset since the link was created. The demo data is
        regenerated on a schedule, so ids do not survive a reset.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/app" className="btn-primary">
          <LayoutDashboard className="h-4 w-4" />
          Back to the dashboard
        </Link>
        <Link href="/app/assets" className="btn-secondary">
          <ArrowLeft className="h-4 w-4" />
          Browse all assets
        </Link>
      </div>
    </div>
  );
}

import Link from "next/link";
import { ArrowRight, Home } from "lucide-react";
import { Wordmark } from "@/components/brand";

export const metadata = {
  title: "Page not found",
};

/**
 * Root 404, for URLs that match no route at all.
 *
 * Next renders THIS file, not /app/not-found.tsx, when nothing matched, so it
 * gets the root layout only: no sidebar, no nav, no way back unless this page
 * supplies one. Before it existed a visitor who mistyped a URL landed on the
 * framework default, whose only link led OFF the site entirely.
 *
 * /app/not-found.tsx handles the other case, a notFound() raised inside the
 * app shell, and keeps the nav.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-cream px-6 py-16 text-center">
      <Wordmark className="mb-10" />

      <p className="font-mono text-sm font-semibold tracking-widest text-gold">
        404
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink">
        We could not find that page
      </h1>
      <p className="mt-3 max-w-md text-sm text-ink-soft">
        The link may be out of date, or the address may have a typo. Everything
        in the demo is reachable from the dashboard.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/app" className="btn-primary">
          Go to the dashboard
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link href="/" className="btn-secondary">
          <Home className="h-4 w-4" />
          Back to the homepage
        </Link>
      </div>
    </main>
  );
}

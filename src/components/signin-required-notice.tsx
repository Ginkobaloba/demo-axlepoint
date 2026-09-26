"use client";

import { useSearchParams } from "next/navigation";
import { LogIn } from "lucide-react";

/**
 * Explains the bounce when middleware sends an unauthenticated /app request
 * here as /?signin=required.
 *
 * Before this existed the parameter was set and NOTHING read it: the landing
 * page rendered identically with and without it. A deep link, a bookmark or a
 * session that expired mid-demo dropped the visitor on the marketing page with
 * no hint of why they were not where they asked to be.
 *
 * Reads the parameter with useSearchParams and derives the result during
 * render, so there is no state and no effect. The obvious alternative, reading
 * window.location.search in an effect the way PortalHandoffClaim does, needs a
 * setState inside that effect, and react-hooks/set-state-in-effect is an ERROR
 * for new code in this repo (eslint.config.mjs grandfathers four older
 * components and says so explicitly).
 *
 * useSearchParams makes this component client-rendered up to the nearest
 * Suspense boundary, which is why the caller wraps it in one. The landing page
 * is `dynamic = "force-static"` and STAYS static: the boundary is what lets the
 * shell prerender while this fills in after hydration.
 *
 * Renders nothing at all when the parameter is absent, which is the usual case.
 */
export function SignInRequiredNotice() {
  const params = useSearchParams();
  if (params.get("signin") !== "required") return null;

  return (
    <div
      role="status"
      className="border-b border-gold/40 bg-gold/15 px-4 py-2.5 text-center text-sm text-ink-soft"
    >
      <span className="inline-flex items-center gap-2">
        <LogIn className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
        <span>
          Please open the demo to continue. That page needs a demo session, and
          this one starts it instantly, with no account and no email.
        </span>
      </span>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * Client-side fragment claim for the Paradigm Portal handoff (chunk 4b).
 *
 * The portal redirects users here with the JWT in the URL fragment:
 *
 *   https://axlepoint.projectnexuscode.org/#portal_token=<JWT>
 *
 * Fragments never reach an HTTP access log, so the token does not touch
 * any server's request log on its way in. We:
 *
 *   1. Read window.location.hash on mount.
 *   2. IMMEDIATELY scrub the fragment from the URL via history.replaceState
 *      so it does not survive in the address bar or back/forward stack.
 *   3. POST the token to /api/auth/portal-handoff. On 200 the server has
 *      set the app-side session cookie; we navigate to /app.
 *   4. On any failure surface a short, non-leaky message and stop. The
 *      user can fall through to the existing demo cookie button.
 *
 * If the URL has no portal_token fragment, this component renders nothing
 * and does nothing.
 */
export function PortalHandoffClaim() {
  const [status, setStatus] = useState<
    "idle" | "claiming" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.startsWith("#")) return;

    const params = new URLSearchParams(hash.slice(1));
    const token = params.get("portal_token");
    if (!token) return;

    // Scrub the fragment before anything else can read it.
    const cleanedUrl =
      window.location.pathname + window.location.search;
    window.history.replaceState(null, "", cleanedUrl);

    setStatus("claiming");
    void (async () => {
      try {
        const res = await fetch("/api/auth/portal-handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          credentials: "same-origin",
        });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = (await res.json()) as { code?: string };
            if (body?.code) detail = body.code;
          } catch {
            /* keep status-only detail */
          }
          setStatus("error");
          setMessage("Portal sign-in failed: " + detail);
          return;
        }
        const body = (await res.json()) as { redirect?: string };
        setStatus("success");
        const target =
          typeof body?.redirect === "string" ? body.redirect : "/app";
        window.location.assign(target);
      } catch (err) {
        setStatus("error");
        setMessage(
          "Portal sign-in failed: " + (err as Error).message,
        );
      }
    })();
  }, []);

  if (status === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 flex justify-center bg-forest px-4 py-2 text-sm text-cream"
    >
      {status === "claiming" && (
        <span>Signing you in through Paradigm Portal...</span>
      )}
      {status === "success" && <span>Signed in. Redirecting...</span>}
      {status === "error" && (
        <span>{message ?? "Portal sign-in failed."}</span>
      )}
    </div>
  );
}

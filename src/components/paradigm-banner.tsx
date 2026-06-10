"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const COOKIE = "pn_banner_dismissed";

/**
 * "Built by Paradigm" attribution banner, shared across all Paradigm
 * portfolio demos. Follows the canonical contract in
 * cloudflare-config/banner/README.md: 32px tall, #1f5a44 on #f7f5f0,
 * dismiss sets a 7-day cookie scoped to this subdomain, role="region"
 * with a labeled dismiss button. This is the TSX flavor of the canonical
 * ParadigmBanner.jsx, restyled with the project's Tailwind tokens.
 */
export function ParadigmBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!document.cookie.split("; ").some((c) => c.startsWith(`${COOKIE}=`))) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    const expires = new Date(Date.now() + 7 * 86400 * 1000).toUTCString();
    document.cookie = `${COOKIE}=1; expires=${expires}; path=/; SameSite=Lax`;
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Paradigm demo attribution"
      className="fixed inset-x-0 bottom-0 z-50 flex h-8 items-center justify-center gap-2 border-t border-line bg-cream text-forest"
      style={{ boxShadow: "0 -2px 8px rgba(26, 26, 26, 0.08)" }}
    >
      <p className="truncate text-[13px] font-medium">
        This demo was built by{" "}
        <a
          href="https://projectnexuscode.org"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline-offset-2 hover:underline"
        >
          Paradigm
        </a>
      </p>
      <button
        onClick={dismiss}
        aria-label="Dismiss Paradigm banner for 7 days"
        className="rounded p-0.5 text-forest/60 hover:bg-forest/10 hover:text-forest"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

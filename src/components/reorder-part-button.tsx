"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShoppingCart } from "lucide-react";

/**
 * Drafts a reorder purchase order for a single part and navigates to it.
 * Shown on the part detail page when the part is below its reorder point.
 */
export function ReorderPartButton({ partId }: { partId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part_ids: [partId] }),
      });
      const data = (await res.json().catch(() => null)) as {
        poIds?: string[];
        error?: string;
      } | null;
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`);
      const target = data?.poIds?.[0]
        ? `/app/purchase-orders/${data.poIds[0]}`
        : "/app/purchase-orders";
      router.push(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create PO.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button onClick={run} disabled={busy} className="btn-gold">
        <ShoppingCart className="h-4 w-4" />
        {busy ? "Drafting PO..." : "Reorder this part"}
      </button>
      {error && <p className="text-xs font-medium text-risk-high">{error}</p>}
    </div>
  );
}

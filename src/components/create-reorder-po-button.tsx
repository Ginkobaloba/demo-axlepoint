"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShoppingCart } from "lucide-react";

/**
 * Drafts reorder purchase orders for every below-reorder part (grouped by
 * supplier) and navigates to the Purchase Orders list. This is the action
 * that wires the "Reorder needed" alert to a real PO.
 */
export function CreateReorderPoButton({ lowCount }: { lowCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (lowCount === 0) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Failed (${res.status})`);
      }
      router.push("/app/purchase-orders?created=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create POs.");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={run} disabled={busy} className="btn-gold">
        <ShoppingCart className="h-4 w-4" />
        {busy
          ? "Drafting purchase orders..."
          : `Create reorder PO (${lowCount} ${lowCount === 1 ? "part" : "parts"})`}
      </button>
      {error && <p className="text-xs font-medium text-risk-high">{error}</p>}
    </div>
  );
}

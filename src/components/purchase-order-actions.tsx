"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, PackageCheck, Send } from "lucide-react";
import { nextStatuses } from "@/lib/po-actions";
import type { PurchaseOrderStatus } from "@/lib/types";

const ACTION_META: Record<
  PurchaseOrderStatus,
  { label: string; className: string; icon: typeof Send } | undefined
> = {
  ordered: { label: "Mark ordered", className: "btn-primary", icon: Send },
  received: {
    label: "Mark received (restock)",
    className: "btn-gold",
    icon: PackageCheck,
  },
  cancelled: { label: "Cancel PO", className: "btn-secondary", icon: Ban },
  draft: undefined,
};

/**
 * Status transition controls for a purchase order. Only the legal next
 * states for the current status are offered. Receiving restocks parts, which
 * the page reflects after the refresh.
 */
export function PurchaseOrderActions({
  poId,
  status,
}: {
  poId: string;
  status: PurchaseOrderStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = nextStatuses(status);
  if (options.length === 0) {
    return (
      <p className="text-sm text-ink-faint">
        This purchase order is {status} -- no further action.
      </p>
    );
  }

  const move = async (next: PurchaseOrderStatus) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/purchase-orders/${poId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((next) => {
          const meta = ACTION_META[next]!;
          const Icon = meta.icon;
          return (
            <button
              key={next}
              type="button"
              onClick={() => move(next)}
              disabled={busy}
              className={meta.className}
            >
              <Icon className="h-4 w-4" />
              {meta.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="rounded-md border border-risk-high/30 bg-risk-high/10 px-3 py-2 text-xs font-medium text-risk-high">
          {error}
        </p>
      )}
    </div>
  );
}

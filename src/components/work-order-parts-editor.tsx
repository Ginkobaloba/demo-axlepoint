"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import type { Part } from "@/lib/types";

interface LinePart extends Part {
  qty: number;
}

/**
 * Editable parts list for a work order. Shows the parts currently attached
 * (with remove) and an add row that picks from the catalog. Part of the
 * closed-loop workflow: a recommended order can have its replacement parts
 * attached before it is scheduled. Stock levels are not decremented here --
 * consumption against inventory is handled by the reorder/PO flow so the two
 * paths do not double-count.
 */
export function WorkOrderPartsEditor({
  workOrderId,
  parts,
  catalog,
}: {
  workOrderId: string;
  parts: LinePart[];
  catalog: Part[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [qty, setQty] = useState(1);

  const onOrder = useMemo(() => new Set(parts.map((p) => p.id)), [parts]);
  const available = useMemo(
    () => catalog.filter((p) => !onOrder.has(p.id)),
    [catalog, onOrder],
  );
  const grouped = useMemo(() => {
    const byCat = new Map<string, Part[]>();
    for (const p of available) {
      const list = byCat.get(p.category) ?? [];
      list.push(p);
      byCat.set(p.category, list);
    }
    return [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [available]);

  const total = parts.reduce((s, p) => s + p.unit_cost * p.qty, 0);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Update failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!selected) return;
    await patch({ action: "add_part", part_id: selected, qty });
    setSelected("");
    setQty(1);
  };

  return (
    <div className="space-y-3">
      {parts.length > 0 ? (
        <table className="table-base">
          <thead>
            <tr>
              <th>Part</th>
              <th>SKU</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Lead time</th>
              <th className="text-right">Ext. cost</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id}>
                <td className="text-ink">{p.name}</td>
                <td className="font-mono text-xs text-ink-soft">{p.sku}</td>
                <td className="text-right font-mono">{p.qty}</td>
                <td className="text-right text-ink-soft">{p.lead_time_days}d</td>
                <td className="text-right font-mono">
                  {fmtMoney(p.unit_cost * p.qty)}
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    aria-label={`Remove ${p.name}`}
                    title="Remove part"
                    disabled={busy}
                    onClick={() =>
                      patch({ action: "remove_part", part_id: p.id })
                    }
                    className="rounded p-1 text-ink-faint hover:bg-risk-high/10 hover:text-risk-high"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td
                colSpan={4}
                className="text-right text-xs font-semibold uppercase tracking-wide text-ink-faint"
              >
                Total
              </td>
              <td className="text-right font-mono font-semibold">
                {fmtMoney(total)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-ink-faint">No parts attached yet.</p>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="add-part">
            Add a part
          </label>
          <select
            id="add-part"
            className="input cursor-pointer"
            value={selected}
            disabled={busy}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a part...</option>
            {grouped.map(([category, items]) => (
              <optgroup key={category} label={category}>
                {items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku}) - {fmtMoney(p.unit_cost)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="w-20">
          <label className="label" htmlFor="add-qty">
            Qty
          </label>
          <input
            id="add-qty"
            type="number"
            min={1}
            max={999}
            className="input"
            value={qty}
            disabled={busy}
            onChange={(e) =>
              setQty(Math.max(1, Math.min(999, Number(e.target.value) || 1)))
            }
          />
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !selected}
          onClick={add}
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-risk-high/30 bg-risk-high/10 px-3 py-2 text-xs font-medium text-risk-high">
          {error}
        </p>
      )}
    </div>
  );
}

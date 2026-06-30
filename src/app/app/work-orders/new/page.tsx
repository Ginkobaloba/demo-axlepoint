import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAssets, getTechnicians } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "New Work Order" };

export default function NewWorkOrderPage({
  searchParams,
}: {
  searchParams: { asset?: string; error?: string };
}) {
  const assets = getAssets();
  const technicians = getTechnicians();
  const preselected = searchParams.asset;
  const error = searchParams.error;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href="/app/work-orders"
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-faint hover:text-forest"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All work orders
      </Link>

      <div className="card">
        <div className="border-b border-line px-5 py-4">
          <h1 className="text-xl font-bold tracking-tight">New work order</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Creates an open order in the demo workspace.
          </p>
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-md border border-risk-high/30 bg-risk-high/10 px-4 py-3 text-sm font-medium text-risk-high">
            {error}
          </div>
        )}

        <form
          method="POST"
          action="/api/work-orders"
          className="space-y-4 px-5 py-5"
        >
          <div>
            <label className="label" htmlFor="asset_id">
              Asset
            </label>
            <select
              id="asset_id"
              name="asset_id"
              required
              defaultValue={preselected ?? ""}
              className="input cursor-pointer"
            >
              <option value="" disabled>
                Select an asset...
              </option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id}) - {a.location}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="title">
              Title
            </label>
            <input
              id="title"
              name="title"
              required
              minLength={6}
              maxLength={160}
              placeholder="What needs to happen?"
              className="input"
            />
            <p className="mt-1 text-xs text-ink-faint">
              Describe the work. Test or placeholder titles are rejected.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              maxLength={2000}
              placeholder="Scope, acceptance criteria, safety notes..."
              className="input resize-y"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="type">
                Type
              </label>
              <select id="type" name="type" className="input cursor-pointer" defaultValue="preventive">
                <option value="preventive">Preventive</option>
                <option value="corrective">Corrective</option>
                <option value="inspection">Inspection</option>
                <option value="predictive">Predictive</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="priority">
                Priority
              </label>
              <select id="priority" name="priority" className="input cursor-pointer" defaultValue="medium">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="assigned_to">
                Assign to
              </label>
              <select id="assigned_to" name="assigned_to" className="input cursor-pointer" defaultValue="">
                <option value="">Unassigned</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} - {t.role}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="due_date">
                Due date
              </label>
              <input id="due_date" name="due_date" type="date" className="input" />
            </div>
          </div>

          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <Link href="/app/work-orders" className="btn-secondary">
              Cancel
            </Link>
            <button type="submit" className="btn-primary">
              Create work order
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

import Link from "next/link";
import { AssetStatusChip, RiskBar, RiskChip } from "@/components/badges";
import { fmtNumber } from "@/lib/format";
import { getAssets, getLocations } from "@/lib/queries";
import { RISK_BAND_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Assets" };

const TYPES = ["engine", "generator", "compressor", "pump", "motor"];
const BANDS = ["critical", "high", "medium", "low"];

interface SearchParams {
  q?: string;
  type?: string;
  location?: string;
  band?: string;
}

function FilterSelect({
  name,
  value,
  options,
  placeholder,
}: {
  name: string;
  value?: string;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <select
      name={name}
      defaultValue={value ?? ""}
      className="input h-9 w-auto cursor-pointer pr-8 capitalize"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="capitalize">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default async function AssetsPage(
  props: {
    searchParams: Promise<SearchParams>;
  }
) {
  const searchParams = await props.searchParams;
  const assets = getAssets(searchParams);
  const locations = getLocations();
  const hasFilters = Boolean(
    searchParams.q || searchParams.type || searchParams.location || searchParams.band,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assets</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {fmtNumber(assets.length)} asset{assets.length === 1 ? "" : "s"}
            {hasFilters ? " matching filters" : " under monitoring"}, sorted by
            failure risk.
          </p>
        </div>
        <form method="GET" className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={searchParams.q ?? ""}
            placeholder="Search name, ID, model..."
            className="input h-9 w-52"
          />
          <FilterSelect
            name="type"
            value={searchParams.type}
            placeholder="All types"
            options={TYPES.map((t) => ({ value: t, label: t }))}
          />
          <FilterSelect
            name="location"
            value={searchParams.location}
            placeholder="All locations"
            options={locations.map((l) => ({ value: l, label: l }))}
          />
          <FilterSelect
            name="band"
            value={searchParams.band}
            placeholder="All risk bands"
            options={BANDS.map((b) => ({
              value: b,
              label: RISK_BAND_LABELS[b as keyof typeof RISK_BAND_LABELS],
            }))}
          />
          <button type="submit" className="btn-secondary h-9">
            Apply
          </button>
          {hasFilters && (
            <Link
              href="/app/assets"
              className="text-xs font-medium text-forest hover:underline"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Type</th>
                <th>Model</th>
                <th>Location</th>
                <th className="text-right">Run hours</th>
                <th>Status</th>
                <th>Band</th>
                <th className="text-right">Risk</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="hover:bg-cream/60">
                  <td>
                    <Link
                      href={`/app/assets/${a.id}`}
                      className="font-medium text-forest hover:underline"
                    >
                      {a.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-ink-faint">
                      {a.id}
                    </span>
                  </td>
                  <td className="capitalize text-ink-soft">{a.type}</td>
                  <td className="text-ink-soft">{a.model}</td>
                  <td className="text-ink-soft">{a.location}</td>
                  <td className="text-right font-mono text-ink-soft">
                    {fmtNumber(a.run_hours)}
                  </td>
                  <td>
                    <AssetStatusChip status={a.status} />
                  </td>
                  <td>
                    <RiskChip band={a.risk_band} />
                  </td>
                  <td>
                    <RiskBar
                      score={a.risk_score}
                      band={a.risk_band}
                      className="justify-end"
                    />
                  </td>
                </tr>
              ))}
              {assets.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-ink-faint">
                    No assets match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

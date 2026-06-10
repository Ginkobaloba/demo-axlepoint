import Link from "next/link";
import { MapPin } from "lucide-react";
import { fmtIsoDate } from "@/lib/format";
import { getTechnicians } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Team" };

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
}

export default function TeamPage() {
  const technicians = getTechnicians();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Technicians</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {technicians.length} field and reliability staff across 8 sites.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {technicians.map((t) => {
          const certs = JSON.parse(t.certifications) as string[];
          return (
            <div key={t.id} className="card p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-forest font-semibold text-cream">
                  {initials(t.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.name}</p>
                  <p className="text-sm text-ink-soft">{t.role}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-faint">
                    <MapPin className="h-3 w-3" />
                    {t.location}
                  </p>
                </div>
                <Link
                  href={`/app/work-orders`}
                  className="ml-auto shrink-0 rounded-md bg-cream px-2 py-1 text-center"
                  title="Open work orders assigned"
                >
                  <span className="block font-mono text-lg font-semibold leading-none text-forest">
                    {t.open_orders}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">
                    open
                  </span>
                </Link>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {certs.map((c) => (
                  <span
                    key={c}
                    className="chip border border-line bg-cream text-ink-soft"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <p className="mt-3 border-t border-line/60 pt-2 text-xs text-ink-faint">
                {t.email} - since {fmtIsoDate(t.hired_on)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

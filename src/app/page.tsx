import {
  Activity,
  ArrowRight,
  BellRing,
  CalendarCheck,
  ClipboardList,
  Gauge,
  PackageSearch,
  ShieldCheck,
  TrendingDown,
} from "lucide-react";
import { Wordmark } from "@/components/brand";
import { PortalHandoffClaim } from "@/components/portal-handoff-claim";

export const dynamic = "force-static";

function SignInButton({ label = "Sign in as demo user" }: { label?: string }) {
  return (
    <form method="POST" action="/api/session">
      <button type="submit" className="btn-primary">
        {label}
        <ArrowRight className="h-4 w-4" />
      </button>
    </form>
  );
}

const PREVIEW_ROWS: [string, string, number, string, string][] = [
  // name, site, score, bar color class, text color class
  ["Engine 07", "Lake Erie Power Station", 88, "bg-risk-critical", "text-risk-critical"],
  ["Compressor 03", "Tucson Mining Site 4", 64, "bg-risk-high", "text-risk-high"],
  ["Engine 22", "Galveston Marine Yard", 41, "bg-risk-medium", "text-risk-medium"],
  ["Generator 11", "Pittsburgh Generating", 12, "bg-risk-low", "text-risk-low"],
];

const FEATURES = [
  {
    icon: Gauge,
    title: "Predictive failure risk scoring",
    body: "Every asset carries a live 0-100 risk score built from streaming sensor data. A rolling anomaly detector watches vibration, temperature, pressure, and fuel signatures, then explains exactly which channels are driving the score, so your team acts on evidence instead of intuition.",
  },
  {
    icon: ClipboardList,
    title: "Work orders that close the loop",
    body: "From anomaly to assignment in one click. AxlePoint drafts preventive work orders straight from detected sensor patterns, routes them to the right technician, and tracks every order through parts holds to completion.",
  },
  {
    icon: PackageSearch,
    title: "Parts and compliance readiness",
    body: "Long-lead components are tracked against reorder points before they become downtime. Preventive schedules, inspection records, and service history live beside the asset, ready for ABS, DNV, NRC, or MSHA review.",
  },
];

const STATS = [
  { value: "12,400+", label: "assets under monitoring" },
  { value: "31%", label: "fewer unplanned outages" },
  { value: "98.2%", label: "PM schedule compliance" },
  { value: "22 min", label: "median anomaly-to-order time" },
];

const SECONDARY = [
  {
    icon: Activity,
    title: "Sensor-native",
    body: "Hourly vibration, temperature, oil pressure, cylinder pressure, speed, and fuel telemetry on every connected unit.",
  },
  {
    icon: BellRing,
    title: "Explainable alerts",
    body: "Every flag shows the reading, the expected baseline, and the deviation that tripped it. No black boxes.",
  },
  {
    icon: CalendarCheck,
    title: "Schedule-aware",
    body: "Preventive calendars, technician load, and parts lead times in one view, so planning reflects reality.",
  },
  {
    icon: ShieldCheck,
    title: "Audit-ready",
    body: "Service history and inspection trails stay attached to the asset for the life of the unit.",
  },
];

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-cream pb-12 text-ink">
      {/* Portal handoff claim. Renders nothing unless arriving with a
          #portal_token fragment from the Paradigm Portal. */}
      <PortalHandoffClaim />

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-line bg-cream/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Wordmark />
          <nav className="hidden items-center gap-6 text-sm font-medium text-ink-soft md:flex">
            <a href="#platform" className="hover:text-forest">
              Platform
            </a>
            <a href="#capabilities" className="hover:text-forest">
              Capabilities
            </a>
            <a href="#results" className="hover:text-forest">
              Results
            </a>
          </nav>
          <SignInButton />
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-forest/20 bg-forest-tint px-3 py-1 text-xs font-semibold text-forest">
              <TrendingDown className="h-3.5 w-3.5" />
              Built to take downtime off the table
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Asset health and maintenance operations for{" "}
              <span className="text-forest">heavy industry</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              AxlePoint watches every engine, generator, compressor, and pump
              in your fleet, scores failure risk before it becomes failure,
              and turns anomalies into scheduled work. Marine, power, mining,
              and rail operations run on machines. We keep the machines
              running.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <SignInButton label="Open the live demo" />
              <a href="#platform" className="btn-secondary">
                See the platform
              </a>
            </div>
            <p className="mt-4 text-xs text-ink-faint">
              The demo opens instantly. No account, no email, synthetic data.
            </p>
          </div>

          {/* Stylized product preview */}
          <div className="card overflow-hidden shadow-raised">
            <div className="flex items-center justify-between border-b border-line bg-panel px-4 py-3">
              <span className="text-sm font-semibold">Fleet risk overview</span>
              <span className="chip bg-gold-tint text-ink-soft">
                Live telemetry
              </span>
            </div>
            <div className="space-y-3 bg-panel p-4">
              {PREVIEW_ROWS.map(([name, site, score, barClass, textClass]) => (
                <div
                  key={name}
                  className="flex items-center gap-3 rounded-md border border-line/70 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{name}</p>
                    <p className="truncate text-xs text-ink-faint">{site}</p>
                  </div>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full rounded-full ${barClass}`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  <span
                    className={`w-8 text-right font-mono text-sm font-semibold ${textClass}`}
                  >
                    {score}
                  </span>
                </div>
              ))}
              <p className="pt-1 text-center text-xs text-ink-faint">
                Failure risk scores, updated with every sensor reading
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section id="results" className="border-y border-line bg-forest">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="font-mono text-3xl font-semibold text-cream">
                {s.value}
              </p>
              <p className="mt-1 text-sm text-cream/70">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature blocks */}
      <section id="platform" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight">
          One platform from sensor to sign-off
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-ink-soft">
          AxlePoint connects condition monitoring, maintenance execution, and
          parts readiness so reliability work happens before the failure, not
          after it.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6">
              <div className="mb-4 inline-flex rounded-lg bg-forest-tint p-2.5 text-forest">
                <f.icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Secondary capabilities */}
      <section
        id="capabilities"
        className="border-t border-line bg-panel py-20"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {SECONDARY.map((f) => (
              <div key={f.title}>
                <div className="mb-3 inline-flex rounded-lg border border-line p-2 text-forest">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-3xl font-bold tracking-tight">
          See it with a fleet already loaded
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-ink-soft">
          The demo environment carries 100 assets across eight sites, six
          months of sensor history, and a live anomaly feed. Open it and go
          straight to the dashboard.
        </p>
        <div className="mt-8 flex justify-center">
          <SignInButton label="Open the live demo" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-ink-faint sm:flex-row sm:px-6">
          <Wordmark subtitle={false} />
          <p>
            AxlePoint Industrial is a fictional product demo.{" "}
            <a
              href="https://projectnexuscode.org"
              className="font-medium text-forest hover:underline"
            >
              Built by Paradigm Coding Solutions
            </a>
            . All data is synthetic.
          </p>
        </div>
      </footer>
    </div>
  );
}

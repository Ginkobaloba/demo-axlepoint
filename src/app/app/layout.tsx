import Link from "next/link";
import { FlaskConical, LogOut, Search } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { SidebarNav } from "@/components/sidebar-nav";

export const metadata = {
  title: "Operations",
};

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-cream pb-12">
      {/* Synthetic data notice */}
      <div className="flex h-7 items-center justify-center gap-1.5 bg-gold/20 px-3 text-xs font-medium text-ink-soft">
        <FlaskConical className="h-3 w-3" />
        This is a demo environment with synthetic data.
      </div>

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-line bg-cream/95 backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <Link href="/app" aria-label="AxlePoint dashboard">
            <Wordmark subtitle={false} />
          </Link>
          <form
            action="/app/assets"
            method="GET"
            className="relative ml-auto hidden w-72 md:block"
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              type="search"
              name="q"
              placeholder="Search assets, models, IDs..."
              className="input h-9 pl-8"
            />
          </form>
          <span className="chip ml-auto bg-forest/10 font-mono text-forest md:ml-0">
            demo user
          </span>
          <form method="POST" action="/api/session?signout=1">
            <button
              type="submit"
              className="btn-secondary h-9 px-3 text-xs"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Shell */}
      <div className="lg:flex">
        <aside className="border-b border-line lg:min-h-[calc(100vh-5.25rem)] lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r lg:p-4">
          <SidebarNav />
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

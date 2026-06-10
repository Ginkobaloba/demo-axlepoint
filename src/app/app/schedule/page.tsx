import Link from "next/link";
import { addDays, format, isSameDay, startOfWeek } from "date-fns";
import { cn } from "@/lib/cn";
import { getGeneratedAt, getSchedule } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Schedule" };

export default function SchedulePage() {
  const entries = getSchedule();
  const today = new Date(getGeneratedAt() * 1000);
  today.setHours(0, 0, 0, 0);
  const horizon = addDays(today, 30);

  // 6 calendar weeks starting the Monday of the current week.
  const gridStart = startOfWeek(today, { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const entriesFor = (day: Date) =>
    entries.filter((e) => isSameDay(new Date(`${e.next_due}T00:00:00`), day));

  const inWindow = (day: Date) => day >= today && day <= horizon;

  const upcoming = entries.filter((e) => {
    const d = new Date(`${e.next_due}T00:00:00`);
    return d >= today && d <= horizon;
  });
  const totalHours = upcoming.reduce((s, e) => s + e.est_hours, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Preventive maintenance schedule
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {upcoming.length} tasks and {Math.round(totalHours)} labor hours
          scheduled over the next 30 days.
        </p>
      </div>

      {/* Calendar */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-cream/60 text-center text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const dayEntries = entriesFor(day);
            const isToday = isSameDay(day, today);
            const active = inWindow(day);
            return (
              <div
                key={i}
                className={cn(
                  "min-h-24 border-b border-r border-line/60 p-1.5 [&:nth-child(7n)]:border-r-0",
                  !active && "bg-cream/50",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-mono text-xs",
                    isToday
                      ? "bg-forest font-semibold text-cream"
                      : active
                        ? "text-ink-soft"
                        : "text-ink-faint",
                  )}
                >
                  {format(day, "d")}
                </span>
                {format(day, "d") === "1" && (
                  <span className="ml-1 text-xs font-semibold text-ink-faint">
                    {format(day, "MMM")}
                  </span>
                )}
                <div className="mt-1 space-y-1">
                  {dayEntries.slice(0, 3).map((e) => (
                    <Link
                      key={e.id}
                      href={`/app/assets/${e.asset_id}`}
                      title={`${e.task} - ${e.asset_name} (${e.asset_location})`}
                      className={cn(
                        "block truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight",
                        active
                          ? "bg-forest-tint text-forest hover:bg-forest hover:text-cream"
                          : "bg-line/50 text-ink-faint",
                      )}
                    >
                      {e.asset_name}: {e.task}
                    </Link>
                  ))}
                  {dayEntries.length > 3 && (
                    <p className="px-1.5 text-[11px] text-ink-faint">
                      +{dayEntries.length - 3} more
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* List view (also serves small screens) */}
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Next 30 days, by date</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Due</th>
                <th>Task</th>
                <th>Asset</th>
                <th>Site</th>
                <th>Assigned</th>
                <th className="text-right">Est. hours</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((e) => (
                <tr key={e.id} className="hover:bg-cream/60">
                  <td className="font-mono text-xs text-ink-soft">
                    {format(new Date(`${e.next_due}T00:00:00`), "MMM d")}
                  </td>
                  <td className="font-medium">{e.task}</td>
                  <td>
                    <Link
                      href={`/app/assets/${e.asset_id}`}
                      className="text-forest hover:underline"
                    >
                      {e.asset_name}
                    </Link>
                  </td>
                  <td className="text-ink-soft">{e.asset_location}</td>
                  <td className="text-ink-soft">
                    {e.technician_name ?? (
                      <span className="text-ink-faint">Unassigned</span>
                    )}
                  </td>
                  <td className="text-right font-mono">{e.est_hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

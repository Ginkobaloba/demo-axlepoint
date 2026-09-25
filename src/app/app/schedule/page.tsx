import { addDays } from "date-fns";
import { ScheduleBoard } from "@/components/schedule-board";
import { getGeneratedAt, getSchedule } from "@/lib/queries";
import { withCurrentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export const metadata = { title: "Schedule" };

export default async function SchedulePage() {
  // One transaction for both reads, so the board and its "today" marker
  // come from the same snapshot.
  const { entries, generatedAt } = await withCurrentTenant(async (db) => ({
    entries: await getSchedule(db),
    generatedAt: await getGeneratedAt(db),
  }));
  const todayMs = generatedAt * 1000;
  const today = new Date(todayMs);
  today.setHours(0, 0, 0, 0);
  const horizon = addDays(today, 30);

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
          {upcoming.length} tasks and {Math.round(totalHours)} labor hours over
          the next 30 days. Switch views, or drag a task to reschedule it.
        </p>
      </div>

      <ScheduleBoard entries={entries} todayMs={todayMs} />
    </div>
  );
}

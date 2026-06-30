/**
 * Pure helpers for the schedule board: technician load aggregation and date
 * validation. Kept out of the client component so they can be unit-tested.
 */

export interface ScheduleLike {
  technician_name: string | null;
  est_hours: number;
  next_due: string;
}

export interface TechnicianLoad {
  name: string;
  taskCount: number;
  hours: number;
}

/**
 * Aggregate scheduled tasks into per-technician load, sorted by hours
 * descending. Unassigned tasks bucket under "Unassigned" and sort last.
 */
export function technicianLoad(entries: ScheduleLike[]): TechnicianLoad[] {
  const map = new Map<string, TechnicianLoad>();
  for (const e of entries) {
    const name = e.technician_name ?? "Unassigned";
    const cur = map.get(name) ?? { name, taskCount: 0, hours: 0 };
    cur.taskCount += 1;
    cur.hours += e.est_hours;
    map.set(name, cur);
  }
  return [...map.values()].sort((a, b) => {
    if (a.name === "Unassigned") return 1;
    if (b.name === "Unassigned") return -1;
    return b.hours - a.hours;
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a YYYY-MM-DD string and confirm it is a real calendar date
 * (rejects 2026-02-30 etc).
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  // Round-trip guard against overflow normalization (Feb 30 -> Mar 2).
  const [y, m, day] = value.split("-").map(Number);
  return (
    d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day
  );
}

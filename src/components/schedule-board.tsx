"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ScheduleEntry } from "@/lib/queries";
import { technicianLoad } from "@/lib/schedule-view";

type View = "month" | "week" | "day" | "load";

const VIEWS: { key: View; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
  { key: "load", label: "By technician" },
];

function parseDue(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

export function ScheduleBoard({
  entries,
  todayMs,
}: {
  entries: ScheduleEntry[];
  todayMs: number;
}) {
  const today = new Date(todayMs);
  today.setHours(0, 0, 0, 0);

  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState<Date>(today);
  const [items, setItems] = useState<ScheduleEntry[]>(entries);
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep local state in sync with refreshed server data.
  useEffect(() => setItems(entries), [entries]);

  const entriesFor = (day: Date) =>
    items.filter((e) => isSameDay(parseDue(e.next_due), day));

  const reschedule = async (id: string, day: Date) => {
    const iso = format(day, "yyyy-MM-dd");
    const prev = items;
    setItems((cur) =>
      cur.map((e) => (e.id === id ? { ...e, next_due: iso } : e)),
    );
    setError(null);
    try {
      const res = await fetch(`/api/schedule/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ next_due: iso }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Failed (${res.status})`);
      }
    } catch (e) {
      setItems(prev); // revert optimistic move
      setError(e instanceof Error ? e.message : "Could not reschedule.");
    }
  };

  const step = (dir: 1 | -1) => {
    if (view === "month") setAnchor((a) => addMonths(a, dir));
    else if (view === "week") setAnchor((a) => addWeeks(a, dir));
    else setAnchor((a) => addDays(a, dir));
  };

  const rangeLabel =
    view === "month"
      ? format(anchor, "MMMM yyyy")
      : view === "week"
        ? `Week of ${format(startOfWeek(anchor, { weekStartsOn: 1 }), "MMM d, yyyy")}`
        : format(anchor, "EEEE, MMM d, yyyy");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-md border border-line p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn(
                "rounded px-3 py-1.5 text-sm font-medium transition-colors",
                view === v.key
                  ? "bg-forest text-cream"
                  : "text-ink-soft hover:text-ink",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view !== "load" && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous"
              className="btn-secondary px-2 py-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setAnchor(today)}
              className="btn-secondary px-3 py-1.5 text-sm"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next"
              className="btn-secondary px-2 py-1.5"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="ml-1 text-sm font-semibold text-ink">
              {rangeLabel}
            </span>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-risk-high/30 bg-risk-high/10 px-3 py-2 text-xs font-medium text-risk-high">
          {error}
        </p>
      )}

      {view !== "load" && view !== "day" && (
        <p className="text-xs text-ink-faint">
          Drag a task to another day to reschedule it.
        </p>
      )}

      {view === "month" && (
        <MonthView
          anchor={anchor}
          today={today}
          entriesFor={entriesFor}
          dragId={dragId}
          setDragId={setDragId}
          onDropDay={reschedule}
        />
      )}
      {view === "week" && (
        <WeekView
          anchor={anchor}
          today={today}
          entriesFor={entriesFor}
          dragId={dragId}
          setDragId={setDragId}
          onDropDay={reschedule}
        />
      )}
      {view === "day" && (
        <DayView anchor={anchor} today={today} entriesFor={entriesFor} />
      )}
      {view === "load" && <LoadView entries={items} />}
    </div>
  );
}

// ----------------------------------------------------------------- chips

function TaskChip({
  entry,
  draggable,
  onDragStart,
  onDragEnd,
  dragging,
  detailed,
}: {
  entry: ScheduleEntry;
  draggable: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  detailed?: boolean;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", entry.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      title={`${entry.task} - ${entry.asset_name} (${entry.asset_location})${
        entry.technician_name ? ` - ${entry.technician_name}` : ""
      } - ${entry.est_hours}h`}
      className={cn(
        "group flex items-start gap-1 rounded bg-forest-tint px-1.5 py-1 text-[11px] font-medium leading-tight text-forest",
        draggable && "cursor-move hover:bg-forest hover:text-cream",
        dragging && "opacity-40",
      )}
    >
      {draggable && (
        <GripVertical className="mt-0.5 h-3 w-3 shrink-0 opacity-40 group-hover:opacity-80" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{entry.asset_name}</span>
        <span className="block truncate opacity-80">{entry.task}</span>
        {detailed && (
          <span className="block truncate opacity-70">
            {entry.technician_name ?? "Unassigned"} - {entry.est_hours}h
          </span>
        )}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------- views

interface GridProps {
  anchor: Date;
  today: Date;
  entriesFor: (day: Date) => ScheduleEntry[];
  dragId: string | null;
  setDragId: (id: string | null) => void;
  onDropDay: (id: string, day: Date) => void;
}

function DayCell({
  day,
  today,
  inScope,
  entries,
  dragId,
  setDragId,
  onDropDay,
  max,
  minHeight,
}: {
  day: Date;
  today: Date;
  inScope: boolean;
  entries: ScheduleEntry[];
  dragId: string | null;
  setDragId: (id: string | null) => void;
  onDropDay: (id: string, day: Date) => void;
  max: number;
  minHeight: string;
}) {
  const [over, setOver] = useState(false);
  const isToday = isSameDay(day, today);
  const shown = entries.slice(0, max);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDropDay(id, day);
      }}
      className={cn(
        "border-b border-r border-line/60 p-1.5 [&:nth-child(7n)]:border-r-0",
        minHeight,
        !inScope && "bg-cream/50",
        over && "bg-forest/10 ring-1 ring-inset ring-forest",
      )}
    >
      <span
        className={cn(
          "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-mono text-xs",
          isToday
            ? "bg-forest font-semibold text-cream"
            : inScope
              ? "text-ink-soft"
              : "text-ink-faint",
        )}
      >
        {format(day, "d")}
      </span>
      <div className="mt-1 space-y-1">
        {shown.map((e) => (
          <TaskChip
            key={e.id}
            entry={e}
            draggable
            dragging={dragId === e.id}
            onDragStart={() => setDragId(e.id)}
            onDragEnd={() => setDragId(null)}
          />
        ))}
        {entries.length > max && (
          <p className="px-1 text-[11px] text-ink-faint">
            +{entries.length - max} more
          </p>
        )}
      </div>
    </div>
  );
}

function WeekdayHeader() {
  return (
    <div className="grid grid-cols-7 border-b border-line bg-cream/60 text-center text-xs font-semibold uppercase tracking-wide text-ink-faint">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
        <div key={d} className="py-2">
          {d}
        </div>
      ))}
    </div>
  );
}

function MonthView({
  anchor,
  today,
  entriesFor,
  dragId,
  setDragId,
  onDropDay,
}: GridProps) {
  const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
  const monthEnd = endOfMonth(anchor);
  const weeks = Math.ceil(
    (monthEnd.getTime() - gridStart.getTime()) / (7 * 86400000),
  );
  const cells = Math.max(35, weeks * 7);
  const days = Array.from({ length: cells }, (_, i) => addDays(gridStart, i));

  return (
    <div className="card overflow-hidden">
      <WeekdayHeader />
      <div className="grid grid-cols-7">
        {days.map((day, i) => (
          <DayCell
            key={i}
            day={day}
            today={today}
            inScope={isSameMonth(day, anchor)}
            entries={entriesFor(day)}
            dragId={dragId}
            setDragId={setDragId}
            onDropDay={onDropDay}
            max={3}
            minHeight="min-h-24"
          />
        ))}
      </div>
    </div>
  );
}

function WeekView({
  anchor,
  today,
  entriesFor,
  dragId,
  setDragId,
  onDropDay,
}: GridProps) {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="card overflow-hidden">
      <WeekdayHeader />
      <div className="grid grid-cols-7">
        {days.map((day, i) => (
          <DayCell
            key={i}
            day={day}
            today={today}
            inScope
            entries={entriesFor(day)}
            dragId={dragId}
            setDragId={setDragId}
            onDropDay={onDropDay}
            max={12}
            minHeight="min-h-64"
          />
        ))}
      </div>
    </div>
  );
}

function DayView({
  anchor,
  today,
  entriesFor,
}: {
  anchor: Date;
  today: Date;
  entriesFor: (day: Date) => ScheduleEntry[];
}) {
  const entries = entriesFor(anchor);
  const hours = entries.reduce((s, e) => s + e.est_hours, 0);
  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">
          {isSameDay(anchor, today) ? "Today" : format(anchor, "EEEE, MMM d")}
        </h2>
        <span className="text-xs text-ink-faint">
          {entries.length} tasks - {Math.round(hours)}h
        </span>
      </div>
      <div className="divide-y divide-line/60">
        {entries.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-faint">
            No maintenance scheduled for this day.
          </p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{e.task}</p>
                <p className="text-sm text-ink-soft">
                  <Link
                    href={`/app/assets/${e.asset_id}`}
                    className="text-forest hover:underline"
                  >
                    {e.asset_name}
                  </Link>{" "}
                  - {e.asset_location}
                </p>
              </div>
              <div className="text-right text-xs text-ink-faint">
                <p>{e.technician_name ?? "Unassigned"}</p>
                <p className="font-mono">{e.est_hours}h</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LoadView({ entries }: { entries: ScheduleEntry[] }) {
  const load = technicianLoad(entries);
  const maxHours = Math.max(1, ...load.map((l) => l.hours));
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">
          Technician load (all scheduled tasks)
        </h2>
      </div>
      <div className="divide-y divide-line/60">
        {load.map((l) => (
          <div key={l.name} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-ink">{l.name}</span>
              <span className="font-mono text-xs text-ink-soft">
                {l.taskCount} tasks - {Math.round(l.hours)}h
              </span>
            </div>
            <span className="mt-1.5 block h-2 w-full overflow-hidden rounded-full bg-line">
              <span
                className={cn(
                  "block h-full rounded-full",
                  l.name === "Unassigned" ? "bg-ink-faint" : "bg-forest",
                )}
                style={{ width: `${(l.hours / maxHours) * 100}%` }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

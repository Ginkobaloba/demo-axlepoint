"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Users,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/app/assets", label: "Assets", icon: Boxes },
  { href: "/app/work-orders", label: "Work Orders", icon: ClipboardList },
  { href: "/app/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/app/parts", label: "Parts", icon: Wrench },
  { href: "/app/team", label: "Team", icon: Users },
  { href: "/app/reports", label: "Reports", icon: BarChart3 },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-row gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:px-0 lg:py-0">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-forest text-cream"
                : "text-ink-soft hover:bg-forest/10 hover:text-forest",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

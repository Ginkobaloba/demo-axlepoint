import { format, formatDistanceToNowStrict } from "date-fns";

export function fmtDate(tsSeconds: number): string {
  return format(new Date(tsSeconds * 1000), "MMM d, yyyy");
}

export function fmtDateTime(tsSeconds: number): string {
  return format(new Date(tsSeconds * 1000), "MMM d, yyyy HH:mm");
}

export function fmtAgo(tsSeconds: number): string {
  return formatDistanceToNowStrict(new Date(tsSeconds * 1000), {
    addSuffix: true,
  });
}

export function fmtIsoDate(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), "MMM d, yyyy");
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

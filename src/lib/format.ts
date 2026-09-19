import { formatDistanceToNowStrict } from "date-fns";

// These formatters are shared by server-rendered pages and client
// components (e.g. work-orders-table.tsx). date-fns' `format` reads the
// *host* timezone, which differs between the server (container, usually
// UTC) and the browser (visitor's local zone) -- a date near a local
// midnight boundary can render on different calendar days on each side
// and trip React hydration error #418. Pinning locale + timeZone to a
// fixed value here makes the output identical everywhere the same
// timestamp is formatted, regardless of host or browser settings.
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function fmtDate(tsSeconds: number): string {
  return DATE_FORMATTER.format(new Date(tsSeconds * 1000));
}

export function fmtDateTime(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  return `${DATE_FORMATTER.format(d)} ${TIME_FORMATTER.format(d)}`;
}

export function fmtAgo(tsSeconds: number): string {
  return formatDistanceToNowStrict(new Date(tsSeconds * 1000), {
    addSuffix: true,
  });
}

export function fmtIsoDate(iso: string): string {
  return DATE_FORMATTER.format(new Date(`${iso}T00:00:00Z`));
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

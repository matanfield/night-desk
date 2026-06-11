// Hotel-night date logic. An inventory row for date D covers the night that
// begins on D (afternoon D until noon D+1). A caller at 02:00 asking for a
// room "tonight" means the night that began YESTERDAY by calendar date —
// the cutover is 08:00 local: before it, "tonight" is still the previous date.

const NIGHT_CUTOVER_HOUR = 8;

export function localNow(timezone: string): { isoDate: string; hour: number; pretty: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const isoDate = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour")) % 24; // Intl can emit "24" for midnight
  const pretty = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { isoDate, hour, pretty };
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function tonightDate(timezone: string): string {
  const { isoDate, hour } = localNow(timezone);
  return hour < NIGHT_CUTOVER_HOUR ? addDays(isoDate, -1) : isoDate;
}

// Voice models pass loose date inputs; accept the easy words plus ISO dates.
export function resolveCheckIn(input: string | undefined, timezone: string): string | null {
  const tonight = tonightDate(timezone);
  const v = (input ?? "tonight").trim().toLowerCase();
  if (v === "" || v === "tonight" || v === "today" || v === "now") return tonight;
  if (v === "tomorrow") return addDays(tonight, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(`${checkIn}T12:00:00Z`).getTime();
  const b = new Date(`${checkOut}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function prettyDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

export function eur(cents: number): string {
  return `${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)} EUR`;
}

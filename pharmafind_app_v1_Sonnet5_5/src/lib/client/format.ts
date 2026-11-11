/**
 * Display helpers. IMPORTANT: ages are NEVER computed from this device's clock. The server sends `ageMinutes`
 * (measured on its own clock, the same clock that decides "stale"), so text and stale flag cannot disagree,
 * not even when the demo fast-forwards server time.
 */
export function formatAge(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export const formatPrice = (n: number) => `$${n.toFixed(2)}`;

/** Absolute timestamp for tooltips (a fixed moment, so it is not affected by device-vs-server clock differences). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const stockLabel = (status: "in_stock" | "low_stock" | "out_of_stock", stock: number) =>
  status === "out_of_stock" ? "Out of stock" : status === "low_stock" ? `Low stock (${stock})` : `In stock (${stock})`;

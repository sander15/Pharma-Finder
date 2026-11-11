/** Browser-side wrapper around the Pharmafind REST API (same-origin; the session lives in an HttpOnly cookie). */

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface ApiResult<T> {
  data: T;
  /** The SERVER clock at the time of the answer (can differ from this device's clock in the demo). */
  serverNow: string;
}

export async function api<T>(method: string, path: string, opts: { query?: Record<string, string | undefined>; body?: unknown } = {}): Promise<ApiResult<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") qs.set(k, v);
  const url = qs.size ? `${path}?${qs}` : path;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "You appear to be offline. Check your connection and try again.");
  }
  let json: { ok?: boolean; data?: T; serverNow?: string; error?: { code: string; message: string } } | null = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON answer */
  }
  if (!res.ok || !json?.ok) throw new ApiError(res.status, json?.error?.code ?? "ERROR", json?.error?.message ?? "Something went wrong. Please try again.");
  return { data: json.data as T, serverNow: json.serverNow ?? new Date().toISOString() };
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong");

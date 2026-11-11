import { NextResponse, type NextRequest } from "next/server";
import { getApp } from "@/lib/getApp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "pf_session";

/** Thin HTTP adapter: turns a Next request into an ApiRequest for the REST API layer and back. */
async function handle(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const result = await getApp().api.handle({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    rawBody: hasBody ? await req.text() : undefined,
    token: req.cookies.get(COOKIE)?.value,
    authorization: req.headers.get("authorization") ?? undefined,
  });
  const res = NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  if (result.setSession?.token) {
    res.cookies.set(COOKIE, result.setSession.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: result.setSession.maxAgeSec,
    });
  } else if (result.setSession?.clear) {
    res.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  }
  return res;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;

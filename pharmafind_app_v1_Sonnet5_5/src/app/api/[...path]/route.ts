import { getApp } from "@/lib/app";

// Node runtime (uses node:crypto); never statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = (req: Request) => getApp().api.handle(req);

export { handler as GET, handler as POST, handler as PUT, handler as DELETE };

import { createApp, type App } from "./app";

const g = globalThis as unknown as { __pharmafindApp?: App };

/**
 * One mock backend per server instance (survives hot reloads in dev).
 * Demo caveat: the mock database lives in memory, so it resets on a cold start and is not shared between serverless instances.
 */
export function getApp(): App {
  return (g.__pharmafindApp ??= createApp({ sessionSecret: process.env.SESSION_SECRET || undefined, autoTick: true }));
}

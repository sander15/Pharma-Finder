"use client";
import { useEffect } from "react";

/** Registers the service worker (production only, so dev hot-reload is never served from a cache). */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* the app works fine without it */
    });
  }, []);
  return null;
}

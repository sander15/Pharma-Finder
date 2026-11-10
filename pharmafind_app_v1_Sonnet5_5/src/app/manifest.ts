import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pharmafind",
    short_name: "Pharmafind",
    description: "Find which verified pharmacies have your medicine in stock, compare price and presentation, and get directions.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f8f7",
    theme_color: "#0f766e",
    categories: ["medical", "health", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Pharmacy portal", short_name: "Portal", url: "/portal" },
    ],
  };
}

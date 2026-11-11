import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pharmafind",
    short_name: "Pharmafind",
    description: "Find which nearby verified pharmacies have your medicine in stock, compare presentations and prices, and get directions.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f7f7",
    theme_color: "#0f766e",
    categories: ["health", "medical", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Search medicines", url: "/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Pharmacy portal", url: "/portal", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}

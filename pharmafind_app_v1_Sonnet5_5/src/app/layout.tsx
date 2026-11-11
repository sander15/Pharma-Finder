import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pharmafind - find your medicine nearby", template: "%s | Pharmafind" },
  description: "Search for a medicine and see which nearby verified pharmacies have it in stock, with presentation, price and directions.",
  applicationName: "Pharmafind",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Pharmafind", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#0f766e" }, { media: "(prefers-color-scheme: dark)", color: "#0d1517" }],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main className="container">{children}</main>
        <footer className="container muted">
          <small>Demo build: all data, pharmacies and external systems (POS, drug database, licensing registry, maps, e-mail) are simulated.</small>
        </footer>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

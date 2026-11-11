import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pharmafind — encuentra tu medicina",
  description: "Compara disponibilidad, presentación y precio en farmacias verificadas cerca de ti.",
  applicationName: "Pharmafind",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Pharmafind" },
};

export const viewport: Viewport = { themeColor: "#f4f8f7", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}

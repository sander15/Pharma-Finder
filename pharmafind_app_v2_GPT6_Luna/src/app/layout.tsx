import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Pharmafind | Find medicine nearby', description: 'Compare medicine availability at nearby verified pharmacies.', manifest: '/manifest.webmanifest', applicationName: 'Pharmafind' };
export const viewport: Viewport = { themeColor: '#0d6b5f', width: 'device-width', initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}<script dangerouslySetInnerHTML={{ __html: "if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));" }} /></body></html>; }

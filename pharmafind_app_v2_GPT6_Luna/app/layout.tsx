import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata:Metadata={title:"Pharmafind — Find medicine nearby",description:"Compare medicine availability at verified pharmacies nearby.",manifest:"/manifest.webmanifest",appleWebApp:{capable:true,statusBarStyle:"default",title:"Pharmafind"}};
export const viewport:Viewport={themeColor:"#f4f7f5",width:"device-width",initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}

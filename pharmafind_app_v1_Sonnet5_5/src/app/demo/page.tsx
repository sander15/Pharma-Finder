import type { Metadata } from "next";
import DemoPanel from "@/components/DemoPanel";

export const metadata: Metadata = { title: "Demo controls" };

export default function DemoPage() {
  return <DemoPanel />;
}

import type { Metadata } from "next";
import PharmacyPortal from "@/components/PharmacyPortal";

export const metadata: Metadata = { title: "Pharmacy portal" };

export default function PortalPage() {
  return <PharmacyPortal />;
}

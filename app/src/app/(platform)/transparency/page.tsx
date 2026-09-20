import type { Metadata } from "next";
import { Transparency } from "@/components/transparency";
import "./transparency.css";
export const metadata: Metadata = {
  title: "Transparency — HitBite",
  robots: { index: true, follow: true },
  alternates: { canonical: "/transparency" },
};
export default function TransparencyPage() {
  return <Transparency />;
}

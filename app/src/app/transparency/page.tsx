import type { Metadata } from "next";
import { Transparency } from "@/components/transparency";
import "./transparency.css";
export const metadata: Metadata = { title: "Transparency — HitBite" };
export default function TransparencyPage() {
  return <Transparency />;
}

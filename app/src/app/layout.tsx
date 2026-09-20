import type { Metadata } from "next";
import { inter, inconsolata } from "@/lib/fonts";
import { siteUrl } from "@/lib/site";
import { ImageDragGuard } from "@/components/image-drag-guard";
import "./base.css";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "HitBite",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${inconsolata.variable}`}>
      <body>
        <ImageDragGuard />
        {children}
      </body>
    </html>
  );
}

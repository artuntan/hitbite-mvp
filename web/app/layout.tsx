import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HitBite MVP (Testnet)",
  description: "Testnet demonstration. Simulated portfolio. Not an offer of securities.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

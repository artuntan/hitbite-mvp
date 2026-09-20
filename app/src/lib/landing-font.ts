import localFont from "next/font/local";
export const landingFont = localFont({
  src: "../../assets/landing-inter.woff2",
  variable: "--font-landing",
  display: "swap",
  weight: "400 600",
});
export const landingMono = localFont({
  src: "../../assets/landing-inconsolata.woff2",
  variable: "--font-landing-mono",
  display: "swap",
  weight: "400",
  preload: false,
});

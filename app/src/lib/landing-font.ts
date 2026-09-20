import localFont from "next/font/local";
export const landingFont = localFont({
  src: [
    { path: "../../assets/landing-inter-400.woff2", weight: "400" },
    { path: "../../assets/landing-inter-600.woff2", weight: "600" },
  ],
  variable: "--font-landing",
  display: "swap",
});
export const landingMono = localFont({
  src: "../../assets/landing-inconsolata.woff2",
  variable: "--font-landing-mono",
  display: "swap",
  weight: "400",
  preload: false,
});

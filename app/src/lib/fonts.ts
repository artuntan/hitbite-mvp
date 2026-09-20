import localFont from "next/font/local";
export const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
  preload: false,
});
export const inconsolata = localFont({
  src: "../../node_modules/@fontsource-variable/inconsolata/files/inconsolata-latin-wght-normal.woff2",
  variable: "--font-inconsolata",
  display: "swap",
  weight: "200 900",
  preload: false,
});

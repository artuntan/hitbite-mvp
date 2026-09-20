import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { landingCopy } from "@/lib/site";
export const alt = `HitBite — ${landingCopy.headline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default async function OpenGraphImage() {
  const [regular, semibold, logo] = await Promise.all([
    readFile(join(process.cwd(), "assets/Inter-400.ttf")),
    readFile(join(process.cwd(), "assets/Inter-600.ttf")),
    readFile(join(process.cwd(), "assets/hitbite-wordmark.png")),
  ]);
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "48px 56px",
        background: "#ffffff",
        color: "#182435",
        fontFamily: "Inter",
      }}
    >
      <img
        src={`data:image/png;base64,${logo.toString("base64")}`}
        alt="HitBite"
        width={170}
        height={50}
      />
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontSize: 80,
          fontWeight: 600,
          lineHeight: 1.04,
          letterSpacing: -0.8,
        }}
      >
        {landingCopy.headline}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          fontSize: 20,
          color: "#62718a",
        }}
      >
        {landingCopy.disclaimer}
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Inter", data: regular, weight: 400, style: "normal" },
        { name: "Inter", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}

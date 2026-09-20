import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/app", "/transparency"].map((path) => ({
    url: new URL(path, siteUrl).href,
  }));
}

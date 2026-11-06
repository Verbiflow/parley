import type { MetadataRoute } from "next"

// Built to out/sitemap.xml (output: "export"), so search engines get it from itsparley.com rather than the app.
export const dynamic = "force-static"

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://itsparley.com/", changeFrequency: "weekly", priority: 1 }]
}

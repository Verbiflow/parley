import type { MetadataRoute } from "next"

// Built to out/robots.txt (output: "export"). Without it the Worker would send /robots.txt on to the app.
export const dynamic = "force-static"

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: "https://itsparley.com/sitemap.xml" }
}

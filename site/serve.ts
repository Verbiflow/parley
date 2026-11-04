/**
 * The marketing site's Worker (itsparley.com, see wrangler.jsonc). It serves the static build in out/, sends www to
 * the bare domain, and sends any path that isn't a file here to the app, so old links like itsparley.com/app work.
 */
export type Assets = { fetch: (request: Request) => Promise<Response> }

export const APP_URL = "https://app.itsparley.com"

export async function serve(request: Request, assets: Assets): Promise<Response> {
  const url = new URL(request.url)
  if (url.hostname.startsWith("www.")) return Response.redirect(`https://${url.hostname.slice(4)}${url.pathname}${url.search}`, 301)
  const file = await assets.fetch(request)
  if (file.status === 404) return Response.redirect(`${APP_URL}${url.pathname}${url.search}`, 302)
  const res = new Response(file.body, file)
  res.headers.set("x-content-type-options", "nosniff")
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin")
  // Next.js puts a content hash in every /_next/static/ name, so those never change; the page itself can.
  res.headers.set("cache-control", url.pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "public, max-age=300")
  return res
}

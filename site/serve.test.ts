import assert from "node:assert/strict"
import { test } from "node:test"
import { APP_URL, serve } from "./serve.ts"

const FILES: Record<string, string> = { "/": "<h1>landing</h1>", "/_next/static/chunks/a1b2.js": "js" }
const assets = {
  fetch: async (r: Request) => {
    const body = FILES[new URL(r.url).pathname]
    return new Response(body ?? "missing", { status: body ? 200 : 404 })
  },
}
const get = (url: string) => serve(new Request(url), assets)

test("the site serves its files, with long caching only for the hashed ones", async () => {
  const page = await get("https://itsparley.com/")
  assert.equal(page.status, 200)
  assert.equal(await page.text(), "<h1>landing</h1>")
  assert.equal(page.headers.get("cache-control"), "public, max-age=300")
  assert.equal(page.headers.get("x-content-type-options"), "nosniff")
  assert.equal((await get("https://itsparley.com/_next/static/chunks/a1b2.js")).headers.get("cache-control"), "public, max-age=31536000, immutable")
})

test("a path that isn't a file goes to the app, and www goes to the bare domain", async () => {
  const other = await get("https://itsparley.com/app/chats?x=1")
  assert.equal(other.status, 302)
  assert.equal(other.headers.get("location"), `${APP_URL}/app/chats?x=1`)
  const www = await get("https://www.itsparley.com/?ref=a")
  assert.equal(www.status, 301)
  assert.equal(www.headers.get("location"), "https://itsparley.com/?ref=a")
})

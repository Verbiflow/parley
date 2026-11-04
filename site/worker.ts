import { serve, type Assets } from "./serve.ts"

// A Worker treats every named export of this file as an entrypoint, so the logic (and its tests) live in serve.ts.
export default {
  fetch: (request: Request, env: { ASSETS: Assets }) => serve(request, env.ASSETS),
}

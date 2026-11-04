# Parley site

The marketing site for itsparley.com (Next.js). It lives outside the npm workspaces, so it has its own install.

```sh
cd site
npm install
npm run dev -- -p 3000
```

`NEXT_PUBLIC_APP_URL` points the sign-in links and the MCP URL at the app (default `https://app.itsparley.com`).

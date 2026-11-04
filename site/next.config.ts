import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Plain files in out/, served for itsparley.com by the parley-app Worker (apps/api/wrangler.jsonc).
  output: "export",
  allowedDevOrigins: ["127.0.0.1", "*.thread.localhost"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

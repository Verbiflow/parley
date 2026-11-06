# Parley's MCP server over stdio, for registries that build and inspect servers from a Dockerfile (e.g. Glama).
# It lists Parley's real tools without a database or account; using them means the hosted server at
# https://app.itsparley.com/mcp (OAuth). To self-host the full service, see DEVELOPING.md.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/auth/package.json packages/auth/
COPY packages/channels/package.json packages/channels/
COPY packages/pacing/package.json packages/pacing/
COPY packages/proxies/package.json packages/proxies/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY packages packages
COPY apps/api/src apps/api/src
USER node
CMD ["node", "apps/api/src/stdio.ts"]

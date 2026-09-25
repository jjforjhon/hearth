# Hearth — single-service production image.
# One Node process serves: Fastify API + Socket.IO (WSS) + the built web client (SPA),
# with cron-scheduled weekly content generation in-process.
# All persistent state (SQLite WAL database + private media files) lives on a
# mounted volume at /data — survive restarts, redeploys, container replacement.

FROM node:24-slim AS build
# Toolchain for better-sqlite3 if no prebuilt binary matches the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install workspace dependencies first (cacheable layer).
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

# Build shared protocol + web client. The server runs via tsx (no compile step).
COPY . .
RUN npm run build:shared && npm run build:web

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
COPY --from=build /app /app
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "@hearth/server"]

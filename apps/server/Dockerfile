# Build from the repository root: docker build -f apps/server/Dockerfile -t rafflink .

FROM oven/bun:1.4.5 AS install
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/fake-twitch/package.json packages/fake-twitch/
COPY apps/cloudflare/package.json apps/cloudflare/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

FROM install AS build-web
COPY packages/core packages/core
COPY apps/web apps/web
RUN bun run --filter @rafflink/web build

FROM oven/bun:1.4.5 AS run
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/fake-twitch/package.json packages/fake-twitch/
COPY apps/cloudflare/package.json apps/cloudflare/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production
COPY packages packages
COPY apps/server/src apps/server/src
COPY --from=build-web /app/apps/web/dist apps/web/dist
RUN mkdir /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
CMD ["bun", "apps/server/src/main.ts"]

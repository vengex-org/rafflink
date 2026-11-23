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
# The browser's error reporting is written into the page at build time; blank PUBLIC_SENTRY_DSN reports nothing.
ARG PUBLIC_SENTRY_DSN=""
ARG SENTRY_ENVIRONMENT="production"
ARG SENTRY_RELEASE=""
ARG SENTRY_SAMPLE_PERCENT="100"
COPY packages/core packages/core
COPY apps/web apps/web
# The source maps stay out of the image: only CI uploads them, to Sentry.
RUN bun run --filter @rafflink/web build && find apps/web/dist -name '*.map' -delete

FROM oven/bun:1.4.5 AS run
WORKDIR /app
# The server's error reports carry the same release as the page's.
ARG SENTRY_RELEASE=""
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    SENTRY_RELEASE=$SENTRY_RELEASE
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

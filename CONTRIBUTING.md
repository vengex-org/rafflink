# Contributing

Bug reports and pull requests are welcome. Run `bun run check` before you open a pull request, and keep one change
per pull request.

## Development

Requires [Bun](https://bun.sh) 1.4.5 or newer.

```sh
bun install
bun run check
```

`bun run check` runs lint (oxlint), format check (oxfmt), typecheck and all tests. `bun run format` applies
the formatter. `bun run build` builds the web app and the Worker bundle.

### Bun server with a fake Twitch, Kick and YouTube

You need no Twitch, Kick or Google app for development. The Bun server serves a fake Twitch, a fake Kick and a fake
YouTube next to itself:

```sh
bun run --filter @rafflink/server dev
```

It listens on <http://localhost:3000> with the settings of [apps/server/dev.env](apps/server/dev.env) and keeps
its data in `apps/server/data`. Signing in opens a page with test users: `Fake_Viewer` (id 1000, also the
admin) and `Fake_Streamer` (id 1001). The session is a cookie, so use a private window per user.

The Kick sign-in buttons open the fake Kick, with its own test users: `Fake_Kick_Viewer` (id 2000) and
`Fake_Kick_Streamer` (id 2001). It exists only when `DEV_FAKE_KICK=true` and takes `KICK_CLIENT_ID` and
`KICK_CLIENT_SECRET` as its app, so both must be set. Like the fake Twitch, it only starts when `PUBLIC_URL` is a
local origin. It answers sign-in and the Kick API, but nothing in dev sends Kick chat messages. Set
`DEV_FAKE_KICK=false` and leave the `KICK_*` lines out of `dev.env` to try the server with Twitch only.

The YouTube sign-in button signs in the fake channel `Fake YouTube Streamer` at once, without a consent page. The
fake exists only when `DEV_FAKE_YOUTUBE=true` with `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` set and a local
`PUBLIC_URL`. The channel is live from the start, so a YouTube giveaway reads its chat, but nothing in dev writes
in that chat.

The dev server does not watch `apps/web` or `packages/core`, so restart it after editing them. The fake Twitch
exists only when `DEV_FAKE_TWITCH=true`; a production server answers 404 on its routes. The fake Twitch signs
anyone in, so `DEV_FAKE_TWITCH=true` only starts when `PUBLIC_URL` is a `localhost` or `127.0.0.1` origin;
any other `PUBLIC_URL` stops the start with a configuration error.

Open the dev page at exactly `PUBLIC_URL` (`http://localhost:3000`). `http://127.0.0.1:3000` is the same server, but
the WebSocket routes compare the `Origin` header with `PUBLIC_URL` as text, so that address gets 403 on the live
and viewer sockets and the page never updates.

### Cloudflare dev

The fake Twitch cannot run inside the Worker, so it runs as its own process. The fake Kick and the fake YouTube
run only inside the Bun server, so Cloudflare dev signs in with Twitch only. Build the web app once with
`bun run build` in the repository root, because wrangler serves it as static assets from `apps/web/dist`. Create the local
database tables once with `bunx wrangler d1 migrations apply rafflink --local` in `apps/cloudflare`. Then use
two terminals there:

```sh
bun run dev:twitch   # fake Twitch on http://localhost:3001
bun run dev          # wrangler dev on http://localhost:8787, settings from dev.env
```

### Load test

`bun run load-test` drives fake viewers through the real entry flow (sign-in start, fake Twitch consent,
callback, and the queue poll when the callback queues) against a local Bun server and reports throughput,
p50/p95/p99 latency, 429 and error counts, and whether the entrant count matches the accepted entries without
duplicates. Defaults: 500 viewers per second for 30 seconds, 5% of the viewers enter a second time.

```sh
bun run load-test -- --rate 500 --duration 30 --duplicates 5
bun run load-test -- --rate 300 --duration 10 --token-limit 100   # fake Twitch answers 429 above 100 token calls per second
```

The script starts the Bun server and the fake Twitch as child processes on free local ports, with a throwaway
data folder. Server settings such as `QUEUE_INCREASE_STEP_PER_SECOND` are read from your environment. With
`--token-limit` the run shows how the token queue adapts its drain rate to the limit: it cuts the rate to 2/3 at
each 429 and grows it step by step in between. The exit code
is 1 when a check fails and 2 for bad flags or a redirect to a host that is not local.

The load test only talks to `localhost`, `127.0.0.1` and `[::1]`: any other host is refused before a request is
sent, and it only runs against the processes it spawns itself. Never point load at the hosted service.

## Writing UI copy

Write new or changed copy in English. Other languages fall back to English for keys they do not have yet: list
such keys in `EnglishOnlyKey` in `apps/web/src/i18n/en.ts` and remove them from the other language files.
Translations follow once the English text is settled.

- Give a field one line of help at most. Explanations and legal or privacy notes go behind an (i) (`InfoTip`)
  or into a `Disclosure`. Examples go into the placeholder.
- Optional things start collapsed: official rules, bonus tickets, OBS steps, overlay style, account settings.
- Say each thing once, next to the action it is about.
- Reuse the existing pieces: the spacing of `.field`, `Notice` for warnings and hints between fields, the one
  section heading style, `CopyLink` for anything people copy, and the shared dialog button row.
- Write "your" when you talk to the streamer and use the channel name when you talk to the viewer. Keep jargon
  such as drand or Merkle root out of the main copy.

# Rafflink

Giveaways for Twitch streamers without chat keywords. The streamer creates a giveaway and posts a link;
viewers open it, sign in with Twitch and are entered. See [docs/spec.md](docs/spec.md) for the product spec.

What it does:

- The streamer signs in with Twitch, creates a giveaway (title and prize are optional, ticket counts per
  group, optional filters and end time) and gets a short link such as `/K7M2P`.
- Viewers open the link, sign in with Twitch and are entered with the tickets of their best group
  (viewer, follower, subscriber tier, VIP, moderator). The streamer cannot enter their own giveaway.
- The streamer watches a live page (also available as a read-only OBS overlay link), closes the giveaway
  and draws winners. Winners claim with a button or by writing in chat. A winner who does not claim can be
  rerolled.

Rafflink runs on Cloudflare (Workers, Durable Objects, D1) or on any server with Docker. Both targets share
one core and pass the same contract tests.

## Development

Requires [Bun](https://bun.sh) 1.4.5 or newer.

```sh
bun install
bun run check
```

`bun run check` runs lint (oxlint), format check (oxfmt), typecheck and all tests. `bun run format` applies
the formatter. `bun run build` builds the web app and the Worker bundle.

### Bun server with a fake Twitch

You need no Twitch app for development. The Bun server serves a fake Twitch next to itself:

```sh
bun run --filter @rafflink/server dev
```

It listens on <http://localhost:3000> with the settings of [apps/server/dev.env](apps/server/dev.env) and keeps
its data in `apps/server/data`. Signing in opens a page with test users: `Fake_Viewer` (id 1000, also the
admin) and `Fake_Streamer` (id 1001). The session is a cookie, so use a private window per user.

The dev server does not watch `apps/web` or `packages/core`, so restart it after editing them. The fake Twitch
exists only when `DEV_FAKE_TWITCH=true`; a production server answers 404 on its routes. The fake Twitch signs
anyone in, so `DEV_FAKE_TWITCH=true` only starts when `PUBLIC_URL` is a `localhost` or `127.0.0.1` origin;
any other `PUBLIC_URL` stops the start with a configuration error.

Open the dev page at exactly `PUBLIC_URL` (`http://localhost:3000`). `http://127.0.0.1:3000` is the same server, but
the WebSocket routes compare the `Origin` header with `PUBLIC_URL` as text, so that address gets 403 on the live
and viewer sockets and the page never updates.

### Cloudflare dev

The fake Twitch cannot run inside the Worker, so it runs as its own process. Build the web app once with
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
each 429 and grows it step by step in between (see "Queue for the token endpoint" in `docs/spec.md`). The exit code
is 1 when a check fails and 2 for bad flags or a redirect to a host that is not local.

The load test only talks to `localhost`, `127.0.0.1` and `[::1]`: any other host is refused before a request is
sent, and it only runs against the processes it spawns itself. Never point load at the hosted service.

## Twitch app registration

Rafflink signs streamers and viewers in with Twitch, so every installation needs its own Twitch app. You
register it once and copy two values into the config.

1. Turn on two-factor authentication on the Twitch account that will own the app (Twitch settings, Security
   and Privacy). The developer console refuses to register apps without it.
2. Open the [Twitch developer console](https://dev.twitch.tv/console/apps) and choose **Register Your
   Application**.
3. Fill in the form:
   - **Name:** any unique name, for example `Rafflink` plus your channel name. Viewers see it on the Twitch
     consent screen.
   - **OAuth Redirect URLs:** add both callback URLs of your installation. Replace the origin with your
     `PUBLIC_URL`:
     - `https://rafflink.example.com/auth/twitch/streamer`
     - `https://rafflink.example.com/auth/twitch/viewer`

     For local development against real Twitch add the local origins too, for example
     `http://localhost:3000/auth/twitch/streamer` and `http://localhost:3000/auth/twitch/viewer` (Docker or the
     Bun server) or the same paths on `http://localhost:8787` (`wrangler dev`). Twitch accepts `http` only for
     `localhost`.

   - **Category:** Giveaway/Loyalty Tool.
   - **Client Type:** Confidential. Rafflink keeps the secret on the server.
4. Choose **Create**, then **Manage** next to the new app.
5. Copy the **Client ID** into `TWITCH_CLIENT_ID`.
6. Choose **New Secret**, confirm, and copy the secret into `TWITCH_CLIENT_SECRET`. Twitch shows it once. If you
   lose it, create a new one and update the config; the old one stops working.

You do not pick scopes in the console. Rafflink asks for them at sign-in:

- streamers: `openid`, `channel:read:vips`, `moderation:read` (to know VIPs and moderators) and
  `user:read:chat` (to watch the chat for claims and show the winners' messages);
- viewers: `openid`, `user:read:subscriptions` and `user:read:follows` (to check who may enter and how many
  tickets they get).

The rest of the required config:

- `PUBLIC_URL`: the origin people open, for example `https://rafflink.example.com`, with no trailing slash.
  It must match the redirect URLs above.
- `ADMIN_TWITCH_IDS`: who may open the admin page, comma separated. Each entry is a numeric Twitch user
  id, a Twitch login, or a channel link such as `https://twitch.tv/<login>`. Logins and links are looked up
  at Twitch on the first admin check, using the app's own credentials; while Twitch does not answer, the
  admin page stays closed. The first lookup logs the resolved ids: copy them into this setting, because an
  id never changes and needs no lookup.
- `OPEN_SIGNUP` (default `false`): who may create giveaways. With `false`, any Twitch account can sign in, but
  it can create giveaways only after an admin approves it on the admin page, under "Streamer access"; the
  accounts in `ADMIN_TWITCH_IDS` are always allowed. Set `true` to let every streamer create giveaways, as the
  hosted service does. An approval is kept when you switch to `true` and back.
- `SESSION_SECRET`: a long random string, for example the output of `openssl rand -base64 32`.
- `TOKEN_SEAL_KEYS`: the key that encrypts stored streamer tokens, written as `<key id>:<32 random bytes in
  base64>`, for example `k1:` followed by the output of `openssl rand -base64 32`. To rotate, put the new key
  first and keep the old one after a comma until every streamer has signed in again.

Every other setting has a default; see [.env.example](.env.example).

## Self-hosting

Both targets need your own Twitch app (see above) and the required settings listed there. Every setting is in
[.env.example](.env.example), which `bun run env:example` generates from the config schema.

The home page is intentionally plain: a sign-in button and the footer links. A deployment that wants a richer page replaces the one module `apps/web/src/site/site.tsx` at build time.

Optional support link: set `DONATE_URL` to an `https://` page (Ko-fi, GitHub Sponsors and the like) and a quiet
"Support" link appears in the home page footer, above the drawn giveaways on the dashboard, in the account menu
and in the settings panel of the streamer's live page. Viewer pages and the OBS overlay never show it. Left blank,
no link appears anywhere.

Legal pages: `/privacy` and `/terms` are a generic template that is accurate for any install. Whoever runs an
instance is the controller of its data and must name themselves. Set `OPERATOR_NAME` (a person or a company) and
the pages name you. `OPERATOR_EMAIL` (where visitors send data requests) is then required, because a privacy
policy has to name a contact. `OPERATOR_ADDRESS` and `OPERATOR_ID` (business or company registration number) add
the rest, and `LEGAL_UPDATED` (`YYYY-MM-DD`) sets the date shown as the last update. They fail at start without
`OPERATOR_NAME`. Without any of them the pages say the operator has published no contact details. The retention
and cookie lifetimes in the texts are the defaults of the matching settings (see `.env.example`); if you change
them, change the texts too. Rafflink sends no data to the Rafflink project from any install.

### Server size (VPS)

One Bun process serves everything and writes entries to SQLite, so a small VPS is enough. The entry path runs on
one CPU core and waits on disk writes, which makes disk speed matter more than core count.

| Use                                                                  | CPU    | RAM  | Disk           |
| -------------------------------------------------------------------- | ------ | ---- | -------------- |
| Minimum: small streams, a few thousand entrants per giveaway         | 1 vCPU | 1 GB | 10 GB SSD      |
| Recommended: big streams, entry bursts of several hundred per second | 2 vCPU | 2 GB | 20 GB NVMe SSD |

The second core keeps Caddy, Docker and the OS off the core that handles entries. A spinning disk or a cheap
network volume with slow fsync lowers the entry ceiling the most.

Measured with `bun run load-test` on an 8 core desktop with an NVMe disk: 500 entries per second for 30 s with no
errors, and up to 1,500 per second in short runs, using about 0.75 of one core at 700 per second. A VPS core is
slower, so expect a lower ceiling and run the load test on your own server before a big giveaway. Twitch limits
sign-ins per app too; above that limit viewers wait in the sign-in queue, whatever the server size.

### Docker (any server)

[apps/server/compose.yaml](apps/server/compose.yaml) runs the Bun server and a Caddy proxy that gets a
certificate for your domain. Ports 80 and 443 must be reachable, and the DNS of the domain must point at the
server.

1. Copy the example settings next to the compose file: `cp .env.example apps/server/.env`.
2. In `apps/server/.env` fill the required values from the Twitch section above. Add `DOMAIN`, the host name
   without `https://` (for example `rafflink.example.com`), and set `PUBLIC_URL` to `https://` plus the same
   host name. Leave `DEV_FAKE_TWITCH` at `false`.
3. Start it from `apps/server`:

   ```sh
   cd apps/server
   docker compose up -d --build
   ```

Data lives in the Docker volume `rafflink-data`, mounted at `/data` (`DATA_DIR`): `accounts.sqlite` with
streamers and giveaways, `queue.sqlite` with the token queue and one `rooms/<id>.sqlite` file per giveaway.
Caddy keeps its certificates in the volume `caddy-data`.

Back up `DATA_DIR`. SQLite files change while the server runs, so stop the server for a plain copy. The
volume name starts with the compose project name (the folder name, `server`); `docker volume ls` shows it.

```sh
cd apps/server
docker compose stop rafflink
docker run --rm -v server_rafflink-data:/data -v "$PWD":/backup alpine tar czf /backup/rafflink-data.tgz -C /data .
docker compose start rafflink
```

`TOKEN_SEAL_KEYS` is not in the volume. Keep a copy of it: without it the stored streamer tokens cannot be
read and every streamer has to sign in again.

To upgrade, pull the new code and rebuild. Back up first; the server applies new account migrations at start.

```sh
git pull
cd apps/server
docker compose up -d --build
```

Streamers that signed in before the approval feature existed wait for approval after this upgrade, so they
cannot create giveaways until an admin approves them on the admin page. Set `OPEN_SIGNUP=true` to keep
today's behavior.

The Bun server limits viewer sign-in callbacks per client address (`ENTRY_IP_LIMIT_PER_MINUTE`, 60 by
default) and its logs carry a request id only. Which address it counts depends on `CLIENT_IP_HEADER`:

- Unset (the default): the address of the connection. That is right when nothing sits in front of the
  server. Behind a proxy it is the proxy's address, so every viewer shares one limit; it also means a
  client cannot dodge the limit by writing its own `X-Forwarded-For`.
- Set to a header name: the server reads the client address from that header, and when the value lists
  several addresses, from the last one, which the nearest proxy appended. Set it only when your proxy
  overwrites or appends that header on every request, or a client can choose its own address. Behind
  Cloudflare use `CF-Connecting-IP`; behind Caddy or Traefik alone use `X-Forwarded-For`. Behind
  Cloudflare and then Caddy, `X-Forwarded-For` ends in Cloudflare's address, so use `CF-Connecting-IP`.

A request without the configured header has no known address and is not limited by address. The limit is
a loose backstop because many viewers can share one mobile address. Viewer sockets check the `Origin`
header against `PUBLIC_URL`, not an address.

### Coolify (Traefik)

Coolify puts Traefik in front of the container, so the Caddy service of the compose file is not needed:
Traefik gets the certificate and proxies to the Bun container. Create an application from this repository
with the Dockerfile build pack and the file `apps/server/Dockerfile` (build context: the repository root),
set the exposed port to `3000`, add a persistent storage mounted at `/data`, and enter the settings from
`.env.example` as environment variables with `PUBLIC_URL` set to your `https://` domain, `DATA_DIR=/data` and
`PORT=3000`. WebSockets pass through Traefik without extra settings.

Caddy also compressed responses (`encode zstd gzip`). Turn on compression in Coolify, or use the `compress`
middleware below, because a full entrants list is large.

To limit `/api`, add a Traefik `rateLimit` middleware to a router that matches only `PathPrefix(`/api`)`, in
the application's custom labels. Traefik takes the longer rule first, so `/api` goes through this router and
every other path through the one Coolify made. Replace the domain:

```yaml
traefik.enable=true
traefik.http.middlewares.rafflink-api-limit.ratelimit.average=3
traefik.http.middlewares.rafflink-api-limit.ratelimit.period=1s
traefik.http.middlewares.rafflink-api-limit.ratelimit.burst=30
traefik.http.middlewares.rafflink-compress.compress=true
traefik.http.routers.rafflink-api.rule=Host(`rafflink.example.com`) && PathPrefix(`/api`)
traefik.http.routers.rafflink-api.entrypoints=https
traefik.http.routers.rafflink-api.tls=true
traefik.http.routers.rafflink-api.tls.certresolver=letsencrypt
traefik.http.routers.rafflink-api.middlewares=rafflink-api-limit,rafflink-compress
traefik.http.routers.rafflink-api.service=rafflink-api
traefik.http.services.rafflink-api.loadbalancer.server.port=3000
```

`average=3` per `1s` with `burst=30` allows 30 requests at once and three a second after that, the same
budget as the Cloudflare rule above (a viewer needs under 10 in 10 seconds). Traefik counts per client IP,
the address of the connection. When another proxy such as Cloudflare sits in front of Traefik, every viewer
shares that proxy's address; then add
`traefik.http.middlewares.rafflink-api-limit.ratelimit.sourcecriterion.ipstrategy.depth=1` and make the
Traefik entrypoint trust that proxy's forwarded headers. The entrypoint and certificate resolver names above
are Coolify's defaults; check them in your Coolify proxy settings.

### Cloudflare

You need a Cloudflare account with Workers and D1. Run the `wrangler` commands in `apps/cloudflare`.

1. Build the web app and the Worker bundle from the repository root: `bun run build`.
2. Sign in and create the database:

   ```sh
   cd apps/cloudflare
   bunx wrangler login
   bunx wrangler d1 create rafflink
   ```

3. Copy the `database_id` the command prints into `d1_databases` in
   [apps/cloudflare/wrangler.jsonc](apps/cloudflare/wrangler.jsonc). Change `name` there if you want another
   Worker name.
4. Add the plain settings as a `vars` block in `wrangler.jsonc`:

   ```jsonc
   "vars": {
     "PUBLIC_URL": "https://rafflink.example.com",
     "TWITCH_CLIENT_ID": "<client id>",
     "ADMIN_TWITCH_IDS": "<your Twitch user id, login or channel link>",
   },
   ```

   `PUBLIC_URL` is the address of the Worker: a custom domain you add in the Cloudflare dashboard, or the
   `workers.dev` address that `wrangler deploy` prints. It must match the redirect URLs in the Twitch app.

5. Create the tables in the remote database (the files are in `packages/core/schema/accounts`):

   ```sh
   bunx wrangler d1 migrations apply rafflink --remote
   ```

6. Deploy:

   ```sh
   bunx wrangler deploy
   ```

7. Set the secrets. Each command asks for the value:

   ```sh
   bunx wrangler secret put TWITCH_CLIENT_SECRET
   bunx wrangler secret put SESSION_SECRET
   bunx wrangler secret put TOKEN_SEAL_KEYS
   ```

A cron trigger (`0 * * * *`, in `wrangler.jsonc`) validates every stored streamer token once an hour, as
Twitch requires. If you change `VALIDATE_PERIOD_SECONDS`, change the cron to match; a test checks that they
agree. The same cron wakes the rooms of closed giveaways once, up to `ENTRY_RETENTION_SWEEP_BATCH` per
run, so each arms the alarm that deletes the entrants' data `ENTRY_RETENTION_SECONDS` after the close. A room
that fails sorts behind the others and is given up, with an error log, after `ENTRY_RETENTION_SWEEP_MAX_ATTEMPTS`
failed runs.

Optional usage meter: the Cloudflare free plan allows 100,000 Worker requests a day. To show the day's use on
the admin page and warn streamers when fewer than 25,000 are left, add `CLOUDFLARE_ACCOUNT_ID` as a var and
set `CLOUDFLARE_API_TOKEN` (a token with the Account Analytics read permission) as a secret. Without them the
meter reports no limit. The admin page warns once a day's Worker or Durable Object requests reach
`USAGE_ALERT_PERCENT` (70) of the daily limit.

Cloudflare plan: the app assumes Workers Free (`CLOUDFLARE_PLAN=free`) until an admin switches the plan on the
admin page. Cloudflare cannot upgrade on its own, so moving to Paid takes two steps: pay for Workers Paid in
the Cloudflare dashboard, then switch to Paid on the admin page. The switch is stored in D1 and reaches the
token queue at once, without a deploy. On Paid the meter shows the day's requests without a daily cap (Paid
includes 10 million Worker and 1 million Durable Object requests a month and bills the rest), and the queue
sends up to 9,000 subrequests per alarm invocation instead of 45. `WORKER_REQUEST_LIMIT`,
`DURABLE_OBJECT_REQUEST_LIMIT` and `QUEUE_SUBREQUESTS_PER_INVOCATION` override the plan's values when set,
for example a self-imposed daily cap on Paid. The Bun server has no Cloudflare plan and shows no switch.
Scripts, styles, icons and the app pages are static assets that Cloudflare serves without the Worker. Only
`/api/*`, `/auth/*` and the pages search engines index (`/`, `/privacy` and `/terms`) count as Worker requests;
the Worker writes `PUBLIC_URL` into the canonical and Open Graph tags of those pages. A giveaway page load makes one such request, and the
public part of its answer is kept for `PUBLIC_GIVEAWAY_CACHE_SECONDS` (5 by default) in the Cache API, so a
refresh by an anonymous viewer reads neither D1 nor a Durable Object. The Cache API stores nothing on a
`workers.dev` address, so the cache needs a custom domain; the entrant count a viewer sees can be that many
seconds old.
The home page is one Worker request itself. The home, dashboard and admin pages add one `/api/session` request for the header, and the overlay adds one
`/api/g/<code>` request when it shows winners, to read the prize; the giveaway pages make no session request.

The leaf list of a committed giveaway (`/api/g/CODE/leaves`, up to a megabyte) is kept in the same cache for
`LEAVES_CACHE_SECONDS`. A download that misses the cache wakes the giveaway's room, so each client address may make
`LEAVES_IP_LIMIT_PER_MINUTE` of them (the `LEAVES_IP_LIMITER` binding on Cloudflare, whose limit comes from
`wrangler.jsonc`). On a `workers.dev` address the cache stores nothing, so the limit is the only guard there.

### What a viewer costs

A viewer's giveaway page opens one WebSocket to `/api/g/<code>/live` (one Worker request and one Durable
Object request, sent with the site's own `Origin`). The room pushes the outcome through it: closing, the
draw, rerolls, claims and a chat claim that stops working. The push carries the winners' Twitch user ids and
claim deadlines, so the page compares them with its own viewer and shows "You won" or "Not this time"
without asking the server again, and a draw never makes every viewer fetch `/api/g/<code>` at once. Messages
the room sends are not billed and viewers send none. The page reconnects with backoff and jitter and gives up only after a few connections in a row closed before
the first message and at least a minute passed; it tries again when the browser comes back online or the tab
becomes visible. It stops once the giveaway is finished: the draw is done and every pick is claimed, or no entrant
is left to reroll to, or `REROLL_WINDOW_SECONDS` (default 3600) passed since the last claim deadline, after which a
reroll is refused. A push holds public data
only: no cookie, no sign-in state and no names.

The page also keeps its last `/api/g/<code>` answer in `sessionStorage`. A reload within 30 seconds
(`storedGiveawayWindowMs` in `apps/web/src/lib/stored-giveaway.ts`, a starting guess) renders from it and
opens only the socket, whose first message brings the page up to date. After a sign-in, a queued entry or a
claim the page asks the server again, because what it knows about the viewer changed.

### Rate limit for `/api/*` (Cloudflare)

Viewers who keep refreshing, or a script, can use up the free 100,000 requests a day, because Cloudflare
counts every Worker request, also one served from the cache. A rate limiting rule runs in front of the Worker,
so a blocked request is not a Worker request. It needs the domain to be on Cloudflare (a custom domain, not
`workers.dev`). The free plan allows one rule, counted per IP address over a period of 10 seconds, with a
block of 10 seconds.

1. In the Cloudflare dashboard open your domain, then **Security**, **WAF**, **Rate limiting rules**, and
   choose **Create rule**.
2. Name it, for example `rafflink api`.
3. Under **If incoming requests match**, choose the field **URI Path**, the operator **starts with** and the
   value `/api/`. The expression is `starts_with(http.request.uri.path, "/api/")`.
4. Leave the characteristic at **IP**. Set **Requests** to `30` and **Period** to `10 seconds`.
5. Under **Then take action** choose **Block** with the duration `10 seconds`, then **Deploy**.

Why 30 does not hurt a normal viewer: one viewer makes two requests when the page opens (the giveaway and
the socket), then a poll every 3 seconds while a queued entry is processed, and a few more when the socket
reconnects after a network drop. That stays under 10 requests in 10 seconds. 30 leaves room for a few people
behind one shared address (a household, a school or a mobile carrier) and still cuts off a script or a
refresh loop at three requests a second. 30 is a starting guess; raise it if many viewers share addresses.
`/auth/*` is not covered, because the free plan has one rule.

To upgrade, pull the new code, run `bun run build`, apply new migrations with
`bunx wrangler d1 migrations apply rafflink --remote`, then run `bunx wrangler deploy`. Apply the migrations
first: the new code reads columns that only the migration adds. After the upgrade that introduced streamer
approval, streamers that signed in earlier wait for approval unless `OPEN_SIGNUP` is `true`.

## Security headers, link previews and OBS

Every API response and every page carries a Content-Security-Policy (`default-src 'self'`, no inline styles,
`frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and
`Cross-Origin-Opener-Policy`; `Strict-Transport-Security` is added when `PUBLIC_URL` is https. The one
inline script of `index.html` (the theme) is allowed by its hash. The hash is computed from the page that is
served and from the built `apps/web/dist/index.html` when it writes `_headers`, so editing the script needs
no manual step; a test fails if the built page has a second inline script.

On Cloudflare the app pages are static: the headers above come from `apps/web/dist/_headers`, which the web build
writes (with the hash of the inline script), and `X-Robots-Tag: noindex, nofollow` covers every path except
the home and legal pages. Those three run the Worker, which answers them like the Bun server does, with `PUBLIC_URL`
in the canonical, `og:url`, `og:image` and `twitter:image` tags; link previews and search engines ignore relative
URLs there. A pasted giveaway link shows the generic preview of the home page with its relative URLs, so most
previews show no image. The Bun server
answers each page itself and gives the page of a giveaway link (`/<code>` and `/g/<code>`) its title, prize
and streamer name in the title, Open Graph and Twitter tags, so a pasted link previews well; it sends the same
noindex rule. `/robots.txt` is a static file in `apps/web/public` for both targets; there is no sitemap.

The OBS overlay is a browser source that opens `/overlay/...` as a top-level page, so
`frame-ancestors 'none'` does not affect it. Once the entry link leaves the stream (while a draw runs and after
it), a small plate under the winners names the host the overlay is served from, so a self-hosted overlay shows its
own domain. Do not embed the overlay in an iframe on another site.

After changing the brand mark or the colors, run `bun run icons` in `apps/web` and commit the files in
`apps/web/public`: the favicons (`favicon.ico` holds 16, 32 and 48 px), the app icons and the `og.png` link preview.

## License

[AGPL-3.0](LICENSE)

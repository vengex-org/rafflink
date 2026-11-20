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

### Cloudflare dev

The fake Twitch cannot run inside the Worker, so it runs as its own process. Build the web app once with
`bun run build` in the repository root, because wrangler serves it as static assets from `apps/web/dist`. Create the local
database tables once with `bunx wrangler d1 migrations apply rafflink --local` in `apps/cloudflare`. Then use
two terminals there:

```sh
bun run dev:twitch   # fake Twitch on http://localhost:3001
bun run dev          # wrangler dev on http://localhost:8787, settings from dev.env
```

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
  `user:read:chat` (to watch the chat for claims);
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
- `SESSION_SECRET`: a long random string, for example the output of `openssl rand -base64 32`.
- `TOKEN_SEAL_KEYS`: the key that encrypts stored streamer tokens, written as `<key id>:<32 random bytes in
  base64>`, for example `k1:` followed by the output of `openssl rand -base64 32`. To rotate, put the new key
  first and keep the old one after a comma until every streamer has signed in again.

Every other setting has a default; see [.env.example](.env.example).

## Self-hosting

Both targets need your own Twitch app (see above) and the required settings listed there. Every setting is in
[.env.example](.env.example), which `bun run env:example` generates from the config schema.

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
agree.

Optional usage meter: the Cloudflare free plan allows 100,000 Worker requests a day. To show the day's use on
the admin page and warn streamers when fewer than 25,000 are left, add `CLOUDFLARE_ACCOUNT_ID` as a var and
set `CLOUDFLARE_API_TOKEN` (a token with the Account Analytics read permission) as a secret. Without them the
meter reports no limit. On a paid plan raise `WORKER_REQUEST_LIMIT` and `DURABLE_OBJECT_REQUEST_LIMIT`.
Pages, scripts, styles and icons are static assets that Cloudflare serves without the Worker, so only
`/api/*` and `/auth/*` count as Worker requests. A giveaway page load makes one such request, and the
public part of its answer is kept for `PUBLIC_GIVEAWAY_CACHE_SECONDS` (5 by default) in the Cache API, so a
refresh by an anonymous viewer reads neither D1 nor a Durable Object. The Cache API stores nothing on a
`workers.dev` address, so the cache needs a custom domain; the entrant count a viewer sees can be that many
seconds old.

To upgrade, pull the new code, run `bun run build`, apply new migrations with
`bunx wrangler d1 migrations apply rafflink --remote`, then run `bunx wrangler deploy`.

## Security headers, link previews and OBS

Every API response and every page carries a Content-Security-Policy (`default-src 'self'`, no inline styles,
`frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and
`Cross-Origin-Opener-Policy`; `Strict-Transport-Security` is added when `PUBLIC_URL` is https. The one
inline script of `index.html` (the theme) is allowed by its hash. The hash is computed from the page that is
served and from the built `apps/web/dist/index.html` when it writes `_headers`, so editing the script needs
no manual step; a test fails if the built page has a second inline script.

On Cloudflare the pages are static: the headers above come from `apps/web/dist/_headers`, which the web build
writes (with the hash of the inline script), and `X-Robots-Tag: noindex, nofollow` covers every path except
the home page. A pasted giveaway link shows the generic preview of the home page there. The Bun server
answers each page itself and gives the page of a giveaway link (`/<code>` and `/g/<code>`) its title, prize
and streamer name in the title, Open Graph and Twitter tags, so a pasted link previews well; it sends the same
noindex rule. `/robots.txt` is a static file in `apps/web/public` for both targets; there is no sitemap.

The OBS overlay is a browser source that opens `/overlay/...` as a top-level page, so
`frame-ancestors 'none'` does not affect it. Do not embed the overlay in an iframe on another site.

After changing the gift icon or the colors, run `bun run icons` in `apps/web` and commit the files in
`apps/web/public`.

## License

[AGPL-3.0](LICENSE)

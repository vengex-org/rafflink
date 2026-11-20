# Rafflink: initial spec

Status: final for M1, 2026-11-20. Domain: `rafflink.app` (free at the Google registry on 2026-11-20, not yet bought).

## Why

Chat giveaways stop working on big channels. When thousands of people type the keyword at once, entries
reach the giveaway tool slower than people type them. Streamer Giveaway, our desktop app, took a long time
to collect 8,000 valid entries.

Rafflink moves entry out of chat. The streamer creates a giveaway on the web and gets a link. They post it in
chat. Viewers open it, sign in with their streaming account and are in. One click per viewer, no chat parsing,
no keyword.

Entry is always free. Rafflink is a promotional giveaway, not a lottery: no purchase, no paid tickets, no
paid extra chances. This keeps it out of gambling law and inside Twitch's giveaway rules.

## Goals

- A giveaway takes 12,000 entries within about one minute of the link going out, without errors or
  lost entries.
- Running it costs nothing on free hosting tiers at that load, and stays cheap above it (see Load budget
  for where free ends).
- Viewers enter with one sign-in and one click, on desktop and on the mobile apps' in-app browser.
- Twitch first. The data model and code keep the platform as a parameter, so YouTube and Kick are an added
  provider, not a rewrite.
- The draw is fair and checkable by anyone: every entrant can prove they are in the list, and nobody,
  including the streamer and Rafflink, can pick or influence the winner.

## Not in the first version

- YouTube and Kick sign-in (planned, see Platforms).
- Paid plans, ads, sponsored giveaways.
- "Chatted in the last N minutes" rule. The chat watch for claims (see Claim) could later feed it, but it
  would have to run during the whole giveaway, not only the claim window.
- Winner form (for example a shipping address). Planned as M3, see Milestones.
- Messages to chat. Rafflink never posts to chat; the streamer announces the winner.
- A mobile app.

## Hosting

Both: one hosted service at `rafflink.app`, and open source with a self-host guide for streamers who want
their own Cloudflare account and Twitch app.

The hosted service starts on the Cloudflare free plan and moves to Workers Paid (5 USD per month) when load
needs it. The free plan fits about 4 giveaways of 12,000 entries per day for all streamers together (see Load
budget), and over a limit entries fail. So the hosted service:

- reads the day's Worker and Durable Object requests from the Cloudflare GraphQL Analytics API on demand,
  when the admin page opens and when a giveaway is created, and shows the remaining budget on the admin
  page. Counting every request in D1 would cost about 12,000 D1 writes per giveaway against a free limit of
  100,000 per day, so nothing is counted per request;
- moves to Paid on the first day that uses more than 50% of any daily limit;
- warns a streamer at giveaway creation when less than 25,000 Worker requests are left for the day.

This applies to the Cloudflare target only. The VPS target has no daily request limit and reports no usage.

## Users and flow

**Streamer**

1. Signs in with Twitch.
2. Creates a giveaway: optional title and prize text, rules (who may enter, tickets per group), optional end time.
3. Gets a link `rafflink.app/<code>` and posts it in chat. The code is 5 characters from an alphabet without
   look-alike characters (no `0 O 1 l I`), short enough to say out loud. `rafflink.app/g/<code>` redirects
   to the same page. 32 characters give 33.5 million codes; a code is reused only after its giveaway is
   deleted.
4. Watches a live page: entrant count, entries per second, latest names. OBS has no Twitch session, so the
   page has a second, read-only overlay link with an unguessable token that works as a browser source.
5. Closes entries, draws one or more winners and announces them on stream.
6. Sees on the live page whether each winner has claimed, and how (button or chat). Rerolls a winner who did
   not claim within the claim time.

**Claim.** A winner claims in one of two ways:

- **In Rafflink:** the giveaway page shows the winner a "Claim" button after they sign in. Claim time is a
  giveaway setting (default 5 minutes after the draw). The page shows the remaining time.
- **In chat:** the winner writes in the streamer's chat and Rafflink marks the claim automatically. By default
  any message from the winner's account counts; the streamer can require a keyword instead (for example
  `!claim`). The match is on the Twitch user id, not the display name, so a look-alike name cannot claim.

**Chat watch.** Rafflink reads chat only during a claim window, from the draw until every current winner has
claimed or their claim time ended:

- The giveaway's Durable Object opens a Twitch EventSub WebSocket (`wss://eventsub.wss.twitch.tv/ws`) and
  subscribes to `channel.chat.message` for the streamer's channel, with the streamer's token (scope
  `user:read:chat`, the streamer is both broadcaster and reading user).
- Each message from a current winner's user id within `claim_until` sets `claimed_at` and
  `claimed_via = chat`. All other messages are dropped and not stored.
- When no winner is waiting, the object closes the WebSocket. A reroll opens it again.
- EventSub WebSocket rules: subscribe within 10 seconds of the welcome message, reconnect on
  `session_reconnect`, treat a missed keepalive as a dropped connection and reconnect.
- Cost: messages arrive on an outgoing WebSocket, so they are not Worker or DO requests. The object stays awake
  while the socket is open (no hibernation for outgoing sockets), about 40 GB-s per 5-minute claim window,
  well inside the free 13,000 GB-s per day. To confirm in M1 against Cloudflare's billing docs.
- If the WebSocket cannot connect (token revoked, Twitch down), the live page says "Chat claim unavailable"
  and the streamer can mark a chat claim by hand as a fallback.
- Known limits of EventSub over WebSocket:
  - Twitch allows at most 3 WebSocket connections per user token. A streamer with more than 3 giveaways that
    have waiting winners at the same time gets "Chat claim unavailable" on the extra ones.
  - Events sent while a connection is being replaced, or after it dropped, are not replayed. A winner's chat
    message in that gap is missed, and the winner has to claim with the button or the streamer marks it by
    hand.

After the claim time the streamer may reroll; Rafflink does not reroll by itself.

**Viewer**

1. Opens the link. Sees the giveaway, the prize, the rules and the entrant count at load time.
2. Presses "Enter with Twitch". Twitch asks for consent the first time.
3. Lands back on the page with "You are in" and their ticket count, or a clear reason why not
   (not subscribed, giveaway closed).
4. Can reopen the link later to check they are still in, to see the winner and to verify the draw.
5. If drawn, sees "You won" and the "Claim" button with the remaining claim time.

The viewer page does not poll and holds no WebSocket. 12,000 open pages refreshing a counter would cost more
requests than the entries themselves. The count comes with the page load and with the entry response.

## Rules and tickets

Same model as Streamer Giveaway, so streamers know it already:

- Groups: viewer, follower, sub tier 1, tier 2, tier 3, VIP, moderator. Each group has a ticket count.
  0 tickets means the group cannot enter.
- An entrant gets the tickets of the best group they belong to (not the sum).
- Optional filters: subscribers only, followers only, minimum account age.
- One entry per platform account. Accounts on different platforms are different entrants.

VIP and moderator groups are in v1. They need the streamer's token, see Streamer token.

## Platforms

A provider is one sign-in plus one eligibility check. In M1 Twitch is the only provider and the code does not
define this interface yet; it shows the shape the next provider has to fit:

```ts
interface Provider {
  id: "twitch" | "youtube" | "kick"
  authorizeUrl(state: string, nonce: string, scopes: string[]): string
  verifySignIn(
    params: SignInParams,
  ): Promise<{ userId: string; login: string; displayName: string; accessToken: string }>
  eligibility(viewerToken: string, viewerId: string, channelId: string): Promise<Eligibility>
  channelRoles(
    streamerToken: string,
    channelId: string,
  ): Promise<{ vips: string[]; moderators: string[] }>
}
```

Identity everywhere is the pair `(platform, platformUserId)`. M1 giveaways are Twitch only, so they store no
list of accepted platforms; a later provider adds one.

- **Twitch (v1):** see the next section.
- **YouTube (later):** Google OAuth. Channel membership is hard to check from the viewer side; to be
  researched.
- **Kick (later):** Kick's public OAuth API. Subscriber check to be researched.

## Twitch sign-in and OAuth

### What the viewer sign-in calls

| Step         | Endpoint                                                                                    | Whose limit                                 |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Sign-in      | `id.twitch.tv/oauth2/authorize` (browser redirect)                                          | none on our side                            |
| Token        | `POST id.twitch.tv/oauth2/token`                                                            | app's `client_id`, limit **not documented** |
| Identity     | `id_token` verified locally against `id.twitch.tv/oauth2/keys` (RS256)                      | none                                        |
| Sub check    | `GET /helix/subscriptions/user` (`user:read:subscriptions`, 404 = not subscribed)           | per client per user                         |
| Follow check | `GET /helix/channels/followed?broadcaster_id=` (`user:read:follows`, empty = not following) | per client per user                         |
| Account age  | `GET /helix/users` (`created_at`), only when the giveaway sets a minimum age                | per client per user                         |

Helix limits apply "per client ID per user per minute" for user tokens, so 12,000 viewers do not share one
bucket. The `id_token` has no account creation claim (only `email`, `picture`, `preferred_username`,
`updated_at` can be requested), so account age costs a third Helix call.

The token endpoint is the one shared, undocumented limit on the hot path. Twitch's docs give no limit for
`id.twitch.tv` (Helix documents 800 points per minute per user token). A community moderator wrote in 2022
that the endpoint "shouldn't/doesn't have rate limiting", but a developer in the same thread got 429 from it
with an empty body and no rate-limit headers, and Twitch staff never answered. At 100 to 400 sign-ins per second from one `client_id` this is the main load risk.

### Viewer flow: code flow with a queue (decided 2026-11-20)

Code flow with OpenID Connect, scopes `openid user:read:subscriptions user:read:follows`. The implicit flow
was considered (it skips the token endpoint) and rejected, because OAuth's security guidance discourages
tokens in the URL.

Callback `GET /auth/twitch/viewer?code&state`:

1. Check `state` against the short-lived cookie set when the viewer pressed Enter.
2. Exchange the code at `POST id.twitch.tv/oauth2/token`.
3. Verify the `id_token`: signature, `iss`, `aud` (our client id), `exp`, `nonce`.
4. Call the Helix eligibility endpoints with the access token.
5. Write the entry to the giveaway's Durable Object and redirect to the giveaway page with the result.

**Queue for the token endpoint.** The real Twitch limit cannot be load tested before launch: 400 sign-ins per
second need 400 real accounts per second. So the callback falls back to a queue when the token endpoint
answers 429 or 5xx. Only the token endpoint queues; a Helix failure after the exchange does not (see Retry):

- The callback stores `(code, giveaway, nonce)` in the token queue (a Durable Object on Cloudflare, a SQLite file
  on the VPS) and redirects the viewer to the giveaway page with "You are being entered".
- The queue drains codes with an alarm, at a rate it adapts down on 429 and up on success, and runs
  steps 2 to 5 for each.
- The page asks for the result every 3 seconds (`GET /api/g/<code>/pending/<ticket>`), at most 2 minutes.
- An authorization code expires after a few minutes (Twitch does not document the exact time; OAuth
  recommends 10 minutes at most). Codes older than 5 minutes are dropped, and the page shows
  "Enter with Twitch" again.
- After the first 429 the callback enqueues every code for the next 30 seconds, instead of each request
  hitting the limit first.

While the queue is empty, no extra request is made: the normal path is one callback request per entrant.

### Streamer flow

Code flow with `openid channel:read:vips moderation:read user:read:chat` (`user:read:chat` for the chat
claim). Rafflink keeps the streamer's refresh token
(confidential clients get refresh tokens that do not expire). Twitch requires apps that keep an OAuth session
to call `GET id.twitch.tv/oauth2/validate` at start and every hour. A Cron Trigger validates every stored
streamer token hourly (a timer on the VPS) and deletes the ones that return 401; a 5xx, a 429 or a network
error keeps the token. Viewer tokens are not kept, so they are not validated.

### Twitch app registration (a step for the owner, written in the README)

- Twitch developer account with verified email and 2FA (required to register an app).
- Register app "Rafflink" (name must be unique on Twitch), category Giveaway/Loyalty Tool, client type
  Confidential.
- Redirect URLs: `https://rafflink.app/auth/twitch/viewer`, `https://rafflink.app/auth/twitch/streamer`,
  plus `http://localhost:8787/...` for development (or a separate dev app, cleaner).
- Client secret into a Worker secret (`wrangler secret put TWITCH_CLIENT_SECRET`) or into the `.env` of the
  VPS target. A new secret invalidates the old one, so rotation is a deploy step.
- Encryption key for stored streamer refresh tokens (`TOKEN_SEAL_KEYS`) as a second secret.
- Privacy policy and terms pages on `rafflink.app` before public launch (shown on the consent screen link
  and needed for Twitch's developer agreement).
- Read the Twitch Developer Services Agreement section on giveaways and promotions before launch.

## Architecture

Two deployment targets from one TypeScript core (decided 2026-11-20 after a Hetzner VPS analysis):

- **Cloudflare:** Workers, Durable Objects and D1 as described below. No servers to run, global, free tier
  for a few large giveaways a day.
- **VPS** (for example Hetzner): one Bun process with SQLite in Docker, Caddy for TLS, optionally behind the
  free Cloudflare proxy. No daily request limit, about 6 EUR per month, but a single server is a single point
  of failure and updates, backups and monitoring are ours.

The core holds the domain, the Twitch client, the HTTP app (Hono) and the giveaway room logic, written against
small ports (SQL, room directory, alarms, live broadcast, usage meter). Each target implements the ports. A
shared contract test suite runs against both. The rest of this section describes the Cloudflare target; on the
VPS a per-giveaway SQLite file and an in-process room replace the Durable Object, and timers replace alarms and
cron.

- **Workers static assets** serve the frontend from the CDN. Static asset requests are free and do not count
  toward the Worker request limit.
- **Worker** handles the API, sign-in verification and eligibility, and writes the entry in the same
  request.
- **Durable Object, one per giveaway**, SQLite-backed, with its own entries table. It handles requests one at
  a time, so duplicates and counters need no locks. Soft limit is about 1,000 requests per second per object,
  above the 400 per second peak. It runs the draw and refreshes VIP and moderator lists with an alarm.
- **D1** (Cloudflare's SQLite database) keeps streamer accounts, their encrypted tokens and the list of
  giveaways. It is not on the hot path; giveaway data for the viewer page is cached in the Worker.
- The streamer's live page gets one batched update per second over a hibernating WebSocket from the
  giveaway's Durable Object, not one message per entry.

Why not Vercel + Firebase: three vendors instead of one, Firebase's free tier allows 20,000 writes a day
(one large giveaway uses most of it), and Twitch sign-in on Firebase needs the paid Identity Platform.

### Retry

- The entry call is idempotent: the primary key `(platform, platform_user_id)` makes a repeated entry a no-op
  that returns the existing entry.
- A code is single-use, so retry happens on the server after the exchange, while the access token is still
  in hand. The callback retries the Durable Object write on "overloaded" and 5xx with exponential backoff and
  jitter (0.2 s, 0.5 s, 1 s), inside the request.
- Token endpoint 429 or 5xx: the code goes to the queue (see Viewer flow); nothing else does.
- The Worker retries a Helix 503 once, as Twitch asks.
- Only a token-endpoint failure queues the code. A Helix 429 or 5xx after the exchange answers "Try again": the
  code is spent, and queueing it would mean storing the viewer's access token, which this spec rules out. Helix
  limits are per viewer, so one viewer's 429 says nothing about the others.
- When all retries fail, the page shows a "Try again" button that starts a new sign-in. Twitch skips the
  consent screen the second time, so this is one click.
- A 4xx from Helix other than 404 and 429 is shown as a sign-in error with a new "Enter with Twitch" button.

### Load budget

Free-plan limits (Cloudflare docs, read 2026-11-20). All daily limits reset at 00:00 UTC. Over a limit,
further requests of that type fail, which loses entries.

| Limit                  | Free                         | One 12,000-entry giveaway                                                                                        | Free giveaways per day |
| ---------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Worker requests        | 100,000 / day                | ~25,000 (12,000 page-data loads + 12,000 callbacks + ~5% retries); each queued viewer adds up to 40 status polls | **4** without queue    |
| Worker CPU             | 10 ms / request              | `id_token` check plus JSON, network wait not counted; to measure                                                 | n/a                    |
| Worker subrequests     | 50 / request                 | 2 to 4 (Helix calls + DO)                                                                                        | n/a                    |
| DO requests            | 100,000 / day                | ~12,600 (entries + retries + WebSocket connects; incoming WebSocket messages count 20:1, outgoing free)          | 7                      |
| DO duration            | 13,000 GB-s / day            | ~80 GB-s (10 min open at 128 MB; hibernating WebSockets are not billed)                                          | 160                    |
| DO SQLite rows written | 100,000 / day                | ~12,000 entries + draws                                                                                          | 8                      |
| DO SQLite rows read    | 5,000,000 / day              | ~40,000 (duplicate checks, hash, draw)                                                                           | 125                    |
| DO storage             | 5 GB / account               | ~2 MB                                                                                                            | n/a                    |
| D1                     | 5 M reads, 100k writes / day | a few hundred                                                                                                    | n/a                    |

Worker requests are the bottleneck: **about 4 giveaways of 12,000 entries per day on the free plan, for the
whole Rafflink deployment**, not per streamer. Smaller giveaways scale linearly (about 2 Worker requests per
entrant). Peak 400 requests per second is well under the 1,000 per second soft limit of one Durable Object.

Above free: Workers Paid at 5 USD per month raises the Worker limit to 10 million requests per month and DO
requests to 1 million per month plus 0.15 USD per million (Workers and CPU paid figures from memory; check
the pricing page before deciding). That is roughly 400 giveaways of 12,000 entries per month for 5 USD. When
to move the hosted service to Paid: see Hosting.

A load test at 500 entries per second against one Durable Object is a v1 acceptance check.

## Data

M1 schema. The SQL files in `packages/core/schema/` are the only source of the tables. The accounts store is D1
on Cloudflare and `accounts.sqlite` on the VPS. Each giveaway room is the SQLite of its Durable Object on
Cloudflare and one file per giveaway on the VPS.

```
-- accounts store (D1 or accounts.sqlite)
streamers(id, platform, platform_user_id, login, created_at,
          UNIQUE (platform, platform_user_id))
streamer_tokens(streamer_id, refresh_token_enc, scopes, validated_at,
                PRIMARY KEY (streamer_id))
giveaways(id, code UNIQUE, streamer_id, title, prize, rules_json, status,
          closes_at, claim_seconds, overlay_token, created_at)

-- token queue (its own Durable Object or SQLite file)
token_queue(ticket, code, giveaway_id, nonce, received_at, state, result_json,
            PRIMARY KEY (ticket)) WITHOUT ROWID
queue_stats(id, rate_per_second, cooldown_until, dropped, abandoned_results)

-- inside each giveaway's room
room_state(id, platform, giveaway_id, broadcaster_id, title, code, rules_json, claim_seconds,
           status, closes_at, seed, entrant_count, ticket_total, role_refresh_failures,
           eventsub_failures, chat_unavailable, roles_refresh_at, mirror_pending)
entries(platform, platform_user_id, login, display_name, group_name, tickets, entered_at,
        PRIMARY KEY (platform, platform_user_id)) WITHOUT ROWID
channel_roles(platform, platform_user_id, role, fetched_at,
              PRIMARY KEY (platform, platform_user_id, role)) WITHOUT ROWID
draws(n, platform, platform_user_id, drawn_at, claim_until, claimed_at, claimed_via, rerolled,
      PRIMARY KEY (n))
```

Left out of the M1 schema because M2 adds them: `merkle_root`, `drand_round` and the per-entry `salt`. There is
no `usage_daily` table (see Hosting) and no `giveaways.platforms` column (see Platforms).

- `giveaways.status` and `room_state.status` are `open`, `closed` or `drawn`. The room owns the status, the
  accounts store mirrors it, and the room alarm retries a mirror that failed.
- `overlay_token`: the credential of the read-only overlay URL of the live page, compared in constant time.
- `room_state.seed`: 32 random bytes written at the draw (see The draw).

- `draws.claimed_via`: `rafflink` (the winner pressed Claim), `chat` (the chat watch saw a message) or
  `manual` (the streamer marked it while the chat watch was down).
- `giveaways.rules_json` also holds the claim keyword (empty = any message counts). A row with
  `rerolled` set keeps its place, so the draw history stays checkable.

- `refresh_token_enc`: AES-GCM with a key held in a Worker secret. Deleted when validation returns 401 or the
  streamer signs out.
- `channel_roles`: VIP and moderator lists, fetched with the streamer's token when entries open and refreshed
  every 5 minutes by a Durable Object alarm while entries are open. A VIP added in the last 5 minutes may
  enter as a plain viewer; the alarm interval is a setting.
- `salt` (M2): 16 random bytes per entry, shown only to that entrant, used for the Merkle proof (see The draw).

Viewer access tokens are used during the entry request and then dropped. Rafflink does not store them.

## The draw

Goal: the winner follows from data fixed before anyone can know the random value.

**M1 draw.** M1 uses the function the M2 verify page recomputes, without the Merkle tree and drand. The streamer
closes entries, the room creates a 32-byte random seed at the draw and stores it with the picks. Winner `n` is
`HMAC-SHA256(seed, n)` mapped to a ticket index over the entries sorted by `(platform, platform_user_id)`, with
rejection sampling. An entrant is never picked twice, and a reroll takes the next `n`. M2 swaps the random seed
for a drand round and adds the Merkle root, as described next.

1. **Close.** The Durable Object sorts entries by `(platform, platform_user_id)` and builds a Merkle tree.
   Each leaf is `SHA-256(platform | platform_user_id | tickets | salt)`. It publishes the Merkle root, the
   entrant count, the total tickets and the leaf list (hashes and tickets only, no names).
2. **Commit to future randomness.** At close it also publishes a drand round number: the first round of the
   drand `quicknet` beacon at least 30 seconds in the future. drand is a public randomness beacon run by
   independent organizations (Cloudflare is one); nobody can predict a round before it is produced, and
   anyone can verify its signature.
3. **Draw.** When the round exists, the seed is its randomness. Winner `n` is picked by
   `HMAC-SHA256(seed, n)` mapped to a ticket index over the sorted leaves, rejection sampling to avoid modulo
   bias. A reroll takes the next `n`; the streamer cannot choose which entrant comes next.
4. **Verify.** The giveaway page shows the root, the round, the leaf list and a "Verify" button that
   recomputes the winner in the browser. Each entrant sees their own leaf preimage and its Merkle proof, so
   they can check they were in the list that was drawn.

The salt keeps the published leaves from being reversed: Twitch user ids are short numbers, so a plain hash
of the id could be brute-forced into a list of who entered.

## Abuse

- One entry per platform account, enforced by the primary key.
- Optional minimum account age (Twitch `created_at`), against fresh bot accounts.
- Cloudflare rate limiting on the entry endpoint (M2) keyed by platform user id after sign-in, with a loose per-IP
  limit (for example 60 per minute) only as a backstop. Mobile networks put many viewers behind one IP
  (carrier-grade NAT), so a strict per-IP limit would block real viewers.
- The OAuth `state` and `nonce` are bound to the giveaway and a short-lived cookie, against forged sign-ins.

## Privacy

- Stored per entrant: platform, user id, login, display name, group, tickets, time (and the salt from M2).
- Entries are deleted 30 days after the giveaway closes (the deletion job comes in M2); the winner list, Merkle
  root and leaf list stay with the giveaway.
- Rafflink asks only for read scopes and never posts to chat.
- Chat is read only during claim windows. Messages are matched in memory and never stored.

## Milestones

1. **M1, Twitch MVP:** Twitch app registration (a README step), streamer sign-in, create giveaway with a short
   code, viewer entry with sub, follow, VIP and moderator rules, retry and token queue, live page and overlay
   link, draw (HMAC over a random seed), claim (button and automatic chat claim over EventSub) and reroll,
   hourly token validation, day usage read from the Cloudflare Analytics API, two deployment targets with a
   shared contract suite, README with self-host steps. Includes a test of sign-in in the in-app browser of the
   Twitch mobile app (iOS and Android), run by the owner on a phone: if it does not keep the viewer's Twitch
   session, "one click" becomes "log in, then click", and the page should offer "Open in browser".
2. **M2, Hardening:** load test at 500 entries per second, rate limits, Merkle root and drand draw with the
   verify page, data deletion job.
3. **M3, Winner form:** the streamer builds a form the winner fills in after claiming (for example a shipping
   address). Answers are personal data: encrypted at rest, visible only to the streamer, deleted 30 days after
   the claim, with a privacy notice on the form. Needs its own short spec before work starts.
4. **M4, Streamer Giveaway link:** the desktop app can show a Rafflink giveaway's entrants and draw.
5. **M5, Kick and YouTube** providers.

## Open questions

1. What is the real limit of the Twitch token endpoint? Ask on the Twitch developer forum or Discord before
   launch; it decides how often the queue runs.
2. Verify the Workers Paid figures on the Cloudflare pricing page before moving the hosted service to Paid.

## Decisions (2026-11-20)

- VIP and moderator tickets are in v1.
- Viewers sign in with the code flow plus a queue for the token endpoint.
- Hosting: hosted service plus self-host; hosted starts on the free plan, moves to Paid by the rule in Hosting.
- Winner: the streamer announces; the winner claims with the Claim button or by writing in chat, which
  Rafflink detects over EventSub during the claim window. Rafflink never posts to chat.
- Winner form comes as M3, after hardening.
- Short 5-character codes, link `rafflink.app/<code>`.
- Domain: only `rafflink.app`.
- Frontend: React single-page app bundled by `bun build` (no Vite); the same static build is served by Workers
  static assets or by the VPS server.
- Hosting targets: Cloudflare and a VPS from one core with ports and a shared contract test suite.
- Code: public repo `vengex-org/rafflink` on GitHub, license AGPL-3.0.

Decisions made while building M1 (2026-11-20):

- Hourly token validation is in M1, not M2: Twitch requires it from the moment an app keeps an OAuth session.
- Daily usage is read from the Cloudflare GraphQL Analytics API on demand; there is no `usage_daily` table.
- The M1 draw is `HMAC-SHA256(seed, n)` with a random 32-byte seed; M2 only swaps the seed for a drand round.
- The broadcaster cannot enter their own giveaway.
- The live page has a read-only overlay URL with an unguessable token for OBS.
- Short codes use a 32-character alphabet (33.5 million codes).
- Only a token-endpoint 429 or 5xx queues a code. A Helix failure after the exchange answers "Try again".
- Title and prize are optional; the page shows a neutral fallback when they are missing.
- Twitch app registration is a step for the owner, written in the README. The code reads `TWITCH_CLIENT_ID` and
  `TWITCH_CLIENT_SECRET` from the environment.
- EventSub over WebSocket has known limits (3 connections per user token, no replay), see Chat watch.

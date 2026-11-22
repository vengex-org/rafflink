# Rafflink: initial spec

Status: final for M1, 2026-11-20. Domain: `rafflink.app` (free at the Google registry on 2026-11-20, not yet bought).

## Why

Chat giveaways stop working on big channels. When thousands of people type the keyword at once, entries
reach the giveaway tool slower than people type them. A chat giveaway can take a long time to collect 8,000
valid entries.

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
  would have to run during the whole giveaway, not only from the draw until the reroll window ends.
- Winner form (for example a shipping address). Planned in M8 (#73), see Milestones.
- Messages to chat. Rafflink never posts to chat; the streamer announces the winner.
- A mobile app.

## Hosting

Both: one hosted service at `rafflink.app`, and open source with a self-host guide for streamers who want
their own Cloudflare account and Twitch app.

The hosted service starts on the Cloudflare free plan and moves to Workers Paid (5 USD per month) when load
needs it. The free plan fits about 4 giveaways of 12,000 entries per day for all streamers together (see Load
budget), and over a limit entries fail. So the hosted service:

- reads the day's Worker and Durable Object requests from the Cloudflare GraphQL Analytics API on demand,
  when the admin page opens, then every 10 seconds while its tab is visible (the answer is reused for 5
  seconds), and when a giveaway is created, and shows the remaining budget on the admin page. Counting every request in D1 would cost about 12,000 D1 writes per giveaway against a free limit of
  100,000 per day, so nothing is counted per request;
- moves to Paid on the first day that uses 70% (USAGE_ALERT_PERCENT) of any daily limit, when the admin page warns;
- warns the admin on the admin page once the day's Worker or Durable Object requests reach 70%
  (`USAGE_ALERT_PERCENT`, the owner's choice of 2026-11-22) of the daily limit, naming the limit and the
  percentage, with the hint to switch to Paid after paying;
- warns a streamer at giveaway creation when less than 25,000 Worker requests are left for the day.

**Plan switch (decided 2026-11-22).** Cloudflare cannot upgrade an account on its own, so the move to Paid
is manual: the owner pays for Workers Paid in the Cloudflare dashboard, then switches the plan on the admin
page (Free or Paid, with a confirm step). The choice is stored in the accounts store (`cloudflare_plan`);
until the first switch `CLOUDFLARE_PLAN` (default `free`) applies. Every consumer reads the limits of the
current plan at runtime, without a deploy:

- the usage meter compares against the plan's daily limits. Free: 100,000 Worker and 100,000 Durable Object
  requests a day. Paid has no daily cap, only a monthly allowance that is billed beyond it, so the admin page
  shows the day's count without a bar and lists the monthly allowance, and nothing alerts;
- the token queue Durable Object reads the plan once when it starts, and the switch pushes the new plan to it,
  so no alarm invocation reads D1. Free budgets 45 of its 50 subrequests per invocation, Paid 9,000 of its
  default 10,000;
- `WORKER_REQUEST_LIMIT`, `DURABLE_OBJECT_REQUEST_LIMIT` and `QUEUE_SUBREQUESTS_PER_INVOCATION` override the
  plan's value when set.

This applies to the Cloudflare target only. The VPS target has no daily request limit, reports no usage and
shows no plan switch.

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
5. Closes entries and draws winners one at a time, as many as they want, and announces them on stream.
6. Sees on the live page whether each winner has claimed, and how (button, chat or by hand). Rerolls a winner who did
   not claim within the claim time.

**Claim.** A winner claims in one of three ways:

- **In Rafflink:** the giveaway page shows the winner a "Claim" button after they sign in. Claim time is a
  giveaway setting (default 5 minutes after the draw). The page shows the remaining time.
- **In chat:** the winner writes in the streamer's chat and Rafflink marks the claim automatically. By default
  any message from the winner's account counts; the streamer can require a keyword instead (for example
  `!claim`). The match is on the Twitch user id, not the display name, so a look-alike name cannot claim.
- **By the streamer:** when the winner confirms elsewhere (Discord, voice), the streamer presses "Mark as
  claimed" on the live page. It works for any pick that is neither claimed nor rerolled, also after the claim
  time, and is recorded as `manual`.

**Chat watch.** Rafflink reads chat from the draw until the giveaway is finished: the reroll window
(`REROLL_WINDOW_SECONDS`, default one hour) after the latest claim time of a pick that is not rerolled. Claims
happen only in the claim window; the rest of the watch shows the winners' newest messages on the live page:

- The giveaway's Durable Object opens a Twitch EventSub WebSocket (`wss://eventsub.wss.twitch.tv/ws`) and
  subscribes to `channel.chat.message` for the streamer's channel, with the streamer's token (scope
  `user:read:chat`, the streamer is both broadcaster and reading user).
- Each message from a current winner's user id within `claim_until` sets `claimed_at` and
  `claimed_via = chat`. The live page shows the newest messages (up to `LIVE_WINNER_CHAT_MAX`) of every winner
  whose pick is not rerolled, claimed or not; they live in the room's memory only, never in SQL, D1 or logs,
  and the overlay never receives them. All other messages are dropped and not stored.
- A reroll stops the replaced winner's messages. The object closes the WebSocket, and forgets the messages,
  when the reroll window ends or no pick is left to watch.
- EventSub WebSocket rules: subscribe within 10 seconds of the welcome message, reconnect on
  `session_reconnect`, treat a missed keepalive as a dropped connection and reconnect.
- Cost: messages arrive on an outgoing WebSocket, so they are not Worker or DO requests. The object stays awake
  while the socket is open (no hibernation for outgoing sockets), about 500 GB-s for the longest watch
  (the 5-minute claim time plus up to 3600 s of reroll window, at 128 MB), so the free 13,000 GB-s per day cover
  about 25 such giveaways. To confirm against Cloudflare's billing docs.
- If the WebSocket cannot connect (token revoked, Twitch down), the live page says "Chat claim unavailable"
  and the streamer marks the claim by hand.
- Known limits of EventSub over WebSocket:
  - Twitch allows at most 3 WebSocket connections per user token. A streamer with more than 3 giveaways that
    are being watched at the same time gets "Chat claim unavailable" on the extra ones.
  - Events sent while a connection is being replaced, or after it dropped, are not replayed. A winner's chat
    message in that gap is missed, and the winner has to claim with the button or the streamer marks it by
    hand.

The streamer may reroll an unclaimed pick at any time, also during its claim time, for `REROLL_WINDOW_SECONDS` (default one hour after the last claim time) while an entrant is left to pick. The streamer checks whether the winner met the conditions of the giveaway and draws the next one if not, so waiting would only slow that down. Every reroll stays on the public verify page, with the picks skipped before each final winner. Rafflink does not reroll by itself.

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

Same model as common chat giveaway tools, so streamers know it already:

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
- The queue drains codes with an alarm, one pass per second, and runs steps 2 to 5 for each. One queue serves
  the whole deployment, because the limit is per `client_id`.
- The drain rate follows AIMD (decided 2026-11-22). The first 429 of a backlog pauses the queue for a few
  seconds (`QUEUE_COOLDOWN_SECONDS`), then it drains at 2/3 (`QUEUE_DECREASE_PERCENT`) of the rate that
  triggered the 429. The rate then grows by a step (`QUEUE_INCREASE_STEP_PER_SECOND`) every second
  (`QUEUE_INCREASE_INTERVAL_SECONDS`) until the next 429 cuts it to 2/3 again, without another pause.
  `QUEUE_MIN_RATE_PER_SECOND` and `QUEUE_MAX_RATE_PER_SECOND` are only safety rails.
- On Cloudflare one alarm invocation may send only 50 external subrequests on Workers Free, and one queued
  code sends up to 8 Twitch requests. So an invocation processes at most the plan's subrequest budget (Free
  45, see Hosting) / 8 = 5 codes, and the alarm fires again right away until the pass of that second has its calls. A 429
  counts every call of the second, over all its invocations. Each invocation waits for its Twitch answers, so
  on Free the queue drains a few codes per second however high the rate is; the Bun server has no such cap.
- The rate that triggered a 429 is measured where it is visible. While the queue drains, it is the number of
  calls in the pass that got the 429: the queue is then the only caller. For a 429 on the direct path, no
  part of the system sees the global rate (callbacks run in many Worker instances), so the queue takes the
  entries the giveaway's room wrote in the second before the 429 (`QUEUE_RATE_WINDOW_SECONDS`): about what
  the token endpoint let through. This costs one room request per burst, not one per callback. It is exact
  for one big giveaway; with several giveaways at once it sees only that giveaway's share, so the queue
  starts lower than it could and the additive steps make up the difference. It never starts higher.
- The page asks for the result every 3 seconds (`GET /api/g/<code>/pending/<ticket>`), at most 2 minutes.
- An authorization code expires after a few minutes (Twitch does not document the exact time; OAuth
  recommends 10 minutes at most). Codes older than 5 minutes are dropped, and the page shows
  "Enter with Twitch" again.
- While the queue holds a backlog, new callbacks join the queue instead of calling the token endpoint, so they
  neither overtake the viewers already waiting nor spend the rate the queue drains at. Each enqueue answers
  until when that holds: the end of the pause, or a lease of a few seconds (`QUEUE_BACKLOG_LEASE_SECONDS`)
  while the codes ahead need more than the next second. Every later enqueue replaces the answer, so routing
  follows the backlog within seconds. A Worker instance that has not queued a code yet learns it from its own
  first 429.

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

Above free: Workers Paid at 5 USD per month removes the daily caps and includes 10 million Worker requests a
month (then 0.30 USD per million) and 1 million DO requests a month (then 0.15 USD per million), and allows
10,000 subrequests per invocation by default (Cloudflare docs, read 2026-11-22: workers/platform/limits,
workers/platform/pricing, durable-objects/platform/pricing). That is roughly 400 giveaways of 12,000 entries per month for 5 USD. When
to move the hosted service to Paid: see Hosting.

A load test at 500 entries per second against one Durable Object is a v1 acceptance check.

## Data

M1 schema. The SQL files in `packages/core/schema/` are the only source of the tables. The accounts store is D1
on Cloudflare and `accounts.sqlite` on the VPS. Each giveaway room is the SQLite of its Durable Object on
Cloudflare and one file per giveaway on the VPS.

```
-- accounts store (D1 or accounts.sqlite)
streamers(id, platform, platform_user_id, login, display_name, profile_image_url, created_at,
          approved_at, approved_by, UNIQUE (platform, platform_user_id))
streamer_tokens(streamer_id, refresh_token_enc, scopes, validated_at,
                PRIMARY KEY (streamer_id))
giveaways(id, code UNIQUE, streamer_id, title, prize, rules_json, status,
          closes_at, claim_seconds, overlay_token, created_at)
cloudflare_plan(id CHECK (id = 1), plan CHECK (plan IN ('free', 'paid')), changed_at, changed_by)
metrics_minute(minute, entries, claims, PRIMARY KEY (minute)) WITHOUT ROWID   -- admin chart, aggregate
referrals(day, ref, count, PRIMARY KEY (day, ref)) WITHOUT ROWID              -- ?ref= visits, aggregate
-- indexes for the admin statistics: giveaways(created_at), giveaways(created_at) WHERE status = 'open',
-- streamers(created_at)

-- token queue (its own Durable Object or SQLite file)
token_queue(ticket, code, giveaway_id, nonce, received_at, state, result_json,
            PRIMARY KEY (ticket)) WITHOUT ROWID
queue_stats(id, rate_per_second, rate_changed_at, cooldown_until, measure_giveaway_id, measure_until,
            dropped, abandoned_results, lost_claims, rate_limited_total, last_rate_limited_at)
rate_limited_minute(minute, count, PRIMARY KEY (minute)) WITHOUT ROWID

-- inside each giveaway's room
room_state(id, platform, giveaway_id, broadcaster_id, title, code, rules_json, claim_seconds,
           status, closes_at, seed, entrant_count, ticket_total, role_refresh_failures,
           eventsub_failures, chat_unavailable, roles_refresh_at, mirror_pending,
           merkle_root, drand_round, committed_at, drand_chain_hash, drand_genesis_seconds,
           drand_period_seconds, winner_count, draw_requested, metrics_reported_until)
entries(platform, platform_user_id, login, display_name, profile_image_url, group_name, tickets, entered_at, salt,
        PRIMARY KEY (platform, platform_user_id)) WITHOUT ROWID
channel_roles(platform, platform_user_id, role, fetched_at,
              PRIMARY KEY (platform, platform_user_id, role)) WITHOUT ROWID
draws(n, platform, platform_user_id, drawn_at, claim_until, claimed_at, claimed_via, rerolled,
      leaf_index, PRIMARY KEY (n))
leaves(chunk, data)
```

Room migration 0003 adds `merkle_root`, `drand_round`, the commit time and the drand chain of the commit,
`winner_count` (existing rooms get 1), `entries.salt`, `draws.leaf_index` and `leaves` (the leaf
list, 1000 leaves of 40 bytes per row). Room migration 0005 adds `draw_requested`. All are nullable or new, so a room created before it keeps working. There is
no `usage_daily` table (see Hosting) and no `giveaways.platforms` column (see Platforms).

- `giveaways.status` and `room_state.status` are `open`, `closed` or `drawn`. The room owns the status, the
  accounts store mirrors it, and the room alarm retries a mirror that failed.
- `overlay_token`: the credential of the read-only overlay URL of the live page, compared in constant time.
- `room_state.seed`: 32 bytes written at the draw: the randomness of the drand round in `drand_round` (a room
  drawn before 0003 holds 32 random bytes and no root; the verify page reports it as unverifiable).

- `draws.claimed_via`: `rafflink` (the winner pressed Claim), `chat` (the chat watch saw a message) or
  `manual` (the streamer marked it by hand, at any time after the draw).
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
   Each leaf is `SHA-256(platform | platform_user_id | tickets | salt)`, and the tree is built over
   `SHA-256(0x00 | leaf | tickets)`, so the root also binds the ticket counts the draw uses. It publishes the Merkle root, the
   entrant count, the total tickets and the leaf list (hashes and tickets only, no names).
2. **Commit to future randomness.** At close it also publishes a drand round number: the first round of the
   drand `quicknet` beacon at least `DRAND_LEAD_SECONDS` (default 6, two rounds) after the commit. drand is a public randomness beacon run by
   independent organizations (Cloudflare is one); nobody can predict a round before it is produced, and
   anyone can verify its signature. The commit time and the chain are published with the root.
3. **Draw.** When the round exists, the seed is its randomness. Winner `n` is picked by
   `HMAC-SHA256(seed, n)` mapped to a ticket index over the sorted leaves, rejection sampling to avoid modulo
   bias. Every press of "Draw winner" takes the next `n` among the entrants not picked yet, and so does a reroll;
   the streamer cannot choose which entrant comes next, and the picks stay a fixed sequence of the seed.
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

- Stored per entrant: platform, user id, login, display name, profile picture URL, group, tickets, time (and the salt from M2).
- Entries and the channel role lists are deleted 30 days after the giveaway closes (`ENTRY_RETENTION_SECONDS`), by
  the room alarm; every pick, rerolled ones included, with the user id, login and display name (copied at pick
  time, no profile picture), counts, Merkle root and leaf list stay with the giveaway.
- A giveaway stays until its streamer deletes it, or all their data, on the dashboard, or until
  `HISTORY_RETENTION_DAYS` after its close, once drawn, when the operator sets it. An admin can replace one winner's name with
  "removed" on request.
- Rafflink asks only for read scopes and never posts to chat.
- Chat is read from the draw until the giveaway is finished. Messages are matched in memory and never stored or logged.

## Milestones

Milestone names and issue numbers match GitHub. There is no M3.

1. **M1, Twitch MVP:** Twitch app registration (a README step), streamer sign-in, create giveaway with a short
   code, viewer entry with sub, follow, VIP and moderator rules, retry and token queue, live page and overlay
   link, draw (HMAC over a random seed), claim (button and automatic chat claim over EventSub) and reroll,
   hourly token validation, day usage read from the Cloudflare Analytics API, two deployment targets with a
   shared contract suite, README with self-host steps. Includes a test of sign-in in the in-app browser of the
   Twitch mobile app (iOS and Android), run by the owner on a phone: if it does not keep the viewer's Twitch
   session, "one click" becomes "log in, then click", and the page should offer "Open in browser".
2. **M2, Hardening:** load test at 500 entries per second, rate limits, Merkle root and drand draw with the
   verify page, data deletion job.

3. **M4, Platforms:** provider interface (#56), rules by platform capability (#57), Kick (#58), YouTube (#59).
4. **M5, Chat entry:** Twitch chat keyword entry (#60), Kick and YouTube chat entry (#61).
5. **M6, Parity:** automatic entry on sub and channel points (#62), block list and exclusions (#63), moderator
   access link (#64), several winners in one press (#65), overlay styles (#66), six more languages (#67),
   verifiable list draw (#68).
6. **M7, History:** long-term history with winner names, export and deletion (#69), public streamer history (#70).
7. **M8, Extras:** one giveaway across platforms (#71), official rules text (#72), winner form for prize
   delivery (#73). The winner form collects personal data (for example a shipping address): encrypted at rest,
   visible only to the streamer, deleted 30 days after the claim, with a privacy notice on the form. Needs its
   own short spec before work starts.

## Open questions

1. What is the real limit of the Twitch token endpoint? Ask on the Twitch developer forum or Discord before
   launch; it tells whether the queue's default rate steps fit or need tuning.
2. Verify the Workers Paid figures on the Cloudflare pricing page before moving the hosted service to Paid.

## Decisions (2026-11-20)

- VIP and moderator tickets are in v1.
- Viewers sign in with the code flow plus a queue for the token endpoint.
- Hosting: hosted service plus self-host; hosted starts on the free plan, moves to Paid by the rule in Hosting.
- Winner: the streamer announces; the winner claims with the Claim button or by writing in chat, which
  Rafflink detects over EventSub during the claim window (the winner's later messages only show on the live page). Rafflink never posts to chat.
- Winner form comes after hardening, now in M8 (#73).
- Short 5-character codes, link `rafflink.app/<code>`.
- Domain: only `rafflink.app`.
- Frontend: React single-page app bundled by `bun build` (no Vite); the same static build is served by Workers
  static assets or by the VPS server.
- Hosting targets: Cloudflare and a VPS from one core with ports and a shared contract test suite.
- Code: public repo `vengex-org/rafflink` on GitHub, license AGPL-3.0.

Who may create giveaways (owner decision, 2026-11-22):

- `OPEN_SIGNUP` (default false) decides it. The hosted service sets it to true and every signed-in streamer may
  create giveaways. A self-hosted install leaves it false: a new streamer can sign in but gets 403
  `streamer_not_approved` on creating a giveaway until an admin approves the account on the admin page ("Streamer
  access": waiting and approved lists, Approve and Revoke). Accounts in `ADMIN_TWITCH_IDS` are always allowed.
- The approval is `streamers.approved_at` and `approved_by` (migration 0007). `/api/session` tells the web app
  `canCreate`, and the dashboard shows a waiting notice instead of the create buttons. Revoking keeps the
  streamer's existing giveaways and stops new ones.

Token queue drain rate (owner decision, 2026-11-22):

- The queue adapts its rate like TCP AIMD instead of a fixed start rate and a hard cap of 50 per second: a short
  pause after each 429, then 2/3 of the rate that triggered it, then additive steps until the next 429. Viewers
  queue behind a backlog instead of calling the token endpoint directly. The details are in "Queue for the token
  endpoint" above.

Decisions on support and reach (owner decision, 2026-11-21):

- An optional `DONATE_URL` (https only, unset by default) gives a quiet support link: an item in the home page footer
  for every visitor, a line above the drawn giveaways on the dashboard, an entry in the account menu and a link
  in the settings panel of the streamer's live page, hidden with the controls. It reaches the web app in the
  `/api/session` answer and in the owner's `/api/live/:id` answer; viewer pages and the overlay
  never show it (owner decision, 2026-11-22).
- The privacy policy and the terms are a generic template (owner decision, 2026-11-22). The operator's details come
  from the optional `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_ID`, `OPERATOR_EMAIL` and `LEGAL_UPDATED` keys and
  reach the web app as the `operator` object of `/api/session`, which is null while `OPERATOR_NAME` is unset; the
  pages then say the operator has published no contact details. The hosted service's own details live only in its
  private deployment config, never in this repository.
- The home page of this repository is intentionally plain. A hosted deployment replaces the one module
  `apps/web/src/site/site.tsx` at build time, which exports `HomePage`, `SiteNav` and `siteRoutes`.
- The OBS overlay shows the host it is served from, with the logo mark, on a small plate under the plates while a
  draw runs and after it. It stays off while the entry plate already shows the host and on the blank winner-only
  overlay before a draw.

Decisions made while building M2 H2, Merkle root and drand draw (2026-11-21):

- The room commits from its alarm right after the close and again at the draw if the alarm has not run; `close()`
  stays synchronous. The draw never uses local randomness: while the round is missing it answers `round-pending`
  (409) or `beacon-unavailable` (503) and draws nothing.
- One pick per press (owner decision, 2026-11-21): `draw` adds pick `max(n) + 1` of the seeded order, skipping every
  earlier pick, rerolled ones included. The streamer may draw more than `winner_count`, which is only the planned count
  the live page measures progress against (editable at any time). `DRAW_MAX_WINNERS` caps the stored picks. The verify page
  replays any number of picks. Drawing the first pick of a room nobody entered still moves it to drawn.
- Draw shuffle (owner decision, 2026-11-21): while a draw is pending the stage and the OBS overlay flash entrant names in
  the winner slot, and every later pick shuffles for at least 1.5 s before it shows. The names are a random sample of
  up to `LIVE_SHUFFLE_NAMES` entrants in the snapshot (`shuffleNames`, while the room is closed and asked to draw or
  committed, and once drawn, so a next draw or reroll shuffles with names at hand), picked without regard to the draw. Under `prefers-reduced-motion` the slot shows the countdown instead.
- Draw is always on the live page (owner decision, 2026-11-21). Pressed while entries are open, it closes them and sets
  `room_state.draw_requested`; the room alarm commits, wakes at the time of the round, and draws pick 0 itself
  (`AlarmDuties.draw`), retrying every drand period until the round is `DRAND_PUBLISH_MARGIN_SECONDS` late, then
  dropping the request. It runs in the room, not the page, so it survives a closed tab. The snapshot carries
  `drawAvailableAt`, the instant the committed round is published, and `drawRequested`; the live page counts down
  to the first and a `round-pending` answer also sets the request.
- Leaf = SHA-256(`platform|platformUserId|tickets|` + salt), tree leaf = SHA-256(0x00 + leaf + tickets as 8
  bytes, big-endian), node = SHA-256(0x01 + left + right), an odd node moves up unchanged. The drand signature is
  not verified with BLS on the Worker (10 ms CPU limit); the Worker pins the chain hash in the request path and
  checks that randomness is SHA-256 of the signature. The verify page does check the BLS signature in the browser.
- The winner count no longer limits the draw (owner decision, 2026-11-21, replaces the review of PR 11 rule that fixed
  it before the round). A streamer can draw until an accomplice comes up, the same as with rerolls, which stay allowed
  at any time. The seeded order stays fixed and the verify page lists every pick and every reroll, so the extra draws
  are visible.
- An open or closed room from before the migration gets salts at commit and draws the new way; a room that was
  already drawn stays on its random seed and is reported unverifiable.

Decisions made while building M1 (2026-11-20):

- Hourly token validation is in M1, not M2: Twitch requires it from the moment an app keeps an OAuth session.
- Daily usage is read from the Cloudflare GraphQL Analytics API on demand (the admin page polls it every 10
  seconds while visible); there is no `usage_daily` table.
- The M1 draw is `HMAC-SHA256(seed, n)` with a random 32-byte seed; M2 only swaps the seed for a drand round.
- The broadcaster cannot enter their own giveaway.
- The live page has a read-only overlay URL with an unguessable token for OBS.
- Short codes use a 32-character alphabet (33.5 million codes).
- Only a token-endpoint 429 or 5xx queues a code. A Helix failure after the exchange answers "Try again".
- Title and prize are optional; the page shows a neutral fallback when they are missing.
- Twitch app registration is a step for the owner, written in the README. The code reads `TWITCH_CLIENT_ID` and
  `TWITCH_CLIENT_SECRET` from the environment.
- EventSub over WebSocket has known limits (3 connections per user token, no replay), see Chat watch.

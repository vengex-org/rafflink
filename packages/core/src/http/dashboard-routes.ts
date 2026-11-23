import { Hono, type Context, type MiddlewareHandler } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { timingSafeEqual } from "hono/utils/buffer"
import type {
  Giveaway,
  NewGiveaway,
  StreamerBlock,
  StreamerRecord,
} from "../accounts/account-store.ts"
import { canCreateGiveaways } from "../accounts/streamer-access.ts"
import { parseOverlayTheme, type OverlayTheme } from "../domain/overlay-theme.ts"
import type { ChannelEntryVia, GiveawayRules } from "../domain/rules.ts"
import { generateCode } from "../lib/codes.ts"
import { csvText } from "../lib/csv.ts"
import { errorClass } from "../lib/error-class.ts"
import { randomId } from "../lib/random-id.ts"
import { UsageUnavailable } from "../lib/usage-unavailable.ts"
import { currentPlan } from "../plan/current-plan.ts"
import {
  cloudflarePlans,
  overriddenLimits,
  planLimits,
  type CloudflarePlan,
  type PlanLimits,
} from "../plan/plan-limits.ts"
import { usageAlerts, usageOf, type Usage } from "../plan/usage.ts"
import {
  overlaySnapshot,
  type MarkDeliveredOutcome,
  type WinnerPick,
} from "../room/giveaway-room.ts"
import { pushBlockList } from "../room/room-exclusions.ts"
import { deleteGiveaway } from "../room/delete-giveaway.ts"
import { mirrorStatus } from "../room/mirror-status.ts"
import { denseDays, denseMinutes } from "../stats/series.ts"
import { liveGiveaways } from "../stats/live-giveaways.ts"
import { dayMs, minuteMs, startOfDay, startOfMinute } from "../stats/time.ts"
import { PlatformError } from "../platform/errors.ts"
import { providerFor, readyEntryWays, type PlatformAccount } from "../platform/provider.ts"
import { openStreamerAccess } from "../accounts/streamer-token.ts"
import type { Instant } from "../ports.ts"
import { parseCreateGiveaway, parseWinnerCount } from "./create-input.ts"
import type { AppDeps } from "./deps.ts"
import {
  dashboardGiveaway,
  objectField,
  readJson,
  type AdminAccessCountsJson,
  type AdminPlanJson,
  type AdminStreamerJson,
  type AdminStreamerListJson,
  type AdminStatsJson,
  type AdminStreamersJson,
  type AdminUsageJson,
  type BlockListJson,
  type GiveawayOverlayThemesJson,
  type OverlayThemeJson,
  type OwnerLiveSnapshot,
  type PointsRewardsJson,
  type RequestBudgetJson,
  type YouTubeBudgetJson,
} from "./json.ts"
import {
  closeEntries,
  drawWinner,
  entrantsPage,
  initRoom,
  integerField,
  integerQuery,
  markClaimed,
  rerollPick,
  subscriberBadges,
} from "./live-actions.ts"
import { sameOriginJson } from "./origin.ts"
import { historyCacheKey } from "./history-routes.ts"
import { deletePublicCache, readPublicCache, writePublicCache } from "./public-cache.ts"
import { endStreamerSession, type StreamerSession } from "./session.ts"
import { requireStreamer, type StreamerEnv } from "./session-routes.ts"
import { webSocketOrigin } from "./websocket-origin.ts"
import { winnerAnswersJson } from "./winner-answers.ts"

type Env = StreamerEnv

export function dashboardRoutes(deps: AppDeps): Hono<Env> {
  const app = new Hono<Env>()

  app.use("/api/live/:id", webSocketOrigin(deps.config, { allowMissing: false }))
  app.use("/api/overlay/:id/:token", webSocketOrigin(deps.config, { allowMissing: true }))
  app.use("/api/dash/*", requireStreamer(deps))
  app.use("/api/live/*", requireStreamer(deps))
  app.use("/api/admin/*", requireStreamer(deps), requireAdmin(deps))

  app.post("/api/dash/giveaways", async (c) => {
    if (!(await canCreateGiveaways(deps.config, deps.admins, c.get("account")))) {
      return c.json({ error: "streamer_not_approved" }, 403)
    }
    const streamer = c.get("streamer")
    const parsed = parseCreateGiveaway(
      await readJson(c),
      deps.clock.now(),
      deps.config,
      providerFor(deps.platforms, streamer.platform).capabilities,
    )
    if (!parsed.ok) return c.json({ error: "invalid-input", ...parsed.issue }, 400)
    if (!(await channelEntryReady(deps, streamer, parsed.value.rules))) {
      return c.json({ error: "reconnect" }, 422)
    }
    // A YouTube chat watch spends the install's daily units, so one that cannot read until its close and
    // through its claim time is refused.
    const budget = streamer.platform === "youtube" ? await youtubeBudget(deps) : null
    if (budget !== null) {
      const needed = youtubeUnitsNeeded(budget, parsed.value, deps.clock.now())
      if (needed > budget.remaining) {
        return c.json({ error: "youtube-quota", needed, remaining: budget.remaining }, 409)
      }
    }
    const created = await insertWithFreshCode(deps, {
      id: randomId(deps.random),
      streamerId: streamer.streamerId,
      title: parsed.value.title,
      prize: parsed.value.prize,
      rules: parsed.value.rules,
      closesAt: parsed.value.closesAt,
      claimSeconds: parsed.value.claimSeconds,
      winnerCount: parsed.value.winnerCount,
      overlayToken: randomId(deps.random),
      createdAt: deps.clock.now(),
    })
    if (created === null) {
      console.warn("giveaway code retries exhausted", { streamerId: streamer.streamerId })
      return c.json({ error: "code-unavailable" }, 503)
    }
    const giveaway = await deps.accounts.findOwnedGiveaway(streamer.streamerId, created.id)
    if (giveaway === null) throw new Error("created giveaway not found")
    const roomReady = await initRoom(deps, giveaway)
    return c.json(
      { giveaway: dashboardGiveaway(giveaway), roomReady, warnings: await usageWarnings(deps) },
      201,
    )
  })

  app.get("/api/dash/giveaways", async (c) => {
    const giveaways = await deps.accounts.listGiveaways(c.get("streamer").streamerId)
    return c.json({ giveaways: giveaways.map(dashboardGiveaway) })
  })

  app.post("/api/dash/giveaways/:id/close", (c) =>
    withOwnedRoom(c, deps, (giveaway) => closeEntries(c, deps, giveaway, "streamer")),
  )

  app.post("/api/dash/giveaways/:id/winners", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const body = await readJson(c)
      // Absent is not "one winner" here: a request that names no count is a bad request.
      const count = parseWinnerCount(objectField(body, "count") ?? null, deps.config)
      if (!count.ok) return c.json({ error: "invalid-input", field: "count" }, 400)
      await deps.rooms.get(giveaway.id).setWinnerCount(count.value)
      return c.json({ kind: "set" })
    }),
  )

  app.post("/api/dash/giveaways/:id/draw", (c) =>
    withOwnedRoom(c, deps, (giveaway) => drawWinner(c, deps, giveaway, "streamer")),
  )

  app.post("/api/dash/giveaways/:id/reroll", (c) =>
    withOwnedRoom(c, deps, (giveaway) => rerollPick(c, deps, giveaway, "streamer")),
  )

  app.post("/api/dash/giveaways/:id/claim", (c) =>
    withOwnedRoom(c, deps, (giveaway) => markClaimed(c, deps, giveaway, "streamer")),
  )

  app.get("/api/dash/giveaways/:id/winners.csv", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const picks = await deps.rooms.get(giveaway.id).picks()
      c.header("Cache-Control", "no-store")
      c.header(
        "Content-Disposition",
        `attachment; filename="rafflink-${giveaway.code}-winners.csv"`,
      )
      return c.body(winnersCsv(giveaway, picks), 200, {
        "Content-Type": "text/csv; charset=utf-8",
      })
    }),
  )

  // The winner form answers are for the giveaway's streamer alone: no moderator route reads them.
  app.get("/api/dash/giveaways/:id/answers", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      c.header("Cache-Control", "no-store")
      return c.json(await winnerAnswersJson(deps, giveaway))
    }),
  )

  app.post("/api/dash/giveaways/:id/delivered", sameOriginJson(deps.config), (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const n = integerField(await readJson(c), "n", 0)
      if (n === null) return c.json({ error: "invalid-input", field: "n" }, 400)
      const room = deps.rooms.get(giveaway.id)
      const outcome = await room.markDelivered(n)
      if (outcome.kind === "delivered") {
        await mirrorStatus(room, deps.accounts, giveaway.id, deps.clock.now())
      }
      return c.json({ kind: outcome.kind }, deliveredStatus[outcome.kind])
    }),
  )

  app.post("/api/dash/giveaways/:id/delete", sameOriginJson(deps.config), async (c) => {
    const giveaway = await deps.accounts.findOwnedGiveaway(
      c.get("streamer").streamerId,
      c.req.param("id"),
    )
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    await deleteGiveaway(deps, giveaway.id)
    await forgetHistory(c, deps)
    console.info("giveaway deleted", { giveawayId: giveaway.id })
    return c.json({ kind: "deleted" })
  })

  app.post("/api/dash/history", sameOriginJson(deps.config), async (c) => {
    const on = objectField(await readJson(c), "on")
    if (typeof on !== "boolean") return c.json({ error: "invalid-input", field: "on" }, 400)
    await deps.accounts.setPublicHistory(c.get("streamer").streamerId, on)
    await forgetHistory(c, deps)
    return c.json({ kind: "saved", on })
  })

  app.post("/api/dash/history/indexing", sameOriginJson(deps.config), async (c) => {
    const on = objectField(await readJson(c), "on")
    if (typeof on !== "boolean") return c.json({ error: "invalid-input", field: "on" }, 400)
    await deps.accounts.setHistoryIndexed(c.get("streamer").streamerId, on)
    await forgetHistory(c, deps)
    return c.json({ kind: "saved", on })
  })

  app.post("/api/dash/giveaways/:id/history", sameOriginJson(deps.config), async (c) => {
    const hidden = objectField(await readJson(c), "hidden")
    if (typeof hidden !== "boolean") {
      return c.json({ error: "invalid-input", field: "hidden" }, 400)
    }
    const set = await deps.accounts.setHiddenFromHistory(
      c.get("streamer").streamerId,
      c.req.param("id"),
      hidden,
    )
    if (!set) return c.json({ error: "not-found" }, 404)
    await forgetHistory(c, deps)
    return c.json({ kind: "saved", hidden })
  })

  // Whether the channel has points is asked first, with the app's own token, so a streamer without them
  // is never sent to reconnect Twitch for an option they cannot use.
  app.get("/api/dash/rewards", async (c) => {
    const { streamerId, platform, platformUserId } = c.get("streamer")
    const provider = providerFor(deps.platforms, platform)
    c.header("Cache-Control", "no-store")
    try {
      if (
        !provider.capabilities.pointsEntry
        || !(await provider.hasChannelPoints(platformUserId))
      ) {
        return c.json<PointsRewardsJson>({ kind: "no-channel-points" })
      }
      const token = await deps.accounts.findStreamerToken(streamerId)
      if (token === null || !readyEntryWays(provider, token.scopes).includes("points")) {
        return c.json<PointsRewardsJson>({ kind: "reconnect" })
      }
      const accessToken = await openStreamerAccess(deps, token)
      const rewards = await provider.pointsRewards(accessToken, platformUserId)
      return c.json<PointsRewardsJson>({ kind: "rewards", rewards })
    } catch (error) {
      if (!(error instanceof PlatformError)) throw error
      console.warn("points rewards read failed", {
        errorClass: errorClass(error),
        status: error.status,
      })
      return c.json({ error: "platform-unavailable" }, 503)
    }
  })

  // The wizard warns before a Kick chat entry giveaway, whose webhooks cost a Worker request per chat message.
  app.get("/api/dash/request-budget", async (c) => {
    c.header("Cache-Control", "no-store")
    return c.json<RequestBudgetJson>({ budget: await workerRequestBudget(deps) })
  })

  // The wizard shows what a YouTube giveaway's chat watch costs of today's units before it is made.
  app.get("/api/dash/youtube-budget", async (c) => {
    c.header("Cache-Control", "no-store")
    const budget = await youtubeBudget(deps)
    if (budget === null) return c.json({ error: "not-found" }, 404)
    return c.json<YouTubeBudgetJson>(budget)
  })

  app.get("/api/dash/blocks", async (c) => {
    const body: BlockListJson = {
      blocks: await deps.accounts.listBlocks(
        c.get("streamer").streamerId,
        c.get("streamer").platform,
      ),
      blockListMax: deps.config.blockListMax,
    }
    c.header("Cache-Control", "no-store")
    return c.json(body)
  })

  // The login is looked up once here, so the block holds the account id and a rename does not lift it.
  // Saving is idempotent, so after `room-unavailable` a repeat sends the list to the rooms again.
  app.post("/api/dash/blocks", sameOriginJson(deps.config), async (c) => {
    const { streamerId, platform } = c.get("streamer")
    const provider = providerFor(deps.platforms, platform)
    const typed = objectField(await readJson(c), "login")
    const login = typeof typed === "string" ? provider.parseLogin(typed) : null
    if (login === null) return c.json({ error: "invalid-input", field: "login" }, 400)
    let account: PlatformAccount | null
    try {
      account = await provider.accountByLogin(login)
    } catch (error) {
      if (!(error instanceof PlatformError)) throw error
      console.warn("block login lookup failed", {
        errorClass: errorClass(error),
        status: error.status,
      })
      return c.json({ error: "platform-unavailable" }, 503)
    }
    if (account === null) return c.json({ error: "unknown-login" }, 404)
    const block: StreamerBlock = {
      platform,
      platformUserId: account.id,
      login: account.login,
      createdAt: deps.clock.now(),
    }
    const added = await deps.accounts.addBlock(streamerId, block, deps.config.blockListMax)
    if (added === "full") return c.json({ error: "block-list-full" }, 409)
    if ((await pushBlockList(deps, streamerId, platform)) > 0) {
      return c.json({ error: "room-unavailable" }, 503)
    }
    return c.json({ kind: added, block }, added === "added" ? 201 : 200)
  })

  app.post("/api/dash/blocks/:platformUserId/delete", sameOriginJson(deps.config), async (c) => {
    const { streamerId, platform } = c.get("streamer")
    await deps.accounts.removeBlock(streamerId, platform, c.req.param("platformUserId"))
    if ((await pushBlockList(deps, streamerId, platform)) > 0) {
      return c.json({ error: "room-unavailable" }, 503)
    }
    return c.json({ kind: "removed" })
  })

  // Every room goes before the rows, so a failure leaves the account listed and a repeat finishes the job.
  app.post("/api/dash/account/delete", sameOriginJson(deps.config), async (c) => {
    const { streamerId } = c.get("streamer")
    for (const giveaway of await deps.accounts.listGiveaways(streamerId)) {
      await deps.rooms.delete(giveaway.id)
    }
    await deps.accounts.deleteStreamer(streamerId)
    await forgetHistory(c, deps)
    endStreamerSession(c)
    console.info("streamer data deleted", { streamerId })
    return c.json({ kind: "deleted" })
  })

  app.get("/api/live/:id", (c) =>
    withOwnedRoom(c, deps, async (giveaway) => {
      const body: OwnerLiveSnapshot = {
        ...(await deps.rooms.get(giveaway.id).liveSnapshot()),
        overlayToken: giveaway.overlayToken,
        donateUrl: deps.config.donateUrl,
      }
      return c.json(body)
    }),
  )

  app.get("/api/live/:id/entrants", (c) =>
    withOwnedRoom(c, deps, (giveaway) => entrantsPage(c, deps, giveaway)),
  )

  app.get("/api/live/:id/badges", async (c) => {
    const giveaway = await deps.accounts.findOwnedGiveaway(
      c.get("streamer").streamerId,
      c.req.param("id"),
    )
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    return subscriberBadges(c, deps, giveaway)
  })

  app.get("/api/dash/overlay-theme", async (c) => {
    const body: OverlayThemeJson = {
      theme: await deps.accounts.streamerOverlayTheme(c.get("streamer").streamerId),
    }
    c.header("Cache-Control", "no-store")
    return c.json(body)
  })

  app.post("/api/dash/overlay-theme", async (c) => {
    const parsed = parseOverlayTheme(await readJson(c))
    if (!parsed.ok) return c.json({ error: "invalid-input", ...parsed.issue }, 400)
    const { streamerId } = c.get("streamer")
    await deps.accounts.storeStreamerOverlayTheme(streamerId, parsed.value, deps.clock.now())
    await pushOverlayTheme(
      deps,
      await deps.accounts.streamerThemedGiveaways(streamerId),
      parsed.value,
    )
    return c.json({ kind: "saved", theme: parsed.value })
  })

  // No room is involved: the theme lives in the accounts store.
  app.get("/api/dash/giveaways/:id/overlay-theme", async (c) => {
    const themes = await deps.accounts.ownedOverlayThemes(
      c.get("streamer").streamerId,
      c.req.param("id"),
    )
    if (themes === null) return c.json({ error: "not-found" }, 404)
    const body: GiveawayOverlayThemesJson = themes
    c.header("Cache-Control", "no-store")
    return c.json(body)
  })

  // `{ theme: null }` gives the giveaway back the streamer's theme; a request that names no theme is a bad request.
  app.post("/api/dash/giveaways/:id/overlay-theme", async (c) => {
    const body = await readJson(c)
    const named =
      typeof body === "object" && body !== null && Object.hasOwn(body, "theme")
        ? Reflect.get(body, "theme")
        : undefined
    const parsed = named === null ? null : parseOverlayTheme(named)
    if (parsed !== null && !parsed.ok) {
      return c.json({ error: "invalid-input", ...parsed.issue }, 400)
    }
    const own = parsed === null ? null : parsed.value
    const giveawayId = c.req.param("id")
    const set = await deps.accounts.setGiveawayOverlayTheme(
      c.get("streamer").streamerId,
      giveawayId,
      own,
    )
    if (!set) return c.json({ error: "not-found" }, 404)
    await pushOverlayTheme(
      deps,
      [giveawayId],
      own ?? (await deps.accounts.overlayThemeOf(giveawayId)),
    )
    return c.json({ kind: "saved", own })
  })

  app.get("/api/admin/usage", async (c) => {
    const plan = await activePlan(deps)
    const usage = await usageOfPlan(deps, plan)
    const body: AdminUsageJson = {
      usage,
      plan: plan === "unavailable" ? null : plan,
      alerts:
        typeof usage === "object" && usage !== null
          ? usageAlerts(usage, deps.config.usageAlertPercent)
          : [],
      alertPercent: deps.config.usageAlertPercent,
      signupOpen: deps.config.openSignup,
      queue: await deps.queue.stats(),
      youtubeQuota: await adminYouTubeQuota(deps),
    }
    return c.json(body)
  })

  // The answer holds no per-admin or per-person data, so one cached copy serves every admin. `?fresh=1` skips the copy, for the page right after a plan switch changed what the usage is measured against.
  app.get("/api/admin/stats", async (c) => {
    c.header("Cache-Control", "no-store")
    const key = `${deps.config.publicUrl}/api/admin/stats`
    const ttlSeconds = deps.config.adminStatsCacheSeconds
    const cached =
      c.req.query("fresh") === "1" ? null : await readPublicCache(deps, key, ttlSeconds)
    if (cached !== null) return c.body(cached, 200, { "Content-Type": "application/json" })
    const text = JSON.stringify(await adminStats(deps))
    await writePublicCache(deps, key, text, ttlSeconds)
    return c.body(text, 200, { "Content-Type": "application/json" })
  })

  // The admin pays for the plan in the Cloudflare dashboard first; this only tells the app which limits apply.
  app.post("/api/admin/plan", sameOriginJson(deps.config), async (c) => {
    const { platformUserId } = c.get("streamer")
    if (deps.planQueue === null) return c.json({ error: "not-found" }, 404)
    const plan = planField(await readJson(c))
    if (plan === null) return c.json({ error: "invalid-input", field: "plan" }, 400)
    await deps.accounts.storeCloudflarePlan(plan, platformUserId, deps.clock.now())
    console.info("cloudflare plan switched", { plan })
    try {
      await deps.planQueue.usePlan(plan)
    } catch (error) {
      // Stored: the queue reads it again when it next starts, and a repeated switch reaches it now.
      console.warn("plan switch did not reach the queue", { plan, errorClass: errorClass(error) })
      return c.json({ error: "queue-unavailable" }, 503)
    }
    return c.json({ kind: "switched", plan })
  })

  app.get("/api/admin/streamers", async (c) => {
    c.header("Cache-Control", "no-store")
    // Admins are never listed, so the query reads one row per possible admin more than the page shows.
    const max = deps.config.streamerAccessListMax
    const { pending, approved } = await deps.accounts.listStreamerAccess(
      max + deps.config.admins.length + 1,
    )
    const body: AdminStreamersJson = {
      pending: await withoutAdmins(deps, pending, max),
      approved: await withoutAdmins(deps, approved, max),
    }
    return c.json(body)
  })

  app.post("/api/admin/streamers/:id/approve", sameOriginJson(deps.config), async (c) => {
    const { platformUserId } = c.get("streamer")
    const streamerId = c.req.param("id")
    if (!(await deps.accounts.approveStreamer(streamerId, platformUserId, deps.clock.now()))) {
      return c.json({ error: "not-found" }, 404)
    }
    console.info("streamer approved", { streamerId })
    return c.json({ kind: "approved" })
  })

  app.post("/api/admin/streamers/:id/revoke", sameOriginJson(deps.config), async (c) => {
    const streamerId = c.req.param("id")
    if (!(await deps.accounts.revokeStreamer(streamerId))) {
      return c.json({ error: "not-found" }, 404)
    }
    console.info("streamer approval revoked", { streamerId })
    return c.json({ kind: "revoked" })
  })

  // A winner who asks the operator to be removed: the giveaway is named by the code its link shows.
  app.post(
    "/api/admin/giveaways/:code/winners/:n/remove-name",
    sameOriginJson(deps.config),
    async (c) => {
      const n = integerQuery(c.req.param("n"), 0, 0)
      if (n === null) return c.json({ error: "invalid-input", field: "n" }, 400)
      const giveaway = await deps.accounts.findGiveawayByCode(c.req.param("code"))
      if (giveaway === null) return c.json({ error: "not-found" }, 404)
      const outcome = await deps.rooms.get(giveaway.id).removeWinnerName(n)
      switch (outcome.kind) {
        case "removed":
          console.info("winner name removed", { giveawayId: giveaway.id, n })
          return c.json({ kind: outcome.kind })
        case "unknown-pick":
          return c.json({ kind: outcome.kind }, 404)
      }
    },
  )

  app.get("/api/overlay/:id/:token", async (c) => {
    const giveaway = await overlayGiveaway(c, deps)
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    return c.json(overlaySnapshot(await deps.rooms.get(giveaway.id).liveSnapshot()))
  })

  // The overlay reads its theme when it starts and whenever its socket reconnects; a save in between reaches it as a push.
  app.get("/api/overlay/:id/:token/theme", async (c) => {
    const giveaway = await overlayGiveaway(c, deps)
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const body: OverlayThemeJson = { theme: await deps.accounts.overlayThemeOf(giveaway.id) }
    c.header("Cache-Control", "no-store")
    return c.json(body)
  })

  return app
}

// A room that cannot be reached misses only the push: the theme is stored, and its overlay reads it again when its
// socket reconnects.
async function pushOverlayTheme(
  deps: AppDeps,
  giveawayIds: readonly string[],
  theme: OverlayTheme,
): Promise<void> {
  for (const giveawayId of giveawayIds) {
    try {
      await deps.rooms.get(giveawayId).pushOverlayTheme(theme)
    } catch (error) {
      console.warn("overlay theme push failed", { giveawayId, errorClass: errorClass(error) })
    }
  }
}

// OBS has no session: the token in the URL is the whole credential. A wrong token finds nothing.
async function overlayGiveaway(c: Context, deps: AppDeps): Promise<Giveaway | null> {
  const giveaway = await deps.accounts.findGiveawayById(c.req.param("id") ?? "")
  if (giveaway === null) return null
  return (await timingSafeEqual(c.req.param("token") ?? "", giveaway.overlayToken))
    ? giveaway
    : null
}

// Another streamer's giveaway looks like a missing one. The room is re-initialised first: creation
// may have written the account row and then lost the room call.
// After a change the history shows, so this instance answers the next view fresh.
function forgetHistory(c: Context<Env>, deps: AppDeps): Promise<void> {
  return deletePublicCache(
    deps,
    historyCacheKey(deps.config, c.get("streamer").platform, c.get("account").login),
  )
}

async function withOwnedRoom(
  c: Context<Env>,
  deps: AppDeps,
  act: (giveaway: Giveaway) => Promise<Response>,
): Promise<Response> {
  const giveaway = await deps.accounts.findOwnedGiveaway(
    c.get("streamer").streamerId,
    c.req.param("id") ?? "",
  )
  if (giveaway === null) return c.json({ error: "not-found" }, 404)
  if (!(await initRoom(deps, giveaway))) return c.json({ error: "room-unavailable" }, 503)
  return act(giveaway)
}

function requireAdmin(deps: AppDeps): MiddlewareHandler<Env> {
  return async (c, next) => {
    const { platform, platformUserId } = c.get("streamer")
    if (!(await deps.admins.isAdmin(platform, platformUserId))) {
      return c.json({ error: "forbidden" }, 403)
    }
    return next()
  }
}

/** Admins are always allowed, so they never wait in the lists. One row over `max` marks the list as cut. */
async function withoutAdmins(
  deps: AppDeps,
  streamers: readonly StreamerRecord[],
  max: number,
): Promise<AdminStreamerListJson> {
  const listed: AdminStreamerJson[] = []
  for (const streamer of streamers) {
    if (await deps.admins.isAdmin(streamer.platform, streamer.platformUserId)) continue
    listed.push({
      id: streamer.id,
      login: streamer.login,
      displayName: streamer.displayName,
      createdAt: streamer.createdAt,
      approvedAt: streamer.approvedAt,
    })
  }
  return { streamers: listed.slice(0, max), truncated: listed.length > max }
}

const deliveredStatus: Readonly<Record<MarkDeliveredOutcome["kind"], ContentfulStatusCode>> = {
  delivered: 200,
  "already-delivered": 409,
  "not-claimed": 409,
  "unknown-pick": 404,
}

// One row per pick, rerolled ones included; instants are ISO 8601 in UTC.
function winnersCsv(giveaway: Giveaway, picks: readonly WinnerPick[]): string {
  return csvText([
    ["pick", "login", "display_name", "prize", "drawn_at", "claim", "claimed_at", "delivered_at"],
    ...picks.map((pick) => [
      String(pick.n + 1),
      pick.login ?? "",
      pick.displayName ?? "",
      giveaway.prize ?? "",
      new Date(pick.drawnAt).toISOString(),
      pick.claim.state,
      pick.claim.state === "claimed" ? new Date(pick.claim.at).toISOString() : "",
      pick.deliveredAt === null ? "" : new Date(pick.deliveredAt).toISOString(),
    ]),
  ])
}

// A sub or points giveaway on a token without those scopes would watch nothing, so it is refused before it exists.
async function channelEntryReady(
  deps: AppDeps,
  streamer: StreamerSession,
  rules: GiveawayRules,
): Promise<boolean> {
  const needed: ChannelEntryVia[] = []
  if (rules.subEntry) needed.push("sub")
  if (rules.pointsReward !== null) needed.push("points")
  if (needed.length === 0) return true
  const token = await deps.accounts.findStreamerToken(streamer.streamerId)
  if (token === null) return false
  const ready = readyEntryWays(providerFor(deps.platforms, streamer.platform), token.scopes)
  return needed.every((way) => ready.includes(way))
}

async function insertWithFreshCode(
  deps: AppDeps,
  giveaway: Omit<NewGiveaway, "code">,
): Promise<NewGiveaway | null> {
  for (let attempt = 0; attempt <= deps.config.codeInsertRetries; attempt++) {
    const candidate = { ...giveaway, code: generateCode(deps.random) }
    if ((await deps.accounts.insertGiveaway(candidate)) === "inserted") return candidate
  }
  return null
}

async function usageOfPlan(
  deps: AppDeps,
  plan: AdminPlanJson | null | "unavailable",
): Promise<Usage | null | "unavailable"> {
  return plan === "unavailable" ? plan : adminUsage(deps, plan === null ? null : plan.limits)
}

async function adminStats(deps: AppDeps): Promise<AdminStatsJson> {
  const { config } = deps
  const now = deps.clock.now()
  const seriesFrom = startOfMinute(now) - (config.adminStatsSeriesMinutes - 1) * minuteMs
  const growthFrom = startOfDay(now) - (config.adminStatsDays - 1) * dayMs
  const [live, queue, usage, minutes, giveawaysPerDay, streamersPerDay, returning, referrals] =
    await Promise.all([
      liveGiveaways(deps, config.adminStatsLiveRoomsMax),
      deps.queue.stats(),
      activePlan(deps).then((plan) => usageOfPlan(deps, plan)),
      deps.stats.minutes(seriesFrom),
      deps.stats.giveawaysPerDay(growthFrom),
      deps.stats.streamersPerDay(growthFrom),
      deps.stats.returningStreamers(config.adminStatsReturnDays * dayMs),
      deps.stats.topReferrals(growthFrom, config.adminStatsRefsMax),
    ])
  const counted = live.giveaways.flatMap((giveaway) =>
    giveaway.counts === null ? [] : [giveaway.counts],
  )
  const sum = (pick: (counts: (typeof counted)[number]) => number) =>
    counted.reduce((total, counts) => total + pick(counts), 0)
  return {
    generatedAt: now,
    openGiveaways: live.total,
    giveaways: live.giveaways,
    viewers: sum((counts) => counts.viewers),
    entriesLastMinute: sum((counts) => counts.entriesLastMinute),
    claimsLastMinute: sum((counts) => counts.claimsLastMinute),
    queue,
    usage,
    series: denseMinutes(
      minutes,
      new Map(queue.rateLimitedMinutes.map((row) => [row.minute, row.count])),
      now,
      config.adminStatsSeriesMinutes,
    ),
    growth: denseDays(giveawaysPerDay, streamersPerDay, now, config.adminStatsDays),
    returningStreamers: returning,
    returningWithinDays: config.adminStatsReturnDays,
    access: config.openSignup ? null : await accessCounts(deps),
    referrals,
  }
}

async function accessCounts(deps: AppDeps): Promise<AdminAccessCountsJson> {
  const max = deps.config.streamerAccessListMax
  const { pending, approved } = await deps.accounts.listStreamerAccess(
    max + deps.config.admins.length + 1,
  )
  const waiting = await withoutAdmins(deps, pending, max)
  const allowed = await withoutAdmins(deps, approved, max)
  return {
    pending: waiting.streamers.length,
    approved: allowed.streamers.length,
    truncated: waiting.truncated || allowed.truncated,
  }
}

type UsageWarning = { readonly kind: "worker-requests-low"; readonly remaining: number }

/** The plan and its limits; null on a target without a Cloudflare plan, "unavailable" when the stored plan cannot be read. */
async function activePlan(deps: AppDeps): Promise<AdminPlanJson | null | "unavailable"> {
  if (deps.planQueue === null) return null
  try {
    const plan = await currentPlan(deps.accounts, deps.config)
    return {
      current: plan,
      limits: { ...planLimits(plan, deps.config), overridden: overriddenLimits(deps.config) },
    }
  } catch (error) {
    console.warn("plan unavailable", { errorClass: errorClass(error) })
    return "unavailable"
  }
}

/** The admin page shows "unavailable" instead of failing when the usage source does not answer. */
async function adminUsage(
  deps: AppDeps,
  limits: PlanLimits | null,
): Promise<Usage | null | "unavailable"> {
  try {
    return await todayUsage(deps, limits)
  } catch (error) {
    warnUsageUnavailable(error)
    return "unavailable"
  }
}

// A target without a plan counts nothing, so null limits and null requests come together.
async function todayUsage(deps: AppDeps, limits: PlanLimits | null): Promise<Usage | null> {
  const requests = await deps.usage.today()
  return requests === null || limits === null ? null : usageOf(requests, limits)
}

async function usageWarnings(deps: AppDeps): Promise<UsageWarning[]> {
  const budget = await workerRequestBudget(deps)
  return budget !== null && budget.remaining < deps.config.usageWarningThreshold
    ? [{ kind: "worker-requests-low", remaining: budget.remaining }]
    : []
}

// Null when the plan caps no day, or the plan or the usage source does not answer.
async function workerRequestBudget(deps: AppDeps): Promise<RequestBudgetJson["budget"]> {
  const plan = await activePlan(deps)
  if (plan === "unavailable") return null
  try {
    const usage = await todayUsage(deps, plan === null ? null : plan.limits)
    const limit = usage?.workerRequests.limit ?? null
    if (usage === null || limit === null) return null
    return { limit, remaining: limit - usage.workerRequests.used }
  } catch (error) {
    warnUsageUnavailable(error)
    return null
  }
}

// Null on an install without a Google client.
async function youtubeBudget(deps: AppDeps): Promise<YouTubeBudgetJson | null> {
  const quota = deps.youtubeQuota
  if (quota === null) return null
  const { used, limit } = await quota.today(deps.clock.now())
  return {
    limit,
    remaining: limit - used,
    unitsPerMinute: quota.chatUnitsPerMinute(),
    winnerUnitsPerMinute: quota.winnerUnitsPerMinute(),
  }
}

/**
 * The units the chat watch of a new YouTube giveaway spends: the keyword reads until entries close, then
 * the winners' reads through one claim time. A giveaway closed by hand has no known end, so only its first
 * minute counts; the create form warns how many minutes today's units cover.
 */
function youtubeUnitsNeeded(
  budget: YouTubeBudgetJson,
  giveaway: { readonly closesAt: Instant | null; readonly claimSeconds: number },
  now: Instant,
): number {
  const { closesAt, claimSeconds } = giveaway
  const entryMinutes = closesAt === null ? 1 : Math.ceil((closesAt - now) / minuteMs)
  const claimMinutes = Math.ceil((claimSeconds * 1000) / minuteMs)
  return budget.unitsPerMinute * entryMinutes + budget.winnerUnitsPerMinute * claimMinutes
}

/** The admin page shows "unavailable" instead of failing when the count cannot be read. */
async function adminYouTubeQuota(deps: AppDeps): Promise<AdminUsageJson["youtubeQuota"]> {
  if (deps.youtubeQuota === null) return null
  try {
    return await deps.youtubeQuota.today(deps.clock.now())
  } catch (error) {
    console.warn("youtube quota unavailable", { errorClass: errorClass(error) })
    return "unavailable"
  }
}

function planField(body: unknown): CloudflarePlan | null {
  const value = objectField(body, "plan")
  return cloudflarePlans.find((plan) => plan === value) ?? null
}

function warnUsageUnavailable(error: unknown): void {
  console.warn("usage unavailable", {
    errorClass: errorClass(error),
    reason: error instanceof UsageUnavailable ? error.reason : null,
  })
}

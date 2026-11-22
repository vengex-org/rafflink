import { Hono, type Context, type MiddlewareHandler } from "hono"
import { timingSafeEqual } from "hono/utils/buffer"
import type { Giveaway, ModeratorLink } from "../accounts/account-store.ts"
import { moderatorActor, type Actor } from "../domain/actor.ts"
import { errorClass } from "../lib/error-class.ts"
import { randomId } from "../lib/random-id.ts"
import { tokenHash } from "../lib/token-hash.ts"
import { PlatformError } from "../platform/errors.ts"
import { openGiveawayStreamerAccess, StreamerTokenMissing } from "../room/streamer-access.ts"
import type { AppDeps } from "./deps.ts"
import {
  readJson,
  type CreatedModeratorLinkJson,
  type ModeratorLinkJson,
  type ModeratorLinksJson,
  type OpenedModeratorLinkJson,
} from "./json.ts"
import {
  closeEntries,
  drawWinner,
  entrantsPage,
  initRoom,
  markClaimed,
  rerollPick,
  subscriberBadges,
} from "./live-actions.ts"
import { sameOriginJson } from "./origin.ts"
import { readModeratorSession, startModeratorSession } from "./session.ts"
import { currentStreamer, requireStreamer, type StreamerEnv } from "./session-routes.ts"
import { webSocketOrigin } from "./websocket-origin.ts"

/** Set by the moderator live route on its answer: the link a socket opened through it belongs to, so revoking the link closes that socket. */
export const moderatorLinkHeader = "x-rafflink-moderator-link"

type ModeratorEnv = { Variables: { giveaway: Giveaway; linkId: string; actor: Actor } }

/**
 * Moderator links: the streamer makes, lists and revokes them for one giveaway; whoever opens one gets a
 * cookie for that giveaway's moderator routes, which close entries, draw, reroll and mark claims and do
 * nothing else. Every moderator request looks the link up, so a revoked link answers 403 at once.
 */
export function moderatorRoutes(deps: AppDeps): Hono {
  const app = new Hono()
  app.route("/", linkManagement(deps))

  app.post("/api/moderator-links/open", sameOriginJson(deps.config), async (c) => {
    const address = deps.clientAddress(c.req.raw)
    if (address !== null && !(await deps.moderatorIpLimiter.allow(address))) {
      return c.json({ error: "rate-limited" }, 429)
    }
    const link = await linkOfToken(deps, await readJson(c))
    const giveaway = link === null ? null : await deps.accounts.findGiveawayById(link.giveawayId)
    if (link === null || giveaway === null) return c.json({ error: "link-invalid" }, 403)
    if (link.requireMod) {
      const refusal = await moderatorRefusal(c, deps, giveaway)
      if (refusal !== null) return refusal
    }
    await startModeratorSession(c, deps, giveaway.id, { linkId: link.id })
    const body: OpenedModeratorLinkJson = { giveawayId: giveaway.id }
    return c.json(body)
  })

  const moderator = requireModerator(deps)
  const sameSite = sameOriginJson(deps.config)
  app.use("/api/mod/:id", webSocketOrigin(deps.config, { allowMissing: false }))

  app.get("/api/mod/:id", moderator, async (c) => {
    c.header(moderatorLinkHeader, c.get("linkId"))
    return c.json(await deps.rooms.get(c.get("giveaway").id).liveSnapshot())
  })
  app.get("/api/mod/:id/entrants", moderator, (c) => entrantsPage(c, deps, c.get("giveaway")))
  app.get("/api/mod/:id/badges", moderator, (c) => subscriberBadges(c, deps, c.get("giveaway")))
  app.post("/api/mod/:id/close", sameSite, moderator, (c) =>
    closeEntries(c, deps, c.get("giveaway"), c.get("actor")),
  )
  app.post("/api/mod/:id/draw", sameSite, moderator, (c) =>
    drawWinner(c, deps, c.get("giveaway"), c.get("actor")),
  )
  app.post("/api/mod/:id/reroll", sameSite, moderator, (c) =>
    rerollPick(c, deps, c.get("giveaway"), c.get("actor")),
  )
  app.post("/api/mod/:id/claim", sameSite, moderator, (c) =>
    markClaimed(c, deps, c.get("giveaway"), c.get("actor")),
  )

  return app
}

// The streamer's side, on the live page: another streamer's giveaway looks like a missing one.
function linkManagement(deps: AppDeps): Hono<StreamerEnv> {
  const app = new Hono<StreamerEnv>()
  const streamer = requireStreamer(deps)
  const sameSite = sameOriginJson(deps.config)

  app.get("/api/dash/giveaways/:id/moderator-links", streamer, async (c) => {
    const { streamerId } = c.get("streamer")
    const giveaway = await deps.accounts.findOwnedGiveaway(streamerId, c.req.param("id"))
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const links = await deps.accounts.listModeratorLinks(streamerId, giveaway.id)
    const body: ModeratorLinksJson = { links: links.map(linkJson) }
    c.header("Cache-Control", "no-store")
    return c.json(body)
  })

  app.post("/api/dash/giveaways/:id/moderator-links", sameSite, streamer, async (c) => {
    const { streamerId } = c.get("streamer")
    const giveaway = await deps.accounts.findOwnedGiveaway(streamerId, c.req.param("id"))
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const requireMod = booleanField(await readJson(c), "requireMod")
    if (requireMod === null) return c.json({ error: "invalid-input", field: "requireMod" }, 400)
    const secret = randomId(deps.random)
    const link: ModeratorLink = {
      id: randomId(deps.random),
      streamerId,
      giveawayId: giveaway.id,
      tokenHash: await tokenHash(secret),
      requireMod,
      createdAt: deps.clock.now(),
      revokedAt: null,
    }
    await deps.accounts.insertModeratorLink(link)
    console.info("moderator link created", { giveawayId: giveaway.id, linkId: link.id })
    const body: CreatedModeratorLinkJson = { link: linkJson(link), token: `${link.id}.${secret}` }
    c.header("Cache-Control", "no-store")
    return c.json(body, 201)
  })

  // Stored first, then the room closes the link's sockets; a room that did not answer gets a 503, and the
  // repeat (revoking is idempotent) closes them.
  app.post(
    "/api/dash/giveaways/:id/moderator-links/:linkId/revoke",
    sameSite,
    streamer,
    async (c) => {
      const { streamerId } = c.get("streamer")
      const giveawayId = c.req.param("id")
      const linkId = c.req.param("linkId")
      const revoked = await deps.accounts.revokeModeratorLink(
        streamerId,
        giveawayId,
        linkId,
        deps.clock.now(),
      )
      if (!revoked) return c.json({ error: "not-found" }, 404)
      console.info("moderator link revoked", { giveawayId, linkId })
      try {
        await deps.rooms.closeModeratorSockets(giveawayId, linkId)
      } catch (error) {
        console.warn("moderator sockets not closed", {
          giveawayId,
          linkId,
          errorClass: errorClass(error),
        })
        return c.json({ error: "room-unavailable" }, 503)
      }
      return c.json({ kind: "revoked" })
    },
  )

  return app
}

/** Lets a request through only with the cookie of a link of this giveaway that is not revoked; sets the giveaway, the link and its actor. */
function requireModerator(deps: AppDeps): MiddlewareHandler<ModeratorEnv> {
  return async (c, next) => {
    const giveawayId = c.req.param("id") ?? ""
    const session = await readModeratorSession(c, deps, giveawayId)
    const link = session === null ? null : await deps.accounts.findModeratorLink(session.linkId)
    if (link === null || link.giveawayId !== giveawayId || link.revokedAt !== null) {
      return c.json({ error: "forbidden" }, 403)
    }
    const giveaway = await deps.accounts.findGiveawayById(giveawayId)
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    if (!(await initRoom(deps, giveaway))) return c.json({ error: "room-unavailable" }, 503)
    c.set("giveaway", giveaway)
    c.set("linkId", link.id)
    c.set("actor", moderatorActor(link.id))
    return next()
  }
}

// A link's token is `<link id>.<secret>`, both 32 hex characters: the id finds the row, and the secret's
// hash is compared in constant time, so the answer time tells nothing about the stored hash.
const tokenPattern = /^([0-9a-f]{32})\.([0-9a-f]{32})$/

/** The working link a request body's token opens; null for anything else, a revoked link included. */
async function linkOfToken(deps: AppDeps, body: unknown): Promise<ModeratorLink | null> {
  const token =
    typeof body === "object" && body !== null && Object.hasOwn(body, "token")
      ? Reflect.get(body, "token")
      : null
  const parts = typeof token === "string" ? tokenPattern.exec(token) : null
  if (parts === null) return null
  const [, linkId = "", secret = ""] = parts
  const link = await deps.accounts.findModeratorLink(linkId)
  if (link === null || link.revokedAt !== null) return null
  return (await timingSafeEqual(await tokenHash(secret), link.tokenHash)) ? link : null
}

/**
 * Why the signed-in opener may not use a link that requires a moderator, or null when they may: the
 * broadcaster and the channel's moderators, as the platform answers with the streamer's token now.
 */
async function moderatorRefusal(
  c: Context,
  deps: AppDeps,
  giveaway: Giveaway,
): Promise<Response | null> {
  const current = await currentStreamer(c, deps)
  if (current === null) return c.json({ error: "sign-in-required" }, 401)
  const { platform, platformUserId } = current.session
  if (platform !== giveaway.platform) return c.json({ error: "not-a-moderator" }, 403)
  if (platformUserId === giveaway.broadcasterId) return null
  let moderates: boolean
  try {
    const access = await openGiveawayStreamerAccess(deps, giveaway.id)
    moderates = await access.provider.isModerator(
      access.accessToken,
      access.broadcasterId,
      platformUserId,
    )
  } catch (error) {
    if (!(error instanceof StreamerTokenMissing || error instanceof PlatformError)) throw error
    console.warn("moderator check unavailable", {
      giveawayId: giveaway.id,
      errorClass: errorClass(error),
    })
    return c.json({ error: "moderator-check-unavailable" }, 503)
  }
  return moderates ? null : c.json({ error: "not-a-moderator" }, 403)
}

function linkJson(link: ModeratorLink): ModeratorLinkJson {
  return { id: link.id, requireMod: link.requireMod, createdAt: link.createdAt }
}

function booleanField(body: unknown, field: string): boolean | null {
  if (typeof body !== "object" || body === null || !Object.hasOwn(body, field)) return null
  const value: unknown = Reflect.get(body, field)
  return typeof value === "boolean" ? value : null
}

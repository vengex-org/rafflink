import { Hono, type Context, type MiddlewareHandler } from "hono"
import { timingSafeEqual } from "hono/utils/buffer"
import type { Giveaway, ModeratorLink } from "../accounts/account-store.ts"
import { moderatorActor, type Actor } from "../domain/actor.ts"
import { errorClass } from "../lib/error-class.ts"
import { moderatorLivePath, moderatorOutcomePath as outcomePath } from "../lib/page-paths.ts"
import { randomId } from "../lib/random-id.ts"
import { tokenHash } from "../lib/token-hash.ts"
import type { Instant } from "../ports.ts"
import { PlatformError, PlatformIdentityRejected } from "../platform/errors.ts"
import { codeChallenge, codeVerifier } from "../platform/pkce.ts"
import { configuredProviders, type PlatformProvider } from "../platform/provider.ts"
import { callbackPath, redirectUri } from "../platform/redirect.ts"
import { openGiveawayStreamerAccess, StreamerTokenMissing } from "../room/streamer-access.ts"
import type { AppDeps } from "./deps.ts"
import {
  objectField,
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
import {
  hexIdText,
  readModeratorSession,
  readViewerSession,
  startModeratorPending,
  startModeratorSession,
  startOAuthState,
  takeModeratorPending,
  type OAuthState,
} from "./session.ts"
import { currentStreamer, requireStreamer, type StreamerEnv } from "./session-routes.ts"
import { webSocketOrigin } from "./websocket-origin.ts"

/** Set by the moderator live route on its answer: the link a socket opened through it belongs to, so revoking the link closes that socket. */
export const moderatorLinkHeader = "x-rafflink-moderator-link"

type ModeratorEnv = {
  Variables: {
    giveaway: Giveaway
    linkId: string
    actor: Actor
    /** The platform user who proved they moderate the channel; null for a link anyone may use. */
    moderatorUserId: string | null
  }
}

/**
 * Moderator links: the streamer makes, lists and revokes them for one giveaway; whoever opens one gets a
 * cookie for that giveaway's moderator routes, which close entries, draw, reroll and mark claims and do
 * nothing else. Every moderator request looks the link up, so a revoked link answers 403 at once.
 */
export function moderatorRoutes(deps: AppDeps): Hono {
  const app = new Hono()
  app.route("/", linkManagement(deps))

  // A link that requires a moderator and finds nobody signed in leaves only its id in a pending cookie; the
  // moderator's sign-in start reads it, so the secret never travels through the platform's sign-in.
  app.post("/api/moderator-links/open", sameOriginJson(deps.config), async (c) => {
    const address = deps.clientAddress(c.req.raw)
    if (address !== null && !(await deps.moderatorIpLimiter.allow(address))) {
      return c.json({ error: "rate-limited" }, 429)
    }
    const link = await linkOfToken(deps, objectField(await readJson(c), "token"))
    const giveaway = link === null ? null : await deps.accounts.findGiveawayById(link.giveawayId)
    if (link === null || giveaway === null) return c.json({ error: "link-invalid" }, 403)
    let platformUserId: string | null = null
    if (link.requireMod) {
      const signedIn = await signedInUser(c, deps)
      if (signedIn === null) {
        await startModeratorPending(c, deps, link.id)
        return c.json({ error: "sign-in-required" }, 401)
      }
      const check =
        signedIn.platform === giveaway.platform
          ? await checkModerator(deps, giveaway, signedIn.userId)
          : "not-a-moderator"
      if (check !== "moderator") return checkRefusal(c, check)
      platformUserId = signedIn.userId
    }
    await startModeratorSession(c, deps, giveaway.id, { linkId: link.id, platformUserId })
    const body: OpenedModeratorLinkJson = { giveawayId: giveaway.id }
    return c.json(body)
  })

  for (const provider of configuredProviders(deps.platforms)) {
    app.get(`/auth/${provider.platform}/moderator/start`, async (c) => {
      const linkId = await takeModeratorPending(c, deps)
      if (linkId === null) return c.redirect(outcomePath("invalid-state"))
      const state = randomId(deps.random)
      const nonce = randomId(deps.random)
      const verifier = codeVerifier(deps.random)
      await startOAuthState(c, deps, "viewer", {
        state,
        nonce,
        codeVerifier: verifier,
        giveawayCode: null,
        returnPath: null,
        moderatorLinkId: linkId,
        entryWays: [],
      })
      return c.redirect(
        provider.authorizeUrl({
          state,
          nonce,
          codeChallenge: await codeChallenge(verifier),
          scopes: provider.scopes.moderator,
          redirectUri: redirectUri(deps.config, callbackPath(provider.platform, "viewer")),
          forceVerify: true,
        }),
      )
    })
  }

  const moderator = requireModerator(deps)
  const stillModerator = recheckModerator(deps)
  const sameSite = sameOriginJson(deps.config)
  app.use("/api/mod/:id", webSocketOrigin(deps.config, { allowMissing: false }))

  app.get("/api/mod/:id", moderator, async (c) => {
    c.header(moderatorLinkHeader, c.get("linkId"))
    return c.json(await deps.rooms.get(c.get("giveaway").id).liveSnapshot())
  })
  app.get("/api/mod/:id/entrants", moderator, (c) => entrantsPage(c, deps, c.get("giveaway")))
  app.get("/api/mod/:id/badges", moderator, (c) => subscriberBadges(c, deps, c.get("giveaway")))
  app.post("/api/mod/:id/close", sameSite, moderator, stillModerator, (c) =>
    closeEntries(c, deps, c.get("giveaway"), c.get("actor")),
  )
  app.post("/api/mod/:id/draw", sameSite, moderator, stillModerator, (c) =>
    drawWinner(c, deps, c.get("giveaway"), c.get("actor")),
  )
  app.post("/api/mod/:id/reroll", sameSite, moderator, stillModerator, (c) =>
    rerollPick(c, deps, c.get("giveaway"), c.get("actor")),
  )
  app.post("/api/mod/:id/claim", sameSite, moderator, stillModerator, (c) =>
    markClaimed(c, deps, c.get("giveaway"), c.get("actor")),
  )

  return app
}

/**
 * The viewer callback of a moderator's sign-in (the state names the link): proves who signed in, checks
 * they moderate the giveaway's channel with the streamer's token, and sets the moderator cookie. It asks
 * only `openid`, stores no token and writes no account row.
 */
export async function finishModeratorSignIn(
  c: Context,
  deps: AppDeps,
  provider: PlatformProvider,
  saved: OAuthState,
  linkId: string,
): Promise<Response> {
  if (c.req.query("error") !== undefined) return c.redirect(outcomePath("cancelled"))
  const code = c.req.query("code")
  const returned = c.req.query("state")
  if (
    code === undefined
    || returned === undefined
    || !(await timingSafeEqual(returned, saved.state))
  ) {
    return c.redirect(outcomePath("invalid-state"))
  }
  let userId: string
  try {
    const tokens = await provider.exchangeCode(
      code,
      redirectUri(deps.config, callbackPath(provider.platform, "viewer")),
      saved.codeVerifier,
    )
    userId = await provider.verifySignIn(tokens, { nonce: saved.nonce })
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error
    return c.redirect(
      outcomePath(error instanceof PlatformIdentityRejected ? "invalid-state" : "try-again"),
    )
  }
  const link = await deps.accounts.findModeratorLink(linkId)
  const giveaway =
    link === null || link.revokedAt !== null
      ? null
      : await deps.accounts.findGiveawayById(link.giveawayId)
  if (link === null || giveaway === null) return c.redirect(outcomePath("link-invalid"))
  const check =
    giveaway.platform === provider.platform
      ? await checkModerator(deps, giveaway, userId)
      : "not-a-moderator"
  if (check !== "moderator")
    return c.redirect(outcomePath(check === "unavailable" ? "try-again" : check))
  await startModeratorSession(c, deps, giveaway.id, { linkId: link.id, platformUserId: userId })
  return c.redirect(moderatorLivePath(giveaway.id))
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
    const requireMod = objectField(await readJson(c), "requireMod")
    if (typeof requireMod !== "boolean") {
      return c.json({ error: "invalid-input", field: "requireMod" }, 400)
    }
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

/**
 * Lets a request through only with the cookie of a link of this giveaway that is not revoked, and for a link
 * that requires a moderator one that names who signed in; sets the giveaway, the link, its actor and that user.
 */
function requireModerator(deps: AppDeps): MiddlewareHandler<ModeratorEnv> {
  return async (c, next) => {
    const giveawayId = c.req.param("id") ?? ""
    const session = await readModeratorSession(c, deps, giveawayId)
    const link = session === null ? null : await deps.accounts.findModeratorLink(session.linkId)
    if (
      session === null
      || link === null
      || link.giveawayId !== giveawayId
      || link.revokedAt !== null
      || (link.requireMod && session.platformUserId === null)
    ) {
      return c.json({ error: "forbidden" }, 403)
    }
    const giveaway = await deps.accounts.findGiveawayById(giveawayId)
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    if (!(await initRoom(deps, giveaway))) return c.json({ error: "room-unavailable" }, 503)
    c.set("giveaway", giveaway)
    c.set("linkId", link.id)
    c.set("actor", moderatorActor(link.id))
    c.set("moderatorUserId", link.requireMod ? session.platformUserId : null)
    return next()
  }
}

/**
 * Before a button press of a link that requires a moderator: the user still moderates the channel. A yes is
 * trusted for `MODERATOR_RECHECK_SECONDS`, so a press costs a Helix call only now and then; a no answers 403
 * and an outage 503, never a pass.
 */
function recheckModerator(deps: AppDeps): MiddlewareHandler<ModeratorEnv> {
  // Giveaway and user to the time of the last yes; one entry per moderator who pressed a button.
  const confirmed = new Map<string, Instant>()
  return async (c, next) => {
    const userId = c.get("moderatorUserId")
    if (userId === null) return next()
    const giveaway = c.get("giveaway")
    const key = `${giveaway.id}:${userId}`
    const now = deps.clock.now()
    const at = confirmed.get(key)
    if (at !== undefined && now - at < deps.config.moderatorRecheckSeconds * 1000) return next()
    const check = await checkModerator(deps, giveaway, userId)
    if (check !== "moderator") {
      confirmed.delete(key)
      return checkRefusal(c, check)
    }
    confirmed.set(key, now)
    return next()
  }
}

type ModeratorCheck = "moderator" | "not-a-moderator" | "unavailable"

/** Whether the user is the giveaway's broadcaster or a moderator of the channel now, as the platform answers with the streamer's token. */
async function checkModerator(
  deps: AppDeps,
  giveaway: Giveaway,
  userId: string,
): Promise<ModeratorCheck> {
  if (userId === giveaway.broadcasterId) return "moderator"
  try {
    const access = await openGiveawayStreamerAccess(deps, giveaway.id)
    const moderates = await access.provider.isModerator(
      access.accessToken,
      access.broadcasterId,
      userId,
    )
    return moderates ? "moderator" : "not-a-moderator"
  } catch (error) {
    if (!(error instanceof StreamerTokenMissing || error instanceof PlatformError)) throw error
    console.warn("moderator check unavailable", {
      giveawayId: giveaway.id,
      errorClass: errorClass(error),
    })
    return "unavailable"
  }
}

function checkRefusal(c: Context, check: Exclude<ModeratorCheck, "moderator">): Response {
  switch (check) {
    case "not-a-moderator":
      return c.json({ error: "not-a-moderator" }, 403)
    case "unavailable":
      return c.json({ error: "moderator-check-unavailable" }, 503)
  }
}

/** Who already proved their platform account in this browser: a signed-in streamer, else a viewer who signed in to enter a giveaway. */
async function signedInUser(
  c: Context,
  deps: AppDeps,
): Promise<{ platform: string; userId: string } | null> {
  const streamer = await currentStreamer(c, deps)
  if (streamer !== null) {
    return { platform: streamer.session.platform, userId: streamer.session.platformUserId }
  }
  return readViewerSession(c, deps)
}

// A link's token is `<link id>.<secret>`, both ids of `randomId`: the id finds the row, and the secret's
// hash is compared in constant time, so the answer time tells nothing about the stored hash.
const tokenPattern = new RegExp(`^(${hexIdText})\\.(${hexIdText})$`)

/** The working link a token opens; null for anything else, a revoked link included. */
async function linkOfToken(deps: AppDeps, token: unknown): Promise<ModeratorLink | null> {
  const parts = typeof token === "string" ? tokenPattern.exec(token) : null
  if (parts === null) return null
  const [, linkId = "", secret = ""] = parts
  const link = await deps.accounts.findModeratorLink(linkId)
  if (link === null || link.revokedAt !== null) return null
  return (await timingSafeEqual(await tokenHash(secret), link.tokenHash)) ? link : null
}

function linkJson(link: ModeratorLink): ModeratorLinkJson {
  return { id: link.id, requireMod: link.requireMod, createdAt: link.createdAt }
}

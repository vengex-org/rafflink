import { Hono } from "hono"
import { streamerTokenAad } from "../accounts/streamer-token.ts"
import { timingSafeEqual } from "hono/utils/buffer"
import { randomId } from "../lib/random-id.ts"
import { sealSecret } from "../lib/seal.ts"
import type { Instant } from "../ports.ts"
import { redirectUri, streamerCallbackPath, viewerCallbackPath } from "../twitch/redirect.ts"
import { TwitchError, TwitchInvalid } from "../twitch/twitch-client.ts"
import { enterGiveaway } from "../viewer/enter-giveaway.ts"
import type { CallbackOutcome } from "../viewer/outcome.ts"
import type { QueuedCode, EnqueueCause } from "../queue/token-queue.ts"
import type { AppDeps } from "./deps.ts"
import { outcomeQuery } from "./json.ts"
import {
  startOAuthState,
  startStreamerSession,
  startViewerSession,
  takeOAuthState,
  startPendingEntry,
} from "./session.ts"

/** Shared by every request of one app: until when new viewer codes go straight to the queue. */
export interface Cooldown {
  until: Instant
}

const streamerScopes = ["openid", "channel:read:vips", "moderation:read", "user:read:chat"] as const
const viewerScopes = ["openid", "user:read:subscriptions", "user:read:follows"] as const

const platform = "twitch"

export function authRoutes(deps: AppDeps, cooldown: Cooldown): Hono {
  const app = new Hono()

  app.get("/auth/twitch/streamer/start", async (c) => {
    const state = randomId(deps.random)
    const nonce = randomId(deps.random)
    await startOAuthState(c, deps, "streamer", { state, nonce, giveawayCode: null })
    return c.redirect(
      deps.twitch.authorizeUrl({
        state,
        nonce,
        scopes: streamerScopes,
        redirectUri: redirectUri(deps.config, streamerCallbackPath),
      }),
    )
  })

  app.get(streamerCallbackPath, async (c) => {
    const saved = await takeOAuthState(c, deps, "streamer", c.req.query("state"))
    const refused = refusalCode(c.req.query("error"))
    if (refused !== null) return c.redirect(`/?error=${refused}`)
    const code = c.req.query("code")
    if (
      saved === null
      || code === undefined
      || !(await sameText(c.req.query("state"), saved.state))
    ) {
      return c.redirect("/?signin=invalid-state")
    }
    let signIn: StreamerGrant
    try {
      signIn = await exchangeStreamer(deps, code, saved.nonce)
    } catch (error) {
      return c.redirect(`/?signin=${signInFailure(error)}`)
    }
    const streamer = await deps.accounts.signInStreamer({
      id: randomId(deps.random),
      platform,
      platformUserId: signIn.userId,
      login: signIn.login,
      displayName: signIn.displayName,
      profileImageUrl: signIn.profileImageUrl,
      sealedRefreshToken: await sealSecret(
        deps.keyRing,
        signIn.refreshToken,
        streamerTokenAad(platform, signIn.userId),
        deps.random,
      ),
      scopes: streamerScopes.join(" "),
      now: deps.clock.now(),
    })
    await startStreamerSession(c, deps, {
      streamerId: streamer.id,
      twitchUserId: streamer.platformUserId,
    })
    return c.redirect("/dashboard")
  })

  app.get("/auth/twitch/viewer/start", async (c) => {
    const code = c.req.query("giveaway")
    const giveaway = code === undefined ? null : await deps.accounts.findGiveawayByCode(code)
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const state = randomId(deps.random)
    const nonce = randomId(deps.random)
    await startOAuthState(c, deps, "viewer", { state, nonce, giveawayCode: giveaway.code })
    return c.redirect(
      deps.twitch.authorizeUrl({
        state,
        nonce,
        scopes: viewerScopes,
        redirectUri: redirectUri(deps.config, viewerCallbackPath),
        forceVerify: c.req.query("force_verify") === "true",
      }),
    )
  })

  app.get(viewerCallbackPath, async (c) => {
    const saved = await takeOAuthState(c, deps, "viewer", c.req.query("state"))
    const refused = refusalCode(c.req.query("error"))
    if (refused !== null)
      return c.redirect(`${pagePath(saved?.giveawayCode ?? null)}?error=${refused}`)
    const code = c.req.query("code")
    if (
      saved === null
      || code === undefined
      || !(await sameText(c.req.query("state"), saved.state))
    ) {
      return c.redirect(returnTo(saved?.giveawayCode ?? null, { kind: "invalid-state" }))
    }
    const giveaway =
      saved.giveawayCode === null
        ? null
        : await deps.accounts.findGiveawayByCode(saved.giveawayCode)
    if (giveaway === null) return c.redirect(returnTo(null, { kind: "invalid-state" }))
    const address = deps.clientAddress(c.req.raw)
    if (address !== null && !(await deps.entryIpLimiter.allow(address))) {
      return c.redirect(returnTo(giveaway.code, { kind: "rate-limited" }))
    }

    const item: QueuedCode = { code, giveawayId: giveaway.id, nonce: saved.nonce }
    const queued = async (cause: EnqueueCause) => {
      const enqueued = await deps.queue.enqueue(item, cause)
      cooldown.until = Math.max(cooldown.until, enqueued.cooldownUntil)
      await startPendingEntry(c, deps, giveaway, enqueued.ticket)
      return c.redirect(returnTo(giveaway.code, { kind: "pending", ticket: enqueued.ticket }))
    }
    if (deps.clock.now() < cooldown.until) return queued("cooldown")

    const attempt = await enterGiveaway(deps, giveaway, item)
    if (attempt.kind === "deferred") return queued(attempt.cause)
    if (attempt.userId !== null)
      await startViewerSession(c, deps, { platform: giveaway.platform, userId: attempt.userId })
    return c.redirect(returnTo(giveaway.code, attempt.outcome))
  })

  return app
}

interface StreamerGrant {
  readonly userId: string
  readonly login: string
  readonly displayName: string
  readonly profileImageUrl: string | null
  readonly refreshToken: string
}

async function exchangeStreamer(
  deps: AppDeps,
  code: string,
  nonce: string,
): Promise<StreamerGrant> {
  const tokens = await deps.twitch.exchangeCode(
    code,
    redirectUri(deps.config, streamerCallbackPath),
  )
  if (tokens.idToken === null) throw new TwitchInvalid("id-token", null)
  const { userId } = await deps.twitch.verifyIdToken(tokens.idToken, nonce)
  const profile = await deps.twitch.userProfile(tokens.accessToken)
  return {
    userId,
    login: profile.login,
    displayName: profile.displayName,
    profileImageUrl: profile.profileImageUrl,
    refreshToken: tokens.refreshToken,
  }
}

function signInFailure(error: unknown): "invalid-state" | "try-again" {
  if (!(error instanceof TwitchError)) throw error
  return error instanceof TwitchInvalid && error.endpoint === "id-token"
    ? "invalid-state"
    : "try-again"
}

function returnTo(giveawayCode: string | null, outcome: CallbackOutcome): string {
  return `${pagePath(giveawayCode)}?${outcomeQuery(outcome)}`
}

function pagePath(giveawayCode: string | null): string {
  return giveawayCode === null ? "/" : `/g/${giveawayCode}`
}

// Twitch's `error` is an OAuth code such as `access_denied`; anything of another shape is passed on as a plain `error`. `error_description` is free text and is not forwarded.
function refusalCode(error: string | undefined): string | null {
  if (error === undefined) return null
  return /^[a-z_]{1,50}$/.test(error) ? error : "error"
}

async function sameText(received: string | undefined, expected: string): Promise<boolean> {
  return received !== undefined && (await timingSafeEqual(received, expected))
}

import { Hono, type Context } from "hono"
import { streamerTokenAad } from "../accounts/streamer-token.ts"
import type { ChannelEntryVia } from "../domain/rules.ts"
import { timingSafeEqual } from "hono/utils/buffer"
import { giveawayPath } from "../lib/page-paths.ts"
import { randomId } from "../lib/random-id.ts"
import { sealSecret } from "../lib/seal.ts"
import type { Instant } from "../ports.ts"
import { PlatformError, PlatformIdentityRejected } from "../platform/errors.ts"
import { codeChallenge, codeVerifier } from "../platform/pkce.ts"
import { providerFor, readyEntryWays, type PlatformProvider } from "../platform/provider.ts"
import { callbackPath, redirectUri } from "../platform/redirect.ts"
import { enterGiveaway } from "../viewer/enter-giveaway.ts"
import type { CallbackOutcome } from "../viewer/outcome.ts"
import type { QueuedCode, EnqueueCause } from "../queue/token-queue.ts"
import type { AppDeps } from "./deps.ts"
import { finishModeratorSignIn } from "./moderator-routes.ts"
import { outcomeQuery } from "./json.ts"
import { defaultReturnPath, safeReturnPath } from "./return-path.ts"
import {
  type OAuthState,
  startOAuthState,
  startStreamerSession,
  startViewerSession,
  takeOAuthState,
  startPendingEntry,
  parseEntryWays,
  readEntryScopesHint,
  readStreamerSession,
  writeEntryScopesHint,
} from "./session.ts"

/**
 * Shared by every request of one app: until when new viewer codes go straight to the queue, as the latest
 * enqueue answered. An app that has not queued a code since goes to the token endpoint first.
 */
export interface Backlog {
  until: Instant
}

export function authRoutes(deps: AppDeps, backlog: Backlog): Hono {
  const app = new Hono()
  for (const provider of Object.values(deps.platforms)) {
    app.route("/", platformAuthRoutes(deps, backlog, provider))
  }
  return app
}

// The sign-in starts and callbacks of one platform, under its name: `/auth/twitch/streamer/start` for Twitch.
function platformAuthRoutes(deps: AppDeps, backlog: Backlog, provider: PlatformProvider): Hono {
  const app = new Hono()
  const { platform } = provider
  const streamerCallbackPath = callbackPath(platform, "streamer")
  const viewerCallbackPath = callbackPath(platform, "viewer")

  app.get(`/auth/${platform}/streamer/start`, async (c) => {
    const state = randomId(deps.random)
    const nonce = randomId(deps.random)
    const verifier = codeVerifier(deps.random)
    const returnPath = safeReturnPath(c.req.query("return")) ?? defaultReturnPath
    // `?entry=chat,sub` is the wizard's "Reconnect Twitch": the base scopes plus the ones those entry ways
    // need. Twitch grants only the scopes a sign-in asks for, so the ways granted before are asked again.
    const asked = parseEntryWays(c.req.query("entry")?.split(",") ?? []) ?? []
    const granted = await grantedEntryWays(c, deps, provider)
    const entryWays = [...new Set([...granted, ...asked])]
    await startOAuthState(c, deps, "streamer", {
      state,
      nonce,
      codeVerifier: verifier,
      giveawayCode: null,
      returnPath,
      moderatorLinkId: null,
      entryWays,
    })
    return c.redirect(
      provider.authorizeUrl({
        state,
        nonce,
        codeChallenge: await codeChallenge(verifier),
        scopes: streamerScopes(provider, entryWays),
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
      signIn = await exchangeStreamer(deps, provider, code, saved)
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
      scopes: streamerScopes(provider, saved.entryWays).join(" "),
      now: deps.clock.now(),
    })
    await startStreamerSession(c, deps, {
      streamerId: streamer.id,
      platform,
      platformUserId: streamer.platformUserId,
    })
    await writeEntryScopesHint(c, deps, saved.entryWays)
    return c.redirect(saved.returnPath ?? defaultReturnPath)
  })

  app.get(`/auth/${platform}/viewer/start`, async (c) => {
    const code = c.req.query("giveaway")
    const giveaway = code === undefined ? null : await deps.accounts.findGiveawayByCode(code)
    if (giveaway === null) return c.json({ error: "not-found" }, 404)
    const state = randomId(deps.random)
    const nonce = randomId(deps.random)
    const verifier = codeVerifier(deps.random)
    await startOAuthState(c, deps, "viewer", {
      state,
      nonce,
      codeVerifier: verifier,
      giveawayCode: giveaway.code,
      returnPath: null,
      moderatorLinkId: null,
      entryWays: [],
    })
    return c.redirect(
      provider.authorizeUrl({
        state,
        nonce,
        codeChallenge: await codeChallenge(verifier),
        scopes: provider.scopes.viewer,
        redirectUri: redirectUri(deps.config, viewerCallbackPath),
        forceVerify: c.req.query("force_verify") === "true",
      }),
    )
  })

  app.get(viewerCallbackPath, async (c) => {
    const saved = await takeOAuthState(c, deps, "viewer", c.req.query("state"))
    if (saved !== null && saved.moderatorLinkId !== null) {
      return finishModeratorSignIn(c, deps, provider, saved, saved.moderatorLinkId)
    }
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

    const item: QueuedCode = {
      code,
      giveawayId: giveaway.id,
      nonce: saved.nonce,
      codeVerifier: saved.codeVerifier,
    }
    const queued = async (cause: EnqueueCause) => {
      const enqueued = await deps.queue.enqueue(item, cause)
      // The latest answer wins, so a lease ends as soon as the queue says it keeps up.
      backlog.until = enqueued.queueUntil
      await startPendingEntry(c, deps, giveaway, enqueued.ticket)
      return c.redirect(returnTo(giveaway.code, { kind: "pending", ticket: enqueued.ticket }))
    }
    // Behind a backlog a direct call would overtake the queued viewers and spend the rate the queue drains at.
    if (deps.clock.now() < backlog.until) return queued("backlog")

    const attempt = await enterGiveaway(deps, giveaway, item)
    if (attempt.kind === "deferred") return queued(attempt.cause)
    if (attempt.userId !== null)
      await startViewerSession(c, deps, {
        platform: providerFor(deps.platforms, giveaway.platform).platform,
        userId: attempt.userId,
      })
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

// The browser's last sign-in granted them, or the signed-in streamer's stored token holds them.
async function grantedEntryWays(
  c: Context,
  deps: AppDeps,
  provider: PlatformProvider,
): Promise<readonly ChannelEntryVia[]> {
  const hinted = await readEntryScopesHint(c, deps)
  const session = await readStreamerSession(c, deps)
  if (session === null || session.platform !== provider.platform) return hinted
  const token = await deps.accounts.findStreamerToken(session.streamerId)
  const stored = token === null ? [] : readyEntryWays(provider, token.scopes)
  return [...new Set([...hinted, ...stored])]
}

function streamerScopes(
  provider: PlatformProvider,
  entryWays: readonly ChannelEntryVia[],
): readonly [string, ...string[]] {
  const [first, ...rest] = provider.scopes.streamer
  const extra = entryWays.flatMap((way) => provider.entryScopes[way])
  return [first, ...new Set([...rest, ...extra])]
}

async function exchangeStreamer(
  deps: AppDeps,
  provider: PlatformProvider,
  code: string,
  saved: Pick<OAuthState, "nonce" | "codeVerifier">,
): Promise<StreamerGrant> {
  const tokens = await provider.exchangeCode(
    code,
    redirectUri(deps.config, callbackPath(provider.platform, "streamer")),
    saved.codeVerifier,
  )
  const userId = await provider.verifySignIn(tokens, { nonce: saved.nonce })
  const profile = await provider.userProfile(tokens.accessToken)
  return {
    userId,
    login: profile.login,
    displayName: profile.displayName,
    profileImageUrl: profile.profileImageUrl,
    refreshToken: tokens.refreshToken,
  }
}

function signInFailure(error: unknown): "invalid-state" | "try-again" {
  if (!(error instanceof PlatformError)) throw error
  return error instanceof PlatformIdentityRejected ? "invalid-state" : "try-again"
}

function returnTo(giveawayCode: string | null, outcome: CallbackOutcome): string {
  return `${pagePath(giveawayCode)}?${outcomeQuery(outcome)}`
}

function pagePath(giveawayCode: string | null): string {
  return giveawayCode === null ? "/" : giveawayPath(giveawayCode)
}

// Twitch's `error` is an OAuth code such as `access_denied`; anything of another shape is passed on as a plain `error`. `error_description` is free text and is not forwarded.
function refusalCode(error: string | undefined): string | null {
  if (error === undefined) return null
  return /^[a-z_]{1,50}$/.test(error) ? error : "error"
}

async function sameText(received: string | undefined, expected: string): Promise<boolean> {
  return received !== undefined && (await timingSafeEqual(received, expected))
}

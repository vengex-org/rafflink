import type { Context } from "hono"
import { deleteCookie, getCookie, getSignedCookie, setSignedCookie } from "hono/cookie"
import type { ResolvedConfig } from "../config.ts"
import { isPlatform, type OAuthFlow, type Platform } from "../platform/provider.ts"
import type { Clock, Instant } from "../ports.ts"

export type SessionConfig = Pick<
  ResolvedConfig,
  | "sessionSecret"
  | "sessionTtlSeconds"
  | "viewerSessionTtlSeconds"
  | "stateCookieTtlSeconds"
  | "queueCodeMaxAgeSeconds"
  | "publicUrl"
>

export interface SessionDeps {
  readonly config: SessionConfig
  readonly clock: Clock
}

/** A signed-in streamer. On Twitch, `platformUserId` is what `ADMIN_TWITCH_IDS` lists. */
export interface StreamerSession {
  readonly streamerId: string
  readonly platform: Platform
  readonly platformUserId: string
}

/** A viewer who signed in: the cookie holds who they are on which platform and no token. */
export interface ViewerSession {
  readonly platform: Platform
  readonly userId: string
}

/** The giveaway a queued sign-in belongs to; its code scopes the cookie to the poll route. */
export interface PendingGiveaway {
  readonly id: string
  readonly code: string
}

/** A queued sign-in: only the browser that was queued may poll the ticket and receive the viewer session. */
export interface PendingEntry {
  readonly ticket: string
  readonly giveawayId: string
}

/**
 * What the sign-in start remembers for the callback. `giveawayCode` is set for the viewer flow, `returnPath`
 * for the streamer flow, `moderatorLinkId` for a moderator's sign-in, which runs on the viewer callback.
 */
export interface OAuthState {
  readonly state: string
  readonly nonce: string
  /** The PKCE verifier whose challenge the sign-in start sent; the code exchange proves it. */
  readonly codeVerifier: string
  readonly giveawayCode: string | null
  readonly returnPath: string | null
  readonly moderatorLinkId: string | null
  /** The streamer sign-in asked for the chat entry scopes too; false for every other sign-in. */
  readonly chatEntry: boolean
}

const cookieNames = {
  streamer: "rl_streamer",
  viewer: "rl_viewer",
} as const

// One cookie per queued giveaway and per sign-in in progress, so a second one in the same browser
// does not overwrite the first. Ids and states are 32 hex characters, which are safe in a cookie name.
const oauthCookiePrefix = { streamer: "rl_oauth_streamer_", viewer: "rl_oauth_viewer_" } as const
/** The text of an id, state, ticket or secret of `randomId`: 32 lower-case hex characters. */
export const hexIdText = "[0-9a-f]{32}"
const hexId = new RegExp(`^${hexIdText}$`)

/**
 * Sign-in states of one flow a browser keeps, the new one included. Only a finished callback deletes
 * its cookie, so abandoned starts would pile up until the request header overflows; a starting guess,
 * enough for a few tabs.
 */
export const oauthStatesPerFlow = 5

function pendingCookie(giveaway: PendingGiveaway): { name: string; path: string } {
  return {
    name: `rl_pending_${giveaway.id}`,
    path: `/api/g/${giveaway.code}/pending`,
  }
}

export async function readStreamerSession(
  c: Context,
  deps: SessionDeps,
): Promise<StreamerSession | null> {
  return readCookie(c, deps, cookieNames.streamer, (value) => {
    const { streamerId, platform, platformUserId } = value
    if (typeof streamerId !== "string" || typeof platformUserId !== "string") return null
    if (typeof platform !== "string" || !isPlatform(platform)) return null
    return { streamerId, platform, platformUserId }
  })
}

export async function startStreamerSession(
  c: Context,
  deps: SessionDeps,
  session: StreamerSession,
): Promise<void> {
  await writeCookie(c, deps, cookieNames.streamer, session, deps.config.sessionTtlSeconds)
}

export function endStreamerSession(c: Context): void {
  deleteCookie(c, cookieNames.streamer, { path: "/" })
}

export async function readViewerSession(
  c: Context,
  deps: SessionDeps,
): Promise<ViewerSession | null> {
  return readCookie(c, deps, cookieNames.viewer, (value) => {
    const { platform, userId } = value
    if (typeof platform !== "string" || !isPlatform(platform)) return null
    return typeof userId === "string" ? { platform, userId } : null
  })
}

export async function startViewerSession(
  c: Context,
  deps: SessionDeps,
  session: ViewerSession,
): Promise<void> {
  await writeCookie(c, deps, cookieNames.viewer, session, deps.config.viewerSessionTtlSeconds)
}

export async function startPendingEntry(
  c: Context,
  deps: SessionDeps,
  giveaway: PendingGiveaway,
  ticket: string,
): Promise<void> {
  // Outlives the queued code: the browser must still prove the ticket when the queue reports the drop.
  const ttlSeconds = deps.config.queueCodeMaxAgeSeconds * 2
  const { name, path } = pendingCookie(giveaway)
  await writeCookie(c, deps, name, { ticket, giveawayId: giveaway.id }, ttlSeconds, path)
}

export async function readPendingEntry(
  c: Context,
  deps: SessionDeps,
  giveaway: PendingGiveaway,
): Promise<PendingEntry | null> {
  return readCookie(c, deps, pendingCookie(giveaway).name, (value) => {
    const { ticket, giveawayId } = value
    return typeof ticket === "string" && giveawayId === giveaway.id ? { ticket, giveawayId } : null
  })
}

export function endPendingEntry(c: Context, giveaway: PendingGiveaway): void {
  const { name, path } = pendingCookie(giveaway)
  deleteCookie(c, name, { path })
}

/**
 * Whoever opened a moderator link of one giveaway: the cookie names the link, which every request looks up so
 * a revoked link stops at once, and for a link that requires a moderator the platform user who signed in.
 */
export interface ModeratorSession {
  readonly linkId: string
  /** Null for a link anyone may use. */
  readonly platformUserId: string | null
}

// A link that requires a moderator, opened by someone not signed in: only the link id waits for the
// sign-in start, never the link's secret.
const moderatorPendingCookie = { name: "rl_mod_pending", path: "/auth/" } as const

// One cookie per giveaway, sent only to that giveaway's moderator routes. Giveaway ids are 32 hex characters.
function moderatorCookie(giveawayId: string): { name: string; path: string } {
  return { name: `rl_mod_${giveawayId}`, path: `/api/mod/${giveawayId}` }
}

export async function startModeratorSession(
  c: Context,
  deps: SessionDeps,
  giveawayId: string,
  session: ModeratorSession,
): Promise<void> {
  const { name, path } = moderatorCookie(giveawayId)
  await writeCookie(c, deps, name, session, deps.config.sessionTtlSeconds, path)
}

export async function readModeratorSession(
  c: Context,
  deps: SessionDeps,
  giveawayId: string,
): Promise<ModeratorSession | null> {
  if (!hexId.test(giveawayId)) return null
  return readCookie(c, deps, moderatorCookie(giveawayId).name, (value) => {
    const { linkId, platformUserId } = value
    if (typeof linkId !== "string") return null
    if (platformUserId !== null && typeof platformUserId !== "string") return null
    return { linkId, platformUserId }
  })
}

export async function startModeratorPending(
  c: Context,
  deps: SessionDeps,
  linkId: string,
): Promise<void> {
  const { name, path } = moderatorPendingCookie
  await writeCookie(c, deps, name, { linkId }, deps.config.stateCookieTtlSeconds, path)
}

/** The link a moderator's sign-in start is for; the cookie is removed, a start uses it once. */
export async function takeModeratorPending(c: Context, deps: SessionDeps): Promise<string | null> {
  const { name, path } = moderatorPendingCookie
  const linkId = await readCookie(c, deps, name, (value) =>
    typeof value.linkId === "string" ? value.linkId : null,
  )
  deleteCookie(c, name, { path })
  return linkId
}

export async function startOAuthState(
  c: Context,
  deps: SessionDeps,
  flow: OAuthFlow,
  state: OAuthState,
): Promise<void> {
  await dropOlderOAuthStates(c, deps, flow)
  const name = `${oauthCookiePrefix[flow]}${state.state}`
  await writeCookie(c, deps, name, state, deps.config.stateCookieTtlSeconds)
}

// Keeps the newest states that leave room for the one being written.
async function dropOlderOAuthStates(c: Context, deps: SessionDeps, flow: OAuthFlow): Promise<void> {
  const prefix = oauthCookiePrefix[flow]
  const names = Object.keys(getCookie(c)).filter((name) => name.startsWith(prefix))
  // An expired or unverifiable cookie reads as no expiry and sorts last.
  const expiries = await Promise.all(
    names.map(async (name) => ({
      name,
      expiresAt: await readCookie(c, deps, name, (value) =>
        typeof value.expiresAt === "number" ? value.expiresAt : null,
      ),
    })),
  )
  const newestFirst = expiries.toSorted((a, b) => (b.expiresAt ?? -1) - (a.expiresAt ?? -1))
  for (const { name } of newestFirst.slice(oauthStatesPerFlow - 1)) {
    deleteCookie(c, name, { path: "/" })
  }
}

/**
 * Reads the state cookie of the sign-in whose `state` came back from the platform and removes it, so a
 * callback can be answered once per sign-in start. A state of another shape has no cookie.
 */
export async function takeOAuthState(
  c: Context,
  deps: SessionDeps,
  flow: OAuthFlow,
  returnedState: string | undefined,
): Promise<OAuthState | null> {
  if (returnedState === undefined || !hexId.test(returnedState)) return null
  const name = `${oauthCookiePrefix[flow]}${returnedState}`
  const saved = await readCookie(c, deps, name, (value) => {
    const { state, nonce, codeVerifier, giveawayCode, returnPath, moderatorLinkId, chatEntry } =
      value
    if (typeof state !== "string" || typeof nonce !== "string") return null
    if (typeof codeVerifier !== "string") return null
    if (giveawayCode !== null && typeof giveawayCode !== "string") return null
    if (returnPath !== null && typeof returnPath !== "string") return null
    if (moderatorLinkId !== null && typeof moderatorLinkId !== "string") return null
    if (typeof chatEntry !== "boolean") return null
    return { state, nonce, codeVerifier, giveawayCode, returnPath, moderatorLinkId, chatEntry }
  })
  deleteCookie(c, name, { path: "/" })
  return saved
}

async function writeCookie(
  c: Context,
  deps: SessionDeps,
  name: string,
  payload: object,
  ttlSeconds: number,
  path = "/",
): Promise<void> {
  const expiresAt: Instant = deps.clock.now() + ttlSeconds * 1000
  await setSignedCookie(
    c,
    name,
    JSON.stringify({ ...payload, expiresAt }),
    deps.config.sessionSecret,
    {
      path,
      httpOnly: true,
      secure: deps.config.publicUrl.startsWith("https:"),
      sameSite: "Lax",
      maxAge: ttlSeconds,
    },
  )
}

// A missing, unsigned, tampered, expired or malformed cookie is no cookie.
async function readCookie<T>(
  c: Context,
  deps: SessionDeps,
  name: string,
  parse: (value: Record<string, unknown>) => T | null,
): Promise<T | null> {
  const raw = await getSignedCookie(c, deps.config.sessionSecret, name)
  if (typeof raw !== "string") return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const record: Record<string, unknown> = { ...value }
  if (typeof record.expiresAt !== "number" || deps.clock.now() >= record.expiresAt) return null
  return parse(record)
}

import type { Context } from "hono"
import { deleteCookie, getCookie, getSignedCookie, setSignedCookie } from "hono/cookie"
import type { ResolvedConfig } from "../config.ts"
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

/** A signed-in streamer. `twitchUserId` is what `ADMIN_TWITCH_IDS` lists. */
export interface StreamerSession {
  readonly streamerId: string
  readonly twitchUserId: string
}

/** A viewer who signed in: the cookie holds who they are on which platform and no token. */
export interface ViewerSession {
  readonly platform: string
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

export type OAuthFlow = "streamer" | "viewer"

/** What the sign-in start remembers for the callback. `giveawayCode` is set for the viewer flow, `returnPath` for the streamer flow. */
export interface OAuthState {
  readonly state: string
  readonly nonce: string
  readonly giveawayCode: string | null
  readonly returnPath: string | null
}

const cookieNames = {
  streamer: "rl_streamer",
  viewer: "rl_viewer",
} as const

// One cookie per queued giveaway and per sign-in in progress, so a second one in the same browser
// does not overwrite the first. Ids and states are 32 hex characters, which are safe in a cookie name.
const oauthCookiePrefix = { streamer: "rl_oauth_streamer_", viewer: "rl_oauth_viewer_" } as const
const hexId = /^[0-9a-f]{32}$/

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
    const { streamerId, twitchUserId } = value
    if (typeof streamerId !== "string" || typeof twitchUserId !== "string") return null
    return { streamerId, twitchUserId }
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
    return typeof platform === "string" && typeof userId === "string" ? { platform, userId } : null
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
 * Reads the state cookie of the sign-in whose `state` came back from Twitch and removes it, so a
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
    const { state, nonce, giveawayCode, returnPath } = value
    if (typeof state !== "string" || typeof nonce !== "string") return null
    if (giveawayCode !== null && typeof giveawayCode !== "string") return null
    if (returnPath !== null && typeof returnPath !== "string") return null
    return { state, nonce, giveawayCode, returnPath }
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

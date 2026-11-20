import type { Context } from "hono"
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie"
import type { ResolvedConfig } from "../config.ts"
import type { Clock, Instant } from "../ports.ts"

export type SessionConfig = Pick<
  ResolvedConfig,
  "sessionSecret" | "sessionTtlSeconds" | "stateCookieTtlSeconds" | "publicUrl"
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

/** A viewer who signed in with Twitch, so a winner can claim. */
export interface ViewerSession {
  readonly userId: string
}

export type OAuthFlow = "streamer" | "viewer"

/** What the sign-in start remembers for the callback. `giveawayCode` is set for the viewer flow. */
export interface OAuthState {
  readonly state: string
  readonly nonce: string
  readonly giveawayCode: string | null
}

const cookieNames = {
  streamer: "rl_streamer",
  viewer: "rl_viewer",
  oauth: { streamer: "rl_oauth_streamer", viewer: "rl_oauth_viewer" },
} as const

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

export async function readViewerSession(
  c: Context,
  deps: SessionDeps,
): Promise<ViewerSession | null> {
  return readCookie(c, deps, cookieNames.viewer, (value) => {
    return typeof value.userId === "string" ? { userId: value.userId } : null
  })
}

export async function startViewerSession(
  c: Context,
  deps: SessionDeps,
  session: ViewerSession,
): Promise<void> {
  await writeCookie(c, deps, cookieNames.viewer, session, deps.config.sessionTtlSeconds)
}

export async function startOAuthState(
  c: Context,
  deps: SessionDeps,
  flow: OAuthFlow,
  state: OAuthState,
): Promise<void> {
  await writeCookie(c, deps, cookieNames.oauth[flow], state, deps.config.stateCookieTtlSeconds)
}

/** Reads the state cookie and removes it, so a callback can be answered once per sign-in start. */
export async function takeOAuthState(
  c: Context,
  deps: SessionDeps,
  flow: OAuthFlow,
): Promise<OAuthState | null> {
  const name = cookieNames.oauth[flow]
  const saved = await readCookie(c, deps, name, (value) => {
    const { state, nonce, giveawayCode } = value
    if (typeof state !== "string" || typeof nonce !== "string") return null
    if (giveawayCode !== null && typeof giveawayCode !== "string") return null
    return { state, nonce, giveawayCode }
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
): Promise<void> {
  const expiresAt: Instant = deps.clock.now() + ttlSeconds * 1000
  await setSignedCookie(
    c,
    name,
    JSON.stringify({ ...payload, expiresAt }),
    deps.config.sessionSecret,
    {
      path: "/",
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

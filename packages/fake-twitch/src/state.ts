import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK } from "jose"

export interface FakeUser {
  id: string
  login: string
  displayName: string
  /** ISO 8601 account creation time, returned by `GET /helix/users`. */
  createdAt: string
  /** Returned by `GET /helix/users` as `profile_image_url`. */
  profileImageUrl: string
}

export interface FakeTwitchOptions {
  clientId: string
  clientSecret: string
  /** Signed in by `/oauth2/authorize` until `control.signInAs` or a `login_hint` query picks another user. */
  defaultUser: FakeUser
  /** When true, `/oauth2/authorize` without `login_hint` shows a page to pick the user instead of signing in the default. */
  userPicker?: boolean
  /** How long a fresh EventSub socket may stay without a subscription before it is closed. */
  subscribeWindowMs: number
  /** Announced in the welcome message; keepalive messages go out at half of it. */
  keepaliveTimeoutSeconds: number
  /** Token endpoint requests allowed per second; the rest answer 429 like a rate-limited Twitch. No limit when unset. */
  tokenLimitPerSecond?: number
}

export type Tier = "1000" | "2000" | "3000"
export type Role = "vip" | "moderator"
export type FailableEndpoint =
  | "token"
  | "subscriptions"
  | "followed"
  | "users"
  | "vips"
  | "moderators"
  | "badges"
  | "eventsub"
export type FailureStatus = 429 | 500 | 502 | 503 | 504
/** How the next id_token is made wrong: signed by a key `/oauth2/keys` does not serve, issued by another party, or already expired. */
export type IdTokenFault = "bad-signature" | "wrong-issuer" | "expired"

export interface Call {
  method: string
  path: string
  query: Record<string, string>
}

export interface AuthorizationCode {
  userId: string
  scopes: string[]
  nonce: string | undefined
  redirectUri: string
}

export interface AccessToken {
  /** `null` for an app access token, which belongs to no user. */
  userId: string | null
  scopes: string[]
  revoked: boolean
}

export interface RefreshToken {
  userId: string
  scopes: string[]
}

export interface SigningKey {
  privateKey: CryptoKey
  /** Public half with `kid`, `alg` and `use` set, as served by `/oauth2/keys`. */
  jwk: JWK & { kid: string }
}

export interface FakeState {
  readonly options: FakeTwitchOptions
  readonly users: Map<string, FakeUser>
  /** Keyed by `pairKey(broadcasterId, userId)`. */
  readonly subscriptions: Map<string, Tier>
  /** Keyed by `pairKey(userId, broadcasterId)`. */
  readonly follows: Set<string>
  /** Role holders per broadcaster, in the order they were added. */
  readonly roles: Record<Role, Map<string, Set<string>>>
  /** Subscriber badge image per tier a channel set, keyed by broadcaster id; a channel without an entry has no badges of its own. */
  readonly channelSubscriberBadges: Map<string, Partial<Record<Tier, string>>>
  readonly codes: Map<string, AuthorizationCode>
  readonly accessTokens: Map<string, AccessToken>
  readonly refreshTokens: Map<string, RefreshToken>
  readonly failures: Map<FailableEndpoint, FailureStatus[]>
  readonly idTokenFaults: IdTokenFault[]
  readonly calls: Call[]
  readonly signingKey: Promise<SigningKey>
  signInUserId: string
  /** Token endpoint requests counted in the whole second `second`. */
  tokenWindow: { second: number; count: number }
}

export function createState(options: FakeTwitchOptions): FakeState {
  return {
    options,
    users: new Map([[options.defaultUser.id, options.defaultUser]]),
    subscriptions: new Map(),
    follows: new Set(),
    roles: { vip: new Map(), moderator: new Map() },
    channelSubscriberBadges: new Map(),
    codes: new Map(),
    accessTokens: new Map(),
    refreshTokens: new Map(),
    failures: new Map(),
    idTokenFaults: [],
    calls: [],
    signingKey: createSigningKey(),
    signInUserId: options.defaultUser.id,
    tokenWindow: { second: 0, count: 0 },
  }
}

export function pairKey(first: string, second: string): string {
  return `${first}:${second}`
}

export function requireUser(state: FakeState, id: string): FakeUser {
  const user = state.users.get(id)
  if (user === undefined)
    throw new Error(`fake Twitch has no user ${id}; call control.addUser first`)
  return user
}

export function takeFailure(
  state: FakeState,
  endpoint: FailableEndpoint,
): FailureStatus | undefined {
  return state.failures.get(endpoint)?.shift()
}

/** Counts one token endpoint request; true when `tokenLimitPerSecond` is spent for the current second. */
export function tokenLimitReached(state: FakeState, nowMs: number): boolean {
  const limit = state.options.tokenLimitPerSecond
  if (limit === undefined) return false
  const second = Math.floor(nowMs / 1000)
  if (state.tokenWindow.second !== second) state.tokenWindow = { second, count: 0 }
  state.tokenWindow.count += 1
  return state.tokenWindow.count > limit
}

async function createSigningKey(): Promise<SigningKey> {
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const publicJwk = await exportJWK(publicKey)
  const kid = await calculateJwkThumbprint(publicJwk)
  return { privateKey, jwk: { ...publicJwk, kid, alg: "RS256", use: "sig" } }
}

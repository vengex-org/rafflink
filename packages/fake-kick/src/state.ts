export interface FakeKickUser {
  /** Kick user ids are numbers; written as their decimal text. */
  id: string
  /** The username, returned by `GET /public/v1/users` as `name`; its lower case is the channel slug. */
  name: string
}

export interface FakeKickOptions {
  clientId: string
  clientSecret: string
  /** Signed in by `/oauth/authorize` until `control.signInAs` picks another user. */
  defaultUser: FakeKickUser
}

export type FailableEndpoint = "token" | "users" | "subscribe" | "unsubscribe" | "public-key"
export type FailureStatus = 400 | 429 | 500 | 503

export interface Call {
  method: string
  path: string
  query: Record<string, string>
}

export interface AuthorizationCode {
  userId: string
  scopes: string[]
  redirectUri: string
  codeChallenge: string
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

export interface Subscription {
  id: string
  broadcasterId: string
  event: string
  version: number
}

export interface SigningKey {
  privateKey: CryptoKey
  /** The public half as the PEM text `GET /public/v1/public-key` serves. */
  publicPem: string
}

export interface FakeState {
  readonly options: FakeKickOptions
  readonly users: Map<string, FakeKickUser>
  readonly codes: Map<string, AuthorizationCode>
  readonly accessTokens: Map<string, AccessToken>
  readonly refreshTokens: Map<string, RefreshToken>
  readonly subscriptions: Map<string, Subscription>
  readonly failures: Map<FailableEndpoint, FailureStatus[]>
  readonly calls: Call[]
  signingKey: Promise<SigningKey>
  signInUserId: string
  /** Where webhooks go; set by `control.setWebhookUrl`, as the Kick developer settings do. */
  webhookUrl: string | null
}

export function createState(options: FakeKickOptions): FakeState {
  return {
    options,
    users: new Map([[options.defaultUser.id, options.defaultUser]]),
    codes: new Map(),
    accessTokens: new Map(),
    refreshTokens: new Map(),
    subscriptions: new Map(),
    failures: new Map(),
    calls: [],
    signingKey: createSigningKey(),
    signInUserId: options.defaultUser.id,
    webhookUrl: null,
  }
}

export function requireUser(state: FakeState, id: string): FakeKickUser {
  const user = state.users.get(id)
  if (user === undefined) throw new Error(`fake Kick has no user ${id}; call control.addUser first`)
  return user
}

export function takeFailure(
  state: FakeState,
  endpoint: FailableEndpoint,
): FailureStatus | undefined {
  return state.failures.get(endpoint)?.shift()
}

/** A fresh RSA key pair of the kind Kick signs webhooks with (PKCS#1 v1.5, SHA-256). */
export async function createSigningKey(): Promise<SigningKey> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", publicKey))
  const base64 = Buffer.from(spki).toString("base64")
  const lines = base64.match(/.{1,64}/g) ?? []
  const publicPem = `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`
  return { privateKey, publicPem }
}

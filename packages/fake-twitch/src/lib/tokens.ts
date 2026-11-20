import { generateKeyPair, SignJWT } from "jose"
import type { FakeState, FakeUser } from "../state.ts"

export const issuer = "https://id.twitch.tv/oauth2"
/** Twitch user access tokens last about four hours. */
export const accessTokenTtlSeconds = 14_400
/** Twitch app access tokens last about two months. */
const appTokenTtlSeconds = 5_184_000

export function issueTokens(state: FakeState, userId: string, scopes: string[]) {
  const accessToken = crypto.randomUUID()
  const refreshToken = crypto.randomUUID()
  state.accessTokens.set(accessToken, { userId, scopes, revoked: false })
  state.refreshTokens.set(refreshToken, { userId, scopes })
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: accessTokenTtlSeconds,
    scope: scopes,
    token_type: "bearer",
  }
}

/** An app access token (client credentials grant): no user, no refresh token. */
export function issueAppToken(state: FakeState) {
  const accessToken = crypto.randomUUID()
  state.accessTokens.set(accessToken, { userId: null, scopes: [], revoked: false })
  return { access_token: accessToken, expires_in: appTokenTtlSeconds, token_type: "bearer" }
}

export async function signIdToken(state: FakeState, user: FakeUser, nonce: string | undefined) {
  const { privateKey: servedKey, jwk } = await state.signingKey
  const fault = state.idTokenFaults.shift()
  const privateKey =
    fault === "bad-signature" ? (await generateKeyPair("RS256")).privateKey : servedKey
  const issuedAt =
    Math.floor(Date.now() / 1000) - (fault === "expired" ? 2 * accessTokenTtlSeconds : 0)
  return new SignJWT({
    azp: state.options.clientId,
    preferred_username: user.login,
    ...(nonce === undefined ? {} : { nonce }),
  })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(fault === "wrong-issuer" ? "https://id.twitch.tv.evil.example/oauth2" : issuer)
    .setAudience(state.options.clientId)
    .setSubject(user.id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + accessTokenTtlSeconds)
    .sign(privateKey)
}

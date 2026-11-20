import { SignJWT } from "jose"
import type { FakeState, FakeUser } from "../state.ts"

export const ISSUER = "https://id.twitch.tv/oauth2"
/** Twitch user access tokens last about four hours. */
export const ACCESS_TOKEN_TTL_SECONDS = 14_400

export function issueTokens(state: FakeState, userId: string, scopes: string[]) {
  const accessToken = crypto.randomUUID()
  const refreshToken = crypto.randomUUID()
  state.accessTokens.set(accessToken, { userId, scopes, revoked: false })
  state.refreshTokens.set(refreshToken, { userId, scopes })
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: scopes,
    token_type: "bearer",
  }
}

export async function signIdToken(state: FakeState, user: FakeUser, nonce: string | undefined) {
  const { privateKey, jwk } = await state.signingKey
  const issuedAt = Math.floor(Date.now() / 1000)
  return new SignJWT({
    azp: state.options.clientId,
    preferred_username: user.login,
    ...(nonce === undefined ? {} : { nonce }),
  })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(ISSUER)
    .setAudience(state.options.clientId)
    .setSubject(user.id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .sign(privateKey)
}

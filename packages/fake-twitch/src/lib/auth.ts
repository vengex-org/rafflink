import type { Context } from "hono"
import { createMiddleware } from "hono/factory"
import type { AccessToken, FakeState } from "../state.ts"
import { helixError } from "./responses.ts"

export type HelixEnv = { Variables: { token: AccessToken } }

export function bearerToken(header: string | undefined): string | undefined {
  return header?.match(/^(?:Bearer|OAuth) (.+)$/i)?.[1]
}

/** Checks `Authorization` and `Client-Id` the way Helix does and exposes the token record. */
export function helixAuth(state: FakeState) {
  return createMiddleware<HelixEnv>(async (c, next) => {
    const accessToken = bearerToken(c.req.header("authorization"))
    if (accessToken === undefined) return helixError(c, 401, "Missing User OAuth Token")
    const token = state.accessTokens.get(accessToken)
    if (token === undefined || token.revoked) return helixError(c, 401, "Invalid OAuth token")
    if (c.req.header("client-id") !== state.options.clientId) {
      return helixError(c, 401, "Client ID and OAuth token do not match")
    }
    c.set("token", token)
    await next()
  })
}

export function requireScope(c: Context<HelixEnv>, scope: string) {
  return c.get("token").scopes.includes(scope)
    ? undefined
    : helixError(c, 401, `Missing scope: ${scope}`)
}

import { Hono } from "hono"
import { takeFailure, type FakeState } from "../state.ts"

/** Kick user access tokens last about two hours. */
const accessTokenTtlSeconds = 7200
/** App access tokens; Kick does not document their lifetime, so the same. */
const appTokenTtlSeconds = 7200

/** `id.kick.com`: the OAuth 2.1 authorize page and token endpoint, with PKCE S256 required. */
export function idRoutes(state: FakeState): Hono {
  const app = new Hono()

  app.get("/authorize", (c) => {
    const query = c.req.query()
    if (query.client_id !== state.options.clientId) return c.json({ error: "Invalid request" }, 400)
    if (query.response_type !== "code") return c.json({ error: "Invalid request" }, 400)
    const redirectUri = query.redirect_uri
    if (redirectUri === undefined || !URL.canParse(redirectUri)) {
      return c.json({ error: "Invalid request" }, 400)
    }
    if (query.state === undefined || query.scope === undefined) {
      return c.json({ error: "Invalid request" }, 400)
    }
    if (query.code_challenge === undefined || query.code_challenge_method !== "S256") {
      return c.json({ error: "Invalid request" }, 400)
    }
    const code = crypto.randomUUID()
    state.codes.set(code, {
      userId: state.signInUserId,
      scopes: query.scope.split(" ").filter((scope) => scope !== ""),
      redirectUri,
      codeChallenge: query.code_challenge,
    })
    const target = new URL(redirectUri)
    target.searchParams.set("code", code)
    target.searchParams.set("state", query.state)
    return c.redirect(target.toString(), 302)
  })

  app.post("/token", async (c) => {
    const failure = takeFailure(state, "token")
    if (failure !== undefined) return c.body(null, failure)
    const form = new URLSearchParams(await c.req.text())
    if (
      form.get("client_id") !== state.options.clientId
      || form.get("client_secret") !== state.options.clientSecret
    ) {
      return c.json({ error: "invalid_client" }, 401)
    }
    const grantType = form.get("grant_type")
    if (grantType === "authorization_code") {
      const code = form.get("code")
      const grant = code === null ? undefined : state.codes.get(code)
      if (code === null || grant === undefined) return c.json({ error: "invalid_grant" }, 400)
      state.codes.delete(code)
      if (form.get("redirect_uri") !== grant.redirectUri) {
        return c.json({ error: "invalid_grant" }, 400)
      }
      const verifier = form.get("code_verifier")
      if (verifier === null || (await challengeOf(verifier)) !== grant.codeChallenge) {
        return c.json({ error: "invalid_grant" }, 400)
      }
      return c.json(issueTokens(state, grant.userId, grant.scopes))
    }
    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token")
      const grant = refreshToken === null ? undefined : state.refreshTokens.get(refreshToken)
      if (refreshToken === null || grant === undefined) {
        return c.json({ error: "invalid_grant" }, 400)
      }
      state.refreshTokens.delete(refreshToken)
      return c.json(issueTokens(state, grant.userId, grant.scopes))
    }
    if (grantType === "client_credentials") {
      const accessToken = crypto.randomUUID()
      state.accessTokens.set(accessToken, { userId: null, scopes: [], revoked: false })
      return c.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: appTokenTtlSeconds,
      })
    }
    return c.json({ error: "unsupported_grant_type" }, 400)
  })

  return app
}

function issueTokens(state: FakeState, userId: string, scopes: string[]) {
  const accessToken = crypto.randomUUID()
  const refreshToken = crypto.randomUUID()
  state.accessTokens.set(accessToken, { userId, scopes, revoked: false })
  state.refreshTokens.set(refreshToken, { userId, scopes })
  return {
    access_token: accessToken,
    token_type: "Bearer",
    refresh_token: refreshToken,
    expires_in: accessTokenTtlSeconds,
    scope: scopes.join(" "),
  }
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return Buffer.from(digest).toString("base64url")
}

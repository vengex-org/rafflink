import { Hono } from "hono"
import { takeFailure, type FakeState } from "../state.ts"

/** Google access tokens last an hour; Google answers 3599. */
const accessTokenTtlSeconds = 3599

/** Google's OAuth 2.0 web flow: the consent page, the token endpoint and token info, PKCE S256 required here. */
export function oauthRoutes(state: FakeState): Hono {
  const app = new Hono()

  app.get("/o/oauth2/v2/auth", (c) => {
    const query = c.req.query()
    if (query.client_id !== state.options.clientId) return c.text("invalid_client", 401)
    const redirectUri = query.redirect_uri
    if (redirectUri === undefined || !URL.canParse(redirectUri)) {
      return c.text("redirect_uri_mismatch", 400)
    }
    if (query.response_type !== "code" || query.state === undefined || query.scope === undefined) {
      return c.text("invalid_request", 400)
    }
    if (query.code_challenge === undefined || query.code_challenge_method !== "S256") {
      return c.text("invalid_request", 400)
    }
    const code = crypto.randomUUID()
    state.codes.set(code, {
      channelId: state.signInChannelId,
      scopes: query.scope.split(" ").filter((scope) => scope !== ""),
      redirectUri,
      codeChallenge: query.code_challenge,
      offline:
        query.access_type === "offline" && (query.prompt ?? "").split(" ").includes("consent"),
    })
    const target = new URL(redirectUri)
    target.searchParams.set("code", code)
    target.searchParams.set("state", query.state)
    return c.redirect(target.toString(), 302)
  })

  app.post("/token", async (c) => {
    const failure = takeFailure(state, "token")
    if (failure !== undefined) return c.json({ error: failure.reason }, failure.status)
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
        return c.json({ error: "redirect_uri_mismatch" }, 400)
      }
      const verifier = form.get("code_verifier")
      if (verifier === null || (await challengeOf(verifier)) !== grant.codeChallenge) {
        return c.json({ error: "invalid_grant" }, 400)
      }
      const accessToken = issueAccessToken(state, grant.channelId, grant.scopes)
      if (!grant.offline) return c.json(tokenJson(accessToken, grant.scopes))
      const refreshToken = crypto.randomUUID()
      state.refreshTokens.set(refreshToken, { channelId: grant.channelId, scopes: grant.scopes })
      return c.json({ ...tokenJson(accessToken, grant.scopes), refresh_token: refreshToken })
    }
    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token")
      const grant = refreshToken === null ? undefined : state.refreshTokens.get(refreshToken)
      if (grant === undefined) return c.json({ error: "invalid_grant" }, 400)
      // Google keeps the refresh token and sends no new one.
      return c.json(tokenJson(issueAccessToken(state, grant.channelId, grant.scopes), grant.scopes))
    }
    return c.json({ error: "unsupported_grant_type" }, 400)
  })

  app.get("/tokeninfo", (c) => {
    const failure = takeFailure(state, "tokeninfo")
    if (failure !== undefined) return c.json({ error: failure.reason }, failure.status)
    const token = state.accessTokens.get(c.req.query("access_token") ?? "")
    if (token === undefined || token.revoked) return c.json({ error: "invalid_token" }, 400)
    return c.json({
      aud: state.options.clientId,
      azp: state.options.clientId,
      scope: token.scopes.join(" "),
      expires_in: accessTokenTtlSeconds,
    })
  })

  return app
}

function issueAccessToken(state: FakeState, channelId: string | null, scopes: string[]): string {
  const accessToken = crypto.randomUUID()
  state.accessTokens.set(accessToken, { channelId, scopes, revoked: false })
  return accessToken
}

function tokenJson(accessToken: string, scopes: string[]) {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: accessTokenTtlSeconds,
    scope: scopes.join(" "),
  }
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return Buffer.from(digest).toString("base64url")
}

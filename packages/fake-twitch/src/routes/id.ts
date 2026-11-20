import { Hono } from "hono"
import { bearerToken } from "../lib/auth.ts"
import { ACCESS_TOKEN_TTL_SECONDS, issueTokens, signIdToken } from "../lib/tokens.ts"
import { userPickerPage } from "../lib/user-picker.ts"
import { requireUser, takeFailure, type FakeState } from "../state.ts"

export function idRoutes(state: FakeState): Hono {
  const app = new Hono()

  app.get("/authorize", (c) => {
    const query = c.req.query()
    if (query.client_id !== state.options.clientId)
      return c.json({ status: 400, message: "invalid client" }, 400)
    if (query.response_type !== "code")
      return c.json({ status: 400, message: "invalid response_type" }, 400)
    const redirectUri = query.redirect_uri
    if (redirectUri === undefined || !URL.canParse(redirectUri)) {
      return c.json(
        { status: 400, message: "Parameter redirect_uri does not match registered URI" },
        400,
      )
    }
    const hint = query.login_hint
    if (hint !== undefined && !state.users.has(hint)) {
      return c.json({ status: 400, message: "login_hint names no known user" }, 400)
    }
    if (hint === undefined && state.options.userPicker === true) {
      return c.html(userPickerPage(state.users.values(), new URL(c.req.url)))
    }
    const code = crypto.randomUUID()
    state.codes.set(code, {
      userId: hint ?? state.signInUserId,
      scopes: (query.scope ?? "").split(" ").filter((scope) => scope !== ""),
      nonce: query.nonce,
      redirectUri,
    })
    const target = new URL(redirectUri)
    target.searchParams.set("code", code)
    if (query.state !== undefined) target.searchParams.set("state", query.state)
    return c.redirect(target.toString(), 302)
  })

  app.post("/token", async (c) => {
    const failure = takeFailure(state, "token")
    if (failure !== undefined) return c.body(null, failure)

    const form = new URLSearchParams(await c.req.text())
    if (form.get("client_id") !== state.options.clientId)
      return c.json({ status: 400, message: "invalid client" }, 400)
    if (form.get("client_secret") !== state.options.clientSecret) {
      return c.json({ status: 403, message: "invalid client secret" }, 403)
    }

    const grantType = form.get("grant_type")
    if (grantType === "authorization_code") {
      const code = form.get("code")
      const grant = code === null ? undefined : state.codes.get(code)
      if (code === null || grant === undefined) {
        return c.json({ status: 400, message: "Invalid authorization code" }, 400)
      }
      state.codes.delete(code)
      if (form.get("redirect_uri") !== grant.redirectUri) {
        return c.json(
          { status: 400, message: "Parameter redirect_uri does not match registered URI" },
          400,
        )
      }
      const tokens = issueTokens(state, grant.userId, grant.scopes)
      if (!grant.scopes.includes("openid")) return c.json(tokens)
      const idToken = await signIdToken(state, requireUser(state, grant.userId), grant.nonce)
      return c.json({ ...tokens, id_token: idToken })
    }

    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token")
      const grant = refreshToken === null ? undefined : state.refreshTokens.get(refreshToken)
      if (refreshToken === null || grant === undefined) {
        return c.json({ status: 400, message: "Invalid refresh token" }, 400)
      }
      state.refreshTokens.delete(refreshToken)
      return c.json(issueTokens(state, grant.userId, grant.scopes))
    }

    return c.json({ status: 400, message: "missing or unsupported grant_type" }, 400)
  })

  app.get("/keys", async (c) => c.json({ keys: [(await state.signingKey).jwk] }))

  app.get("/validate", (c) => {
    const accessToken = bearerToken(c.req.header("authorization"))
    const token = accessToken === undefined ? undefined : state.accessTokens.get(accessToken)
    if (token === undefined || token.revoked)
      return c.json({ status: 401, message: "invalid access token" }, 401)
    return c.json({
      client_id: state.options.clientId,
      login: requireUser(state, token.userId).login,
      scopes: token.scopes,
      user_id: token.userId,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    })
  })

  return app
}

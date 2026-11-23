import { beforeEach, describe, expect, it } from "bun:test"
import { createFakeKick, type FakeKick } from "../src/index.ts"

const viewer = { id: "301", name: "Viewer" }
const redirectUri = "http://localhost/callback"
const verifier = "v".repeat(43)

let fake: FakeKick

beforeEach(() => {
  fake = createFakeKick({ clientId: "c", clientSecret: "s", defaultUser: viewer })
})

async function challengeOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Buffer.from(digest).toString("base64url")
}

async function authorize(scope: string): Promise<string> {
  const query = new URLSearchParams({
    client_id: "c",
    response_type: "code",
    redirect_uri: redirectUri,
    state: "st",
    scope,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: "S256",
  })
  const response = await fake.app.request(`/oauth/authorize?${query}`)
  return new URL(response.headers.get("location") ?? "").searchParams.get("code") ?? ""
}

async function token(code: string, codeVerifier: string): Promise<Response> {
  return fake.app.request("/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: "c",
      client_secret: "s",
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    }),
  })
}

describe("fake Kick", () => {
  it("refuses an authorize request without an S256 challenge", async () => {
    const response = await fake.app.request(
      `/oauth/authorize?client_id=c&response_type=code&redirect_uri=${redirectUri}&state=s&scope=user:read`,
    )

    expect(response.status).toBe(400)
  })

  it("trades a code only for the verifier of its challenge", async () => {
    const wrong = await token(await authorize("user:read"), "w".repeat(43))
    const right = await token(await authorize("user:read"), verifier)

    expect(wrong.status).toBe(400)
    expect(right.status).toBe(200)
    expect(await right.json()).toMatchObject({ token_type: "Bearer", scope: "user:read" })
  })

  it("answers the token's own user and refuses a subscription without events:subscribe", async () => {
    const tokens: { access_token: string } = await (
      await token(await authorize("user:read"), verifier)
    ).json()
    const headers = { Authorization: `Bearer ${tokens.access_token}` }

    const users = await fake.app.request("/public/v1/users", { headers })
    const subscribe = await fake.app.request("/public/v1/events/subscriptions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        events: [{ name: "chat.message.sent", version: 1 }],
        method: "webhook",
      }),
    })

    expect(await users.json()).toMatchObject({ data: [{ user_id: 301, name: "Viewer" }] })
    expect(subscribe.status).toBe(403)
  })

  it("builds no webhook while no subscription covers the channel", async () => {
    fake.control.setWebhookUrl("http://localhost/api/kick/webhook")

    expect(await fake.control.chatWebhook(viewer.id, viewer.id, "hi")).toBeNull()
  })
})

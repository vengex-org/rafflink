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

  it("shows the user picker in dev and signs in the user its login_hint names", async () => {
    const streamer = { id: "300", name: "Streamer" }
    fake = createFakeKick({
      clientId: "c",
      clientSecret: "s",
      defaultUser: viewer,
      userPicker: true,
    })
    fake.control.addUser(streamer)
    const query = new URLSearchParams({
      client_id: "c",
      response_type: "code",
      redirect_uri: redirectUri,
      state: "st",
      scope: "user:read",
      code_challenge: await challengeOf(verifier),
      code_challenge_method: "S256",
    })

    const picker = await fake.app.request(`/oauth/authorize?${query}`)
    const unknown = await fake.app.request(`/oauth/authorize?${query}&login_hint=42`)
    const picked = await fake.app.request(`/oauth/authorize?${query}&login_hint=${streamer.id}`)
    const code = new URL(picked.headers.get("location") ?? "").searchParams.get("code") ?? ""
    const tokens: { access_token: string } = await (await token(code, verifier)).json()
    const users = await fake.app.request("/public/v1/users", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    expect(await picker.text()).toContain(`login_hint=${streamer.id}`)
    expect(unknown.status).toBe(400)
    expect(await users.json()).toMatchObject({ data: [{ user_id: 300, name: "Streamer" }] })
  })

  it("lists a channel's rewards only to its own token with channel:rewards:read", async () => {
    fake.control.setRewards(viewer.id, [{ id: "r1", title: "Enter", cost: 100, enabled: true }])
    const read = async (scope: string) => {
      const tokens: { access_token: string } = await (
        await token(await authorize(scope), verifier)
      ).json()
      return fake.app.request("/public/v1/channels/rewards", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
    }

    const without = await read("user:read")
    const granted = await read("user:read channel:rewards:read")

    expect(without.status).toBe(401)
    expect(await granted.json()).toMatchObject({
      data: [{ id: "r1", title: "Enter", cost: 100, is_enabled: true }],
    })
  })

  it("answers a refused event with its error and subscribes the others", async () => {
    const tokens: { access_token: string } = await (
      await token(await authorize("user:read events:subscribe"), verifier)
    ).json()
    fake.control.refuseEvent("channel.reward.redemption.updated", "not allowed")

    const response = await fake.app.request("/public/v1/events/subscriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      body: JSON.stringify({
        method: "webhook",
        events: [
          { name: "channel.subscription.new", version: 1 },
          { name: "channel.reward.redemption.updated", version: 1 },
        ],
      }),
    })

    expect(await response.json()).toMatchObject({
      data: [
        { name: "channel.subscription.new", error: null },
        { name: "channel.reward.redemption.updated", subscription_id: null, error: "not allowed" },
      ],
    })
    expect(fake.control.subscriptions().map((subscription) => subscription.event)).toEqual([
      "channel.subscription.new",
    ])
  })

  it("signs gift sub and redemption webhooks of a subscribed channel with their recipients", async () => {
    const tokens: { access_token: string } = await (
      await token(await authorize("user:read events:subscribe"), verifier)
    ).json()
    fake.control.addUser({ id: "302", name: "Second" })
    fake.control.setWebhookUrl("http://localhost/api/kick/webhook")
    await fake.app.request("/public/v1/events/subscriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      body: JSON.stringify({
        method: "webhook",
        events: [
          { name: "channel.subscription.gifts", version: 1 },
          { name: "channel.reward.redemption.updated", version: 1 },
        ],
      }),
    })

    const gifts = await fake.control.subscriptionWebhook(viewer.id, "gifts", ["302"])
    const redemption = await fake.control.redemptionWebhook(viewer.id, "302", "r1", "pending")
    const renewal = await fake.control.subscriptionWebhook(viewer.id, "renewal", ["302"])

    expect(gifts?.headers["Kick-Event-Type"]).toBe("channel.subscription.gifts")
    expect(JSON.parse(gifts?.body ?? "{}")).toMatchObject({
      giftees: [{ user_id: 302, username: "Second" }],
    })
    expect(JSON.parse(redemption?.body ?? "{}")).toMatchObject({
      status: "pending",
      reward: { id: "r1" },
      redeemer: { user_id: 302 },
    })
    expect(renewal).toBeNull()
  })
})

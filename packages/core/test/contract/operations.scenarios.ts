import { expect } from "bun:test"
import { users } from "./fake-twitch.ts"
import type { ContractContext } from "./target.ts"
import { defaultRules, publicOrigin, scenario } from "./world.ts"

const switchTo = (plan: string, origin = publicOrigin): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify({ plan }),
})

export function operationsScenarios(context: ContractContext): void {
  scenario(
    context,
    "an admin listed by channel link opens the admin page and another streamer does not",
    async (world) => {
      const target = await world.start({
        ADMIN_TWITCH_IDS: `https://twitch.tv/${users.streamer.login}`,
      })
      const admin = await world.signInStreamer(target, users.streamer.id)
      const other = await world.signInStreamer(target, users.otherStreamer.id)

      const allowed = await admin.request("/api/admin/usage")
      const refused = await other.request("/api/admin/usage")

      expect(allowed.status).toBe(200)
      expect(refused.status).toBe(403)
    },
  )

  scenario(
    context,
    "the admin page stays closed while Twitch cannot resolve the admin login and opens on the next request",
    async (world) => {
      const target = await world.start({ ADMIN_TWITCH_IDS: users.streamer.login })
      const admin = await world.signInStreamer(target, users.streamer.id)
      world.twitch.fake.control.failNext("token", 503, 1)

      const failed = await admin.request("/api/admin/usage")
      const retried = await admin.request("/api/admin/usage")

      expect(failed.status).toBe(403)
      expect(retried.status).toBe(200)
    },
  )

  scenario(
    context,
    "an admin switches the Cloudflare plan to Paid and another streamer cannot",
    async (world) => {
      const target = await world.start()
      const admin = await world.signInStreamer(target, users.streamer.id)
      const other = await world.signInStreamer(target, users.otherStreamer.id)

      const refused = await other.request("/api/admin/plan", switchTo("paid"))
      const foreign = await admin.request(
        "/api/admin/plan",
        switchTo("paid", "https://evil.example"),
      )
      const switched = await admin.request("/api/admin/plan", switchTo("paid"))
      const page = await (await admin.request("/api/admin/usage")).json()

      expect(refused.status).toBe(403)
      expect(foreign.status).toBe(403)
      if (context.plans === "switchable") {
        expect(switched.status).toBe(200)
        expect(page).toMatchObject({
          plan: { current: "paid", limits: { workerRequestsPerDay: null } },
        })
      } else {
        expect(switched.status).toBe(404)
        expect(page).toMatchObject({ plan: null })
      }
    },
  )

  scenario(
    context,
    "with signup closed a streamer creates giveaways only after an admin approves the account",
    async (world) => {
      const target = await world.start({ OPEN_SIGNUP: "false" })
      const admin = await world.signInStreamer(target, users.streamer.id)
      const other = await world.signInStreamer(target, users.otherStreamer.id)
      const input = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Giveaway", prize: "Prize", rules: defaultRules }),
      }
      const decide = (id: string, action: "approve" | "revoke") =>
        admin.request(`/api/admin/streamers/${id}/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: publicOrigin },
          body: "{}",
        })

      const refused = await other.request("/api/dash/giveaways", input)
      const adminCreated = await admin.request("/api/dash/giveaways", input)
      const listed: { pending: { streamers: { id: string; login: string }[] } } = await (
        await admin.request("/api/admin/streamers")
      ).json()
      const id = listed.pending.streamers[0]?.id ?? ""
      const approved = await decide(id, "approve")
      const created = await other.request("/api/dash/giveaways", input)
      const createdBody: { giveaway: { id: string } } = await created.json()
      const revoked = await decide(id, "revoke")
      const refusedAgain = await other.request("/api/dash/giveaways", input)
      const closed = await other.request(`/api/dash/giveaways/${createdBody.giveaway.id}/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })

      expect(refused.status).toBe(403)
      expect(await refused.json()).toEqual({ error: "streamer_not_approved" })
      expect(adminCreated.status).toBe(201)
      expect(listed.pending.streamers.map((streamer) => streamer.login)).toEqual([
        users.otherStreamer.login,
      ])
      expect(approved.status).toBe(200)
      expect(created.status).toBe(201)
      expect(revoked.status).toBe(200)
      expect(refusedAgain.status).toBe(403)
      expect(closed.status).toBe(200)
    },
  )

  scenario(
    context,
    "an admin reads the live statistics with an open giveaway, its viewer count and a referral source, and another streamer cannot",
    async (world) => {
      const target = await world.start()
      const created = await world.createGiveaway(target)
      await world.enter(target, created.code, users.viewer.id)
      const other = await world.signInStreamer(target, users.otherStreamer.id)

      const home = await fetch(new URL("/?ref=launch-post", target.url), {
        headers: { "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "203.0.113.5" },
      })
      const refused = await other.request("/api/admin/stats")
      const response = await created.streamer.request("/api/admin/stats")
      const stats = await response.json()

      expect(home.headers.get("set-cookie")).toBeNull()
      expect(refused.status).toBe(403)
      expect(response.status).toBe(200)
      expect(stats).toMatchObject({
        openGiveaways: 1,
        giveaways: [
          {
            code: created.code,
            counts: { entrants: 1, entriesLastMinute: 1, claimsLastMinute: 0, viewers: 0 },
          },
        ],
        entriesLastMinute: 1,
        queue: { queued: 0, rateLimited: 0, rateLimitedMinutes: [] },
        access: null,
        referrals: [{ ref: "launch-post", visits: 1 }],
      })
      expect(stats.series).toHaveLength(60)
      expect(stats.growth.at(-1)).toMatchObject({ giveaways: 1, streamers: 2 })
    },
  )

  // A deleted token is no longer refreshed or validated, so the second job run validates only the token
  // that was kept, with the access token the first run left in the process.
  scenario(
    context,
    "the hourly validation deletes a revoked streamer token and keeps the others",
    async (world) => {
      const target = await world.start()
      await world.signInStreamer(target, users.streamer.id)
      await world.signInStreamer(target, users.otherStreamer.id)
      world.twitch.fake.control.revokeUserTokens(users.streamer.id)

      await target.runValidateJob()
      const refreshesBefore = world.twitchCalls("/oauth2/token")
      const validationsBefore = world.twitchCalls("/oauth2/validate")
      await target.runValidateJob()

      expect(world.twitchCalls("/oauth2/token") - refreshesBefore).toBe(0)
      expect(world.twitchCalls("/oauth2/validate") - validationsBefore).toBe(1)
    },
  )
}

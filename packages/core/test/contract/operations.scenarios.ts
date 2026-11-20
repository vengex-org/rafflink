import { expect } from "bun:test"
import { users } from "./fake-twitch.ts"
import type { ContractContext } from "./target.ts"
import { scenario } from "./world.ts"

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

  // A deleted token is no longer refreshed or validated, so the second job run reaches Twitch only for
  // the token that was kept.
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

      expect(world.twitchCalls("/oauth2/token") - refreshesBefore).toBe(1)
      expect(world.twitchCalls("/oauth2/validate") - validationsBefore).toBe(1)
    },
  )
}

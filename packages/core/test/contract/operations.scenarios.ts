import { expect } from "bun:test"
import { users } from "./fake-twitch.ts"
import type { ContractContext } from "./target.ts"
import { scenario } from "./world.ts"

export function operationsScenarios(context: ContractContext): void {
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

import { openStreamerAccess, type StreamerTokenDeps } from "../accounts/streamer-token.ts"
import { providerFor, type PlatformProvider } from "../platform/provider.ts"

/** The streamer's token is gone: the sign-in was never stored, or the hourly validation deleted it. */
export class StreamerTokenMissing extends Error {}

/** The giveaway has no row in the account store. */
export class GiveawayMissing extends Error {}

export interface GiveawayStreamerAccess {
  readonly provider: PlatformProvider
  readonly accessToken: string
  readonly broadcasterId: string
}

// A refresh can replace the stored refresh token, so two refreshes at once from the same row can make the
// second fail: callers that overlap, such as the role refresh and the chat subscription right after the
// giveaway opens, share one refresh.
const inFlight = new Map<string, Promise<GiveawayStreamerAccess>>()

/** An access token of the giveaway's streamer, with the channel it is for and its platform's provider. */
export function openGiveawayStreamerAccess(
  deps: StreamerTokenDeps,
  giveawayId: string,
): Promise<GiveawayStreamerAccess> {
  const running = inFlight.get(giveawayId)
  if (running !== undefined) return running
  const access = readStreamerAccess(deps, giveawayId).finally(() => inFlight.delete(giveawayId))
  inFlight.set(giveawayId, access)
  return access
}

async function readStreamerAccess(
  deps: StreamerTokenDeps,
  giveawayId: string,
): Promise<GiveawayStreamerAccess> {
  const giveaway = await deps.accounts.findGiveawayById(giveawayId)
  if (giveaway === null) throw new GiveawayMissing()
  const token = await deps.accounts.findStreamerToken(giveaway.streamerId)
  if (token === null) throw new StreamerTokenMissing()
  return {
    provider: providerFor(deps.platforms, giveaway.platform),
    accessToken: await openStreamerAccess(deps, token),
    broadcasterId: giveaway.broadcasterId,
  }
}

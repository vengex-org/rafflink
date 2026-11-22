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
  /** The scopes the streamer granted, so a caller can skip a call the token may not make. */
  readonly scopes: readonly string[]
}

/** An access token of the giveaway's streamer, with the channel it is for and its platform's provider. */
export async function openGiveawayStreamerAccess(
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
    scopes: token.scopes,
  }
}

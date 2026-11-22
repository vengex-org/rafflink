import type { StreamerTokenDeps } from "../accounts/streamer-token.ts"
import { openGiveawayStreamerAccess } from "./streamer-access.ts"

/** Subscribes an EventSub session to the chat of the giveaway's channel, with the streamer's token. */
export async function subscribeChat(
  deps: StreamerTokenDeps,
  giveawayId: string,
  sessionId: string,
): Promise<void> {
  const { provider, accessToken, broadcasterId } = await openGiveawayStreamerAccess(
    deps,
    giveawayId,
  )
  await provider.subscribeChatMessages(accessToken, broadcasterId, sessionId)
}

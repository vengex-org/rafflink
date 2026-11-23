import type { StreamerTokenDeps } from "../accounts/streamer-token.ts"
import type { ChatOpener, ChatSource } from "../platform/chat-source.ts"
import { enabledProviderFor } from "../platform/provider.ts"
import type { SocketConnector } from "../ports.ts"
import { openGiveawayStreamerAccess } from "./streamer-access.ts"

/** Opens a giveaway room's chat through the provider of the room's platform, with the streamer's token. */
export function roomChat(
  deps: StreamerTokenDeps,
  connector: SocketConnector,
  giveawayId: string,
): ChatOpener {
  return (platform, listener) => {
    const provider = enabledProviderFor(deps.platforms, platform)
    if (provider === null) return silentChat
    return provider.chatSource({
      giveawayId,
      connector,
      clock: deps.clock,
      streamerAccess: () => openGiveawayStreamerAccess(deps, giveawayId),
    })(listener)
  }
}

// The chat of a room whose platform was switched off: it hears nothing and schedules nothing.
const silentChat: ChatSource = {
  open: () => {},
  close: () => {},
  wakeAt: () => null,
  onAlarm: () => {},
}

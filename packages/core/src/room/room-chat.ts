import type { StreamerTokenDeps } from "../accounts/streamer-token.ts"
import type { ChatOpener } from "../platform/chat-source.ts"
import { providerFor } from "../platform/provider.ts"
import type { SocketConnector } from "../ports.ts"
import { openGiveawayStreamerAccess } from "./streamer-access.ts"

/** Opens a giveaway room's chat through the provider of the room's platform, with the streamer's token. */
export function roomChat(
  deps: StreamerTokenDeps,
  connector: SocketConnector,
  giveawayId: string,
): ChatOpener {
  return (platform, listener) =>
    providerFor(deps.platforms, platform).chatSource({
      giveawayId,
      connector,
      clock: deps.clock,
      streamerAccess: () => openGiveawayStreamerAccess(deps, giveawayId),
    })(listener)
}

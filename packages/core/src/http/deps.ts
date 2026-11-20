import type { AccountStore } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import type { KeyRing } from "../lib/seal.ts"
import type { Clock, Random, UsageMeter } from "../ports.ts"
import type { TokenQueueStub } from "../queue/token-queue.ts"
import type { RoomDirectory } from "../room/room-directory.ts"
import type { TwitchClient } from "../twitch/twitch-client.ts"

export interface AppDeps {
  readonly config: ResolvedConfig
  readonly clock: Clock
  readonly random: Random
  readonly twitch: TwitchClient
  readonly accounts: AccountStore
  readonly rooms: RoomDirectory
  readonly queue: TokenQueueStub
  readonly usage: UsageMeter
  readonly keyRing: KeyRing
}

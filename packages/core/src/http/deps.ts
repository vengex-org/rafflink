import type { AdminDirectory } from "../admin/admin-directory.ts"
import type { AccountStore } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import type { KeyRing } from "../lib/seal.ts"
import type { Clock, PublicCache, RateLimiter, Random, UsageMeter } from "../ports.ts"
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
  readonly publicCache: PublicCache
  readonly keyRing: KeyRing
  readonly admins: AdminDirectory
  readonly entryUserLimiter: RateLimiter
  readonly entryIpLimiter: RateLimiter
  /** The address of the client behind a request as this target's edge reports it, or null when it reports none. */
  readonly clientAddress: (request: Request) => string | null
}

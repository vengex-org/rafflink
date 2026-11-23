import type { AdminDirectory } from "../admin/admin-directory.ts"
import type { AccountStore } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import type { KeyRing } from "../lib/seal.ts"
import type { PlanQueue } from "../plan/current-plan.ts"
import type { PlatformProviders } from "../platform/provider.ts"
import type { Clock, PublicCache, RateLimiter, Random, ReportError, UsageMeter } from "../ports.ts"
import type { StatsStore } from "../stats/stats-store.ts"
import type { TokenQueueStub } from "../queue/token-queue.ts"
import type { RoomDirectory } from "../room/room-directory.ts"
import type { YouTubeQuota } from "../youtube/quota.ts"

export interface AppDeps {
  readonly config: ResolvedConfig
  readonly clock: Clock
  readonly random: Random
  readonly platforms: PlatformProviders
  readonly accounts: AccountStore
  readonly rooms: RoomDirectory
  readonly queue: TokenQueueStub
  readonly stats: StatsStore
  readonly usage: UsageMeter
  /**
   * The token queue a Cloudflare plan switch reaches; null on a target without a Cloudflare plan (the Bun
   * server), where the admin page shows no plan and the switch answers 404.
   */
  readonly planQueue: PlanQueue | null
  /** Today's YouTube units; null on an install without a Google client. */
  readonly youtubeQuota: YouTubeQuota | null
  readonly publicCache: PublicCache
  readonly keyRing: KeyRing
  readonly admins: AdminDirectory
  readonly entryUserLimiter: RateLimiter
  readonly entryIpLimiter: RateLimiter
  readonly leavesIpLimiter: RateLimiter
  readonly moderatorIpLimiter: RateLimiter
  /** The address of the client behind a request as this target's edge reports it, or null when it reports none. */
  readonly clientAddress: (request: Request) => string | null
  /** Where a request that failed is reported, beside the log. */
  readonly reportError: ReportError
}

import { setTimeout } from "node:timers/promises"
import type { Giveaway, StoredStreamerToken } from "../accounts/account-store.ts"
import { openStreamerAccess, type StreamerTokenDeps } from "../accounts/streamer-token.ts"
import type { ResolvedConfig } from "../config.ts"
import { errorClass } from "../lib/error-class.ts"
import { accountAgeDays as ageInDays } from "../domain/rules.ts"
import { followMatters, tierMatters } from "../domain/streamer-features.ts"
import { jitteredDelay } from "../lib/jittered-delay.ts"
import type { RateLimiter } from "../ports.ts"
import type { QueuedCode } from "../queue/token-queue.ts"
import type { EnterOutcome, EntryExpectation, RoomViewer } from "../room/giveaway-room.ts"
import { sendMissingExclusions, type ExclusionTarget } from "../room/room-exclusions.ts"
import { RoomTransientError, type RoomDirectory } from "../room/room-directory.ts"
import { StreamerTokenMissing } from "../room/streamer-access.ts"
import {
  enabledProviderFor,
  type ExchangedCode,
  type PlatformProvider,
} from "../platform/provider.ts"
import {
  PlatformError,
  PlatformIdentityRejected,
  PlatformRateLimited,
  PlatformUnavailable,
} from "../platform/errors.ts"
import { callbackPath, redirectUri } from "../platform/redirect.ts"
import type { EntryAttempt, FinalOutcome } from "./outcome.ts"

export type EntryConfig = Pick<
  ResolvedConfig,
  | "entryWriteRetryDelaysMs"
  | "entryWriteJitterPercent"
  | "publicUrl"
  | "recentWinnersGiveawaysMax"
  | "blockListPushMax"
>

/** The streamer's token reads the follow and the tier of a viewer, so the viewer grants no scope for them. */
export interface EntryDeps extends StreamerTokenDeps {
  readonly config: EntryConfig
  readonly rooms: RoomDirectory
  /** Limits verified sign-ins per platform user, so a viewer's retries cannot flood the room; it runs after the code exchange and the identity check, so those platform calls are not saved. */
  readonly entryUserLimiter: RateLimiter
}

/** The giveaway fields the routine needs; the sign-in callback has already loaded the giveaway. */
export type EntryTarget = Pick<
  Giveaway,
  "id" | "broadcasterId" | "blockListVersion" | "streamerId" | "rules"
>
  & ExclusionTarget

/**
 * Steps 2 to 5 of the viewer flow: exchange the code, verify who signed in, read eligibility, write the
 * entry. Only a failed exchange is `deferred`: a code is single use, so after it succeeded a platform
 * failure ends in `try-again` and the viewer signs in anew.
 */
export async function enterGiveaway(
  deps: EntryDeps,
  target: EntryTarget,
  item: Pick<QueuedCode, "code" | "nonce" | "codeVerifier">,
): Promise<EntryAttempt> {
  // A code queued before its platform was switched off can enter nobody, as after the close.
  const provider = enabledProviderFor(deps.platforms, target.platform)
  if (provider === null) return final({ kind: "closed" }, null)
  let tokens: ExchangedCode
  try {
    tokens = await provider.exchangeCode(
      item.code,
      redirectUri(deps.config, callbackPath(provider.platform, "viewer")),
      item.codeVerifier,
    )
  } catch (error) {
    if (error instanceof PlatformRateLimited) return { kind: "deferred", cause: "rate-limited" }
    if (error instanceof PlatformUnavailable) return { kind: "deferred", cause: "unavailable" }
    return platformFailure(error, null)
  }

  let userId: string
  try {
    userId = await provider.verifySignIn(tokens, { nonce: item.nonce })
  } catch (error) {
    return platformFailure(error, null)
  }
  if (!(await deps.entryUserLimiter.allow(`${target.platform}:${userId}`))) {
    return final({ kind: "rate-limited" }, userId)
  }

  let viewer: RoomViewer
  try {
    viewer = await readViewer(deps, provider, target, tokens.accessToken, userId)
  } catch (error) {
    return platformFailure(error, userId)
  }
  const outcome = await enterWithExclusions(deps, target, viewer)
  return final(outcome, userId)
}

/** The queue's entry point: loads the giveaway the queued code belongs to, then runs {@link enterGiveaway}. */
export async function enterQueuedCode(deps: EntryDeps, item: QueuedCode): Promise<EntryAttempt> {
  const giveaway = await deps.accounts.findGiveawayById(item.giveawayId)
  if (giveaway === null) return final({ kind: "closed" }, null)
  return enterGiveaway(deps, giveaway, item)
}

function final(outcome: FinalOutcome, userId: string | null): EntryAttempt {
  return { kind: "final", outcome, userId }
}

// A platform call that gave no usable answer after the code was spent; anything else is a bug and propagates.
function platformFailure(error: unknown, userId: string | null): EntryAttempt {
  if (error instanceof PlatformIdentityRejected) return final({ kind: "invalid-state" }, userId)
  if (error instanceof PlatformError || error instanceof StreamerTokenMissing) {
    return final({ kind: "try-again" }, userId)
  }
  throw error
}

async function readViewer(
  deps: EntryDeps,
  provider: PlatformProvider,
  target: EntryTarget,
  accessToken: string,
  userId: string,
): Promise<RoomViewer> {
  const profile = await provider.userProfile(accessToken)
  const accountAgeDays = ageInDays(deps.clock.now(), profile.createdAt)
  const identity = {
    platformUserId: userId,
    login: profile.login,
    displayName: profile.displayName,
    profileImageUrl: profile.profileImageUrl,
  }
  const followRead = followMatters(target.rules)
  const tierRead = tierMatters(target.rules)
  // The broadcaster is refused by the room whatever the platform says, so their follow and sub are not asked;
  // a follow or tier the rules do not weigh is not asked either.
  if (userId === target.broadcasterId || (!followRead && !tierRead)) {
    return { ...identity, isFollower: false, subTier: null, accountAgeDays }
  }
  // A giveaway that weighs them is made only with the followers and subscribers scopes on this token.
  const streamerToken = await openStreamerAccess(deps, await storedStreamerToken(deps, target))
  const [isFollower, tiers] = await Promise.all([
    followRead
      ? provider.channelFollower(streamerToken, target.broadcasterId, userId)
      : Promise.resolve(false),
    tierRead
      ? provider.subscriberTiers(streamerToken, target.broadcasterId, [userId])
      : Promise.resolve(new Map()),
  ])
  return { ...identity, isFollower, subTier: tiers.get(userId) ?? null, accountAgeDays }
}

// The hourly validation deletes a revoked token; until the streamer signs in again nobody's follow or tier can be read.
async function storedStreamerToken(
  deps: EntryDeps,
  target: EntryTarget,
): Promise<StoredStreamerToken> {
  const token = await deps.accounts.findStreamerToken(target.streamerId)
  if (token === null) throw new StreamerTokenMissing()
  return token
}

// A room that cannot check the entry yet is sent what it misses, once; a room still unable after that
// gives the viewer a "try again", because letting the entry in could admit an account it keeps out.
async function enterWithExclusions(
  deps: EntryDeps,
  target: EntryTarget,
  viewer: RoomViewer,
): Promise<FinalOutcome> {
  const expected = { blockListVersion: target.blockListVersion }
  const first = await enterWithRetry(deps, target.id, viewer, expected)
  if (first.kind !== "unavailable") return first
  // Every failure here leaves the room refusing and nothing written, so whatever failed, the viewer tries again.
  try {
    await sendMissingExclusions(deps, deps.rooms.get(target.id), target, first.missing)
  } catch (error) {
    console.warn("room exclusions failed", {
      giveawayId: target.id,
      missing: first.missing,
      errorClass: errorClass(error),
    })
    return { kind: "try-again" }
  }
  const second = await enterWithRetry(deps, target.id, viewer, expected)
  if (second.kind !== "unavailable") return second
  console.warn("room exclusions still missing", { giveawayId: target.id, missing: second.missing })
  return { kind: "try-again" }
}

// Retries the room write only while it fails transiently, then gives the viewer a "try again".
async function enterWithRetry(
  deps: EntryDeps,
  giveawayId: string,
  viewer: RoomViewer,
  expected: EntryExpectation,
): Promise<EnterOutcome | { readonly kind: "try-again" }> {
  const room = deps.rooms.get(giveawayId)
  const delays = deps.config.entryWriteRetryDelaysMs
  for (let attempt = 0; ; attempt++) {
    try {
      return await room.enter(viewer, expected)
    } catch (error) {
      if (!(error instanceof RoomTransientError)) throw error
      const delay = delays[attempt]
      if (delay === undefined) {
        console.warn("room write retries exhausted", { giveawayId, attempts: attempt + 1 })
        return { kind: "try-again" }
      }
      await setTimeout(jitteredDelay(deps.random, deps.config.entryWriteJitterPercent, delay))
    }
  }
}

import { setTimeout } from "node:timers/promises"
import type { AccountStore, Giveaway } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import { errorClass } from "../lib/error-class.ts"
import { accountAgeDays as ageInDays } from "../domain/rules.ts"
import { jitteredDelay } from "../lib/jittered-delay.ts"
import type { Clock, RateLimiter, Random } from "../ports.ts"
import type { QueuedCode } from "../queue/token-queue.ts"
import type { EnterOutcome, EntryExpectation, RoomViewer } from "../room/giveaway-room.ts"
import { sendMissingExclusions, type ExclusionTarget } from "../room/room-exclusions.ts"
import { RoomTransientError, type RoomDirectory } from "../room/room-directory.ts"
import {
  providerFor,
  type ExchangedCode,
  type PlatformProvider,
  type PlatformProviders,
  type SubscriptionGroup,
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

export interface EntryDeps {
  readonly config: EntryConfig
  readonly clock: Clock
  readonly random: Random
  readonly platforms: PlatformProviders
  readonly accounts: AccountStore
  readonly rooms: RoomDirectory
  /** Limits verified sign-ins per platform user, so a viewer's retries cannot flood the room; it runs after the code exchange and the identity check, so those platform calls are not saved. */
  readonly entryUserLimiter: RateLimiter
}

/** The giveaway fields the routine needs; the sign-in callback has already loaded the giveaway. */
export type EntryTarget = Pick<Giveaway, "id" | "broadcasterId" | "blockListVersion">
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
  const provider = providerFor(deps.platforms, target.platform)
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
    viewer = await readViewer(deps.clock, provider, target, tokens.accessToken, userId)
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

const tierNumbers: Readonly<Record<SubscriptionGroup, 1 | 2 | 3>> = {
  sub_t1: 1,
  sub_t2: 2,
  sub_t3: 3,
}

function final(outcome: FinalOutcome, userId: string | null): EntryAttempt {
  return { kind: "final", outcome, userId }
}

// A platform call that gave no usable answer after the code was spent; anything else is a bug and propagates.
function platformFailure(error: unknown, userId: string | null): EntryAttempt {
  if (error instanceof PlatformIdentityRejected) return final({ kind: "invalid-state" }, userId)
  if (error instanceof PlatformError) return final({ kind: "try-again" }, userId)
  throw error
}

async function readViewer(
  clock: Clock,
  provider: PlatformProvider,
  target: EntryTarget,
  accessToken: string,
  userId: string,
): Promise<RoomViewer> {
  const profile = await provider.userProfile(accessToken)
  const accountAgeDays = ageInDays(clock.now(), profile.createdAt)
  const identity = {
    platformUserId: userId,
    login: profile.login,
    displayName: profile.displayName,
    profileImageUrl: profile.profileImageUrl,
  }
  // The broadcaster is refused by the room whatever the platform says, so their follow and sub are not asked.
  if (userId === target.broadcasterId) {
    return { ...identity, isFollower: false, subTier: null, accountAgeDays }
  }
  const [isFollower, tier] = await Promise.all([
    provider.follows(accessToken, target.broadcasterId, userId),
    provider.subscriptionTier(accessToken, target.broadcasterId, userId),
  ])
  return {
    ...identity,
    isFollower,
    subTier: tier === null ? null : tierNumbers[tier],
    accountAgeDays,
  }
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

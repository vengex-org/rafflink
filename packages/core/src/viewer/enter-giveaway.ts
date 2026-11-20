import { setTimeout } from "node:timers/promises"
import type { AccountStore, Giveaway } from "../accounts/account-store.ts"
import type { ResolvedConfig } from "../config.ts"
import type { Clock, Random } from "../ports.ts"
import type { QueuedCode } from "../queue/token-queue.ts"
import type { RoomViewer } from "../room/giveaway-room.ts"
import { RoomTransientError, type RoomDirectory } from "../room/room-directory.ts"
import { redirectUri, viewerCallbackPath } from "../twitch/redirect.ts"
import {
  TwitchInvalid,
  TwitchRateLimited,
  TwitchUnavailable,
  type ExchangedCode,
  type SubscriptionGroup,
  type TwitchClient,
  type VerifiedIdToken,
} from "../twitch/twitch-client.ts"
import type { EntryAttempt, FinalOutcome } from "./outcome.ts"

export type EntryConfig = Pick<
  ResolvedConfig,
  "entryWriteRetryDelaysMs" | "entryWriteJitterPercent" | "publicUrl"
>

export interface EntryDeps {
  readonly config: EntryConfig
  readonly clock: Clock
  readonly random: Random
  readonly twitch: TwitchClient
  readonly accounts: AccountStore
  readonly rooms: RoomDirectory
}

/** The giveaway fields the routine needs; the sign-in callback has already loaded the giveaway. */
export type EntryTarget = Pick<Giveaway, "id" | "broadcasterId">

/**
 * Steps 2 to 5 of the viewer flow: exchange the code, verify the id_token, read eligibility, write the
 * entry. Only a failed exchange is `deferred`: a code is single use, so after it succeeded a Twitch
 * failure ends in `try-again` and the viewer signs in anew.
 */
export async function enterGiveaway(
  deps: EntryDeps,
  target: EntryTarget,
  item: Pick<QueuedCode, "code" | "nonce">,
): Promise<EntryAttempt> {
  let tokens: ExchangedCode
  try {
    tokens = await deps.twitch.exchangeCode(item.code, redirectUri(deps.config, viewerCallbackPath))
  } catch (error) {
    if (error instanceof TwitchRateLimited) return { kind: "deferred", cause: "rate-limited" }
    if (error instanceof TwitchUnavailable) return { kind: "deferred", cause: "unavailable" }
    return twitchFailure(error, null)
  }
  if (tokens.idToken === null) return final({ kind: "invalid-state" }, null)

  let verified: VerifiedIdToken
  try {
    verified = await deps.twitch.verifyIdToken(tokens.idToken, item.nonce)
  } catch (error) {
    return twitchFailure(error, null)
  }
  const { userId } = verified

  let viewer: RoomViewer
  try {
    viewer = await readViewer(deps, target, tokens.accessToken, userId)
  } catch (error) {
    return twitchFailure(error, userId)
  }
  const outcome = await enterWithRetry(deps, target.id, viewer)
  return final(outcome, userId)
}

/** The queue's entry point: loads the giveaway the queued code belongs to, then runs {@link enterGiveaway}. */
export async function enterQueuedCode(deps: EntryDeps, item: QueuedCode): Promise<EntryAttempt> {
  const giveaway = await deps.accounts.findGiveawayById(item.giveawayId)
  if (giveaway === null) return final({ kind: "closed" }, null)
  return enterGiveaway(deps, giveaway, item)
}

const msPerDay = 86_400_000

const tierNumbers: Readonly<Record<SubscriptionGroup, 1 | 2 | 3>> = {
  sub_t1: 1,
  sub_t2: 2,
  sub_t3: 3,
}

function final(outcome: FinalOutcome, userId: string | null): EntryAttempt {
  return { kind: "final", outcome, userId }
}

// A Twitch call that gave no usable answer after the code was spent; anything else is a bug and propagates.
function twitchFailure(error: unknown, userId: string | null): EntryAttempt {
  if (error instanceof TwitchInvalid && error.endpoint === "id-token") {
    return final({ kind: "invalid-state" }, userId)
  }
  if (
    error instanceof TwitchInvalid
    || error instanceof TwitchRateLimited
    || error instanceof TwitchUnavailable
  ) {
    return final({ kind: "try-again" }, userId)
  }
  throw error
}

async function readViewer(
  deps: EntryDeps,
  target: EntryTarget,
  accessToken: string,
  userId: string,
): Promise<RoomViewer> {
  const profile = await deps.twitch.userProfile(accessToken)
  const accountAgeDays = Math.max(0, Math.floor((deps.clock.now() - profile.createdAt) / msPerDay))
  const identity = {
    platformUserId: userId,
    login: profile.login,
    displayName: profile.displayName,
  }
  // The broadcaster is refused by the room whatever Twitch says, so their follow and sub are not asked.
  if (userId === target.broadcasterId) {
    return { ...identity, isFollower: false, subTier: null, accountAgeDays }
  }
  const [isFollower, tier] = await Promise.all([
    deps.twitch.follows(accessToken, target.broadcasterId, userId),
    deps.twitch.subscriptionTier(accessToken, target.broadcasterId, userId),
  ])
  return {
    ...identity,
    isFollower,
    subTier: tier === null ? null : tierNumbers[tier],
    accountAgeDays,
  }
}

// Retries the room write only while it fails transiently, then gives the viewer a "try again".
async function enterWithRetry(
  deps: EntryDeps,
  giveawayId: string,
  viewer: RoomViewer,
): Promise<FinalOutcome> {
  const room = deps.rooms.get(giveawayId)
  const delays = deps.config.entryWriteRetryDelaysMs
  for (let attempt = 0; ; attempt++) {
    try {
      return await room.enter(viewer)
    } catch (error) {
      if (!(error instanceof RoomTransientError)) throw error
      const delay = delays[attempt]
      if (delay === undefined) {
        console.warn("room write retries exhausted", { giveawayId, attempts: attempt + 1 })
        return { kind: "try-again" }
      }
      await setTimeout(jittered(deps, delay))
    }
  }
}

function jittered(deps: EntryDeps, delayMs: number): number {
  const unit = (deps.random.bytes(1)[0] ?? 0) / 255
  const spread = (unit * 2 - 1) * (deps.config.entryWriteJitterPercent / 100)
  return Math.round(delayMs * (1 + spread))
}

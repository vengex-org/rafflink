import { useCallback, useMemo } from "react"
import { useParams, useSearchParams } from "react-router"
import { groups } from "@rafflink/core/domain/groups"
import { claimPrize, entryFromQuery, getGiveaway, type GiveawayView } from "../api/client.ts"
import { Failed, Loading, NotFound, Status } from "../components/notice.tsx"
import { groupLabel, reasonText, statusLabel, viewerClaimText } from "../lib/messages.ts"
import type { PollTiming } from "../lib/poll-timing.ts"
import { useAction } from "../lib/use-action.ts"
import { useEntryResult, type EntryView } from "../lib/use-entry-result.ts"
import { useLoad } from "../lib/use-load.ts"
import { formatClock, useRemainingMs } from "../lib/use-remaining.ts"

export function GiveawayPage({ poll }: { readonly poll: PollTiming }) {
  const { code } = useParams()
  return code === undefined ? (
    <NotFound title="Giveaway not found" />
  ) : (
    <Loaded code={code} poll={poll} />
  )
}

function Loaded({ code, poll }: { readonly code: string; readonly poll: PollTiming }) {
  const load = useCallback(() => getGiveaway(code), [code])
  const { result } = useLoad(load)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "ready":
      return result.value === null ? (
        <NotFound title="Giveaway not found" />
      ) : (
        <GiveawayDetails code={code} giveaway={result.value} poll={poll} />
      )
  }
}

function GiveawayDetails({
  code,
  giveaway,
  poll,
}: {
  readonly code: string
  readonly giveaway: GiveawayView
  readonly poll: PollTiming
}) {
  const [query] = useSearchParams()
  const initial = useMemo(() => entryFromQuery(query), [query])
  const entry = useEntryResult(code, initial, poll)
  const signInHref = `/auth/twitch/viewer/start?giveaway=${encodeURIComponent(code)}`

  return (
    <article>
      <h1>{giveaway.title}</h1>
      <p className="prize">{giveaway.prize}</p>
      <p>{statusLabel[giveaway.status]}</p>
      <p>{giveaway.entrantCount} entered so far</p>
      <section aria-live="polite" className="outcome">
        {giveaway.win === null ? (
          <EntryPanel entry={entry} status={giveaway.status} signInHref={signInHref} />
        ) : (
          <ClaimPanel code={code} win={giveaway.win} />
        )}
      </section>
      <Rules giveaway={giveaway} />
    </article>
  )
}

function EntryPanel({
  entry,
  status,
  signInHref,
}: {
  readonly entry: EntryView | null
  readonly status: GiveawayView["status"]
  readonly signInHref: string
}) {
  const message = entry === null ? null : entryMessage(entry)
  const canEnter = status === "open" && (message === null || message.retry)
  return (
    <>
      {message === null ? (
        <StatusNote status={status} />
      ) : (
        <>
          <h2>{message.title}</h2>
          <p>{message.detail}</p>
        </>
      )}
      {canEnter ? (
        <a className="button" href={signInHref}>
          Enter with Twitch
        </a>
      ) : null}
      {message === null && status === "drawn" ? (
        <a className="button" href={signInHref}>
          Sign in with Twitch
        </a>
      ) : null}
    </>
  )
}

function StatusNote({ status }: { readonly status: GiveawayView["status"] }) {
  switch (status) {
    case "open":
      return null
    case "closed":
      return <p>Sorry, giveaway closed.</p>
    case "drawn":
      return <p>The winners are drawn. Sign in to see whether you won.</p>
  }
}

interface EntryMessage {
  readonly title: string
  readonly detail: string
  /** Whether another sign-in can still change the outcome. */
  readonly retry: boolean
}

function entryMessage(entry: EntryView): EntryMessage {
  switch (entry.kind) {
    case "entered":
      return { title: "You are in", detail: "Good luck.", retry: false }
    case "already-in":
      return { title: "You are in", detail: "Your first entry is kept.", retry: false }
    case "pending":
      return {
        title: "You are being entered",
        detail: "Twitch is busy. This page updates by itself.",
        retry: false,
      }
    case "not-eligible":
      return { title: "You cannot enter", detail: reasonText[entry.reason], retry: false }
    case "closed":
      return {
        title: "Sorry, giveaway closed.",
        detail: "No more entries are accepted.",
        retry: false,
      }
    case "dropped":
      return { title: "Your entry took too long", detail: "Please try again.", retry: true }
    case "timed-out":
      return { title: "This is taking too long", detail: "Please try again.", retry: true }
    case "try-again":
      return { title: "Try again", detail: "Twitch did not answer in time.", retry: true }
    case "invalid-state":
      return { title: "Sign-in expired", detail: "Please try again.", retry: true }
  }
}

// The countdown is a timer role without a live region: announcing every second would drown the outcome.
function ClaimPanel({
  code,
  win,
}: {
  readonly code: string
  readonly win: NonNullable<GiveawayView["win"]>
}) {
  const remaining = useRemainingMs(win.claimUntil)
  const { message, busy, run } = useAction()

  if (win.claim.state === "rerolled") return <p>{viewerClaimText.rerolled}</p>
  const claimed = win.claim.state === "claimed" || message === viewerClaimText.claimed
  return (
    <>
      <h2>You won</h2>
      {claimed ? (
        <p>{viewerClaimText.claimed}</p>
      ) : win.claim.state === "expired" || remaining === 0 ? (
        <p>{viewerClaimText.expired}</p>
      ) : (
        <>
          <p>
            Time left to claim: <span role="timer">{formatClock(remaining)}</span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => claimPrize(code), viewerClaimText)}
          >
            Claim
          </button>
          {message === null ? null : <Status>{message}</Status>}
        </>
      )}
    </>
  )
}

function Rules({ giveaway }: { readonly giveaway: GiveawayView }) {
  const { rules } = giveaway
  return (
    <section aria-labelledby="rules">
      <h2 id="rules">Rules</h2>
      <ul>
        {groups.map((group) => (
          <li key={group}>
            {groupLabel[group]}: {ticketText(rules.tickets[group])}
          </li>
        ))}
      </ul>
      <ul>
        {rules.subsOnly ? <li>Subscribers only</li> : null}
        {rules.followersOnly ? <li>Followers only</li> : null}
        {rules.minAccountAgeDays === null ? null : (
          <li>Account at least {rules.minAccountAgeDays} days old</li>
        )}
        {giveaway.closesAt === null ? null : (
          <li>Entries end {new Date(giveaway.closesAt).toLocaleString()}</li>
        )}
        <li>Winners have {formatClock(giveaway.claimSeconds * 1000)} to claim</li>
        <li>
          {rules.claimKeyword === null
            ? "Any chat message from a winner claims the prize, or use the Claim button here"
            : `Claim by typing "${rules.claimKeyword}" in chat, or use the Claim button here`}
        </li>
      </ul>
    </section>
  )
}

function ticketText(count: number): string {
  if (count === 0) return "cannot enter"
  return `${count} ${count === 1 ? "ticket" : "tickets"}`
}

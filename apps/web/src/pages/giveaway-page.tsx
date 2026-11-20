import { useCallback, useMemo, useState, type ReactNode } from "react"
import { useParams, useSearchParams } from "react-router"
import { groups } from "@rafflink/core/domain/groups"
import { claimPrize, entryFromQuery, getGiveaway, type GiveawayView } from "../api/client.ts"
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  GiftIcon,
  LockIcon,
  TrophyIcon,
  UsersIcon,
} from "../components/icons.tsx"
import { Failed, Loading, NotFound, Status } from "../components/notice.tsx"
import { StateCard, type Tone } from "../components/state-card.tsx"
import { StepIndicator } from "../components/step-indicator.tsx"
import {
  giveawayName,
  groupLabel,
  reasonHelp,
  reasonText,
  viewerClaimText,
} from "../lib/messages.ts"
import {
  claimTimeText,
  extraTicketsText,
  peopleText,
  ticketText,
  waitText,
  whoCanEnterText,
} from "../lib/rules-text.ts"
import { useAction } from "../lib/use-action.ts"
import { useEntryResult, type EntryView } from "../lib/use-entry-result.ts"
import { useLoad } from "../lib/use-load.ts"
import { formatClock, formatLeft, useRemainingMs } from "../lib/use-remaining.ts"

const stepNames = ["Sign in", "Get your ticket"] as const

export function GiveawayPage() {
  const { code } = useParams()
  return code === undefined ? <NotFound title="Giveaway not found" /> : <Loaded code={code} />
}

function Loaded({ code }: { readonly code: string }) {
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
        <GiveawayDetails code={code} giveaway={result.value} />
      )
  }
}

function GiveawayDetails({
  code,
  giveaway,
}: {
  readonly code: string
  readonly giveaway: GiveawayView
}) {
  const [query] = useSearchParams()
  const initial = useMemo(() => entryFromQuery(query), [query])
  const entry = useEntryResult(code, initial, giveaway.poll)
  const signInHref = `/auth/twitch/viewer/start?giveaway=${encodeURIComponent(code)}`
  const extraTickets = extraTicketsText(giveaway.rules.tickets)

  return (
    <article>
      <header className="card hero">
        {giveaway.prize === null ? null : (
          <p className="eyebrow">{giveawayName(giveaway.title, code)}</p>
        )}
        <h1>{giveaway.prize ?? giveawayName(giveaway.title, code)}</h1>
        <ul className="facts">
          <li>
            <UsersIcon />
            {peopleText(giveaway.entrantCount)}
          </li>
          <li>
            <ClockIcon />
            <EntriesEnd status={giveaway.status} closesAt={giveaway.closesAt} />
          </li>
          <li>
            <GiftIcon />
            <span>
              {whoCanEnterText(giveaway.rules.subsOnly, giveaway.rules.followersOnly)}
              {extraTickets === null ? null : ` ${extraTickets}`}
            </span>
          </li>
        </ul>
      </header>
      <div aria-live="polite" className="outcome">
        {giveaway.win === null ? (
          <EntryPanel entry={entry} giveaway={giveaway} signInHref={signInHref} />
        ) : (
          <ClaimPanel code={code} win={giveaway.win} keyword={giveaway.rules.claimKeyword} />
        )}
      </div>
      <Rules giveaway={giveaway} />
    </article>
  )
}

function EntriesEnd({
  status,
  closesAt,
}: {
  readonly status: GiveawayView["status"]
  readonly closesAt: number | null
}) {
  if (status !== "open") return <span>Entries are closed.</span>
  if (closesAt === null) return <span>Entries stay open until the streamer closes them.</span>
  return <CountdownToClose closesAt={closesAt} />
}

function CountdownToClose({ closesAt }: { readonly closesAt: number }) {
  const [initial] = useState(() => Math.max(0, closesAt - Date.now()))
  const remaining = useRemainingMs(initial)
  return (
    <span>
      {remaining === 0
        ? "Entries are about to close."
        : `Entries close in ${formatLeft(remaining)}.`}
    </span>
  )
}

function EntryPanel({
  entry,
  giveaway,
  signInHref,
}: {
  readonly entry: EntryView | null
  readonly giveaway: GiveawayView
  readonly signInHref: string
}) {
  const { status } = giveaway
  const card = entry === null ? null : entryCard(entry, giveaway)
  const canEnter = status === "open" && (card === null || card.retry)

  if (card === null && status === "closed") return <ClosedCard />
  if (card === null && status === "drawn") {
    return (
      <StateCard tone="info" icon={<LockIcon />} title="The winners are drawn">
        <p>Sign in with Twitch to see whether you won.</p>
        <a className="button block" href={signInHref}>
          Sign in with Twitch
        </a>
      </StateCard>
    )
  }
  if (card !== null && status === "drawn" && card.entered) {
    return (
      <StateCard tone="info" icon={<GiftIcon />} title="Not this time">
        <p>The winner was drawn. It was not you this time.</p>
      </StateCard>
    )
  }
  return (
    <>
      <StepIndicator steps={stepNames} current={card === null ? 1 : card.step} />
      <StateCard
        tone={card === null ? "info" : card.tone}
        icon={card === null ? <GiftIcon /> : card.icon}
        title={card === null ? "Ready to enter?" : card.title}
      >
        <p>
          {card === null
            ? "Sign in with your Twitch account to get your ticket. It takes a few seconds."
            : card.detail}
        </p>
        {card !== null && card.help !== null ? <p>{card.help}</p> : null}
        {canEnter ? (
          <a className="button block" href={signInHref}>
            Enter with Twitch
          </a>
        ) : null}
      </StateCard>
    </>
  )
}

function ClosedCard() {
  return (
    <StateCard tone="warning" icon={<LockIcon />} title="Sorry, giveaway closed.">
      <p>The streamer stopped taking entries. Follow the channel to catch the next one.</p>
    </StateCard>
  )
}

interface EntryCard {
  readonly tone: Tone
  readonly icon: ReactNode
  readonly title: string
  readonly detail: string
  readonly help: string | null
  /** Where the viewer is in the two steps; past the last step means done. */
  readonly step: number
  /** Whether another sign-in can still change the outcome. */
  readonly retry: boolean
  /** The viewer holds a ticket. */
  readonly entered: boolean
}

function entryCard(entry: EntryView, giveaway: GiveawayView): EntryCard {
  switch (entry.kind) {
    case "entered":
      return {
        tone: "success",
        icon: <CheckIcon />,
        title: "You are in",
        detail: "The streamer draws the winner live. Keep this page open or come back later.",
        help: "Good luck!",
        step: 3,
        retry: false,
        entered: true,
      }
    case "already-in":
      return {
        tone: "success",
        icon: <CheckIcon />,
        title: "You are in",
        detail: "Your first entry is kept. You do not need to enter again.",
        help: "The streamer draws the winner live. Keep this page open or come back later.",
        step: 3,
        retry: false,
        entered: true,
      }
    case "pending":
      return {
        tone: "info",
        icon: <span className="spinner" aria-hidden="true" />,
        title: "You are being entered",
        detail: `This takes up to ${waitText(giveaway.poll.maxMs)}. Do not close this page.`,
        help: "Twitch is busy. This page updates by itself.",
        step: 2,
        retry: false,
        entered: false,
      }
    case "not-eligible":
      return {
        tone: "warning",
        icon: <LockIcon />,
        title: "You cannot enter",
        detail: reasonText[entry.reason],
        help: reasonHelp[entry.reason],
        step: 1,
        retry: false,
        entered: false,
      }
    case "closed":
      return {
        tone: "warning",
        icon: <LockIcon />,
        title: "Sorry, giveaway closed.",
        detail: "The streamer stopped taking entries. Follow the channel to catch the next one.",
        help: null,
        step: 1,
        retry: false,
        entered: false,
      }
    case "dropped":
      return {
        tone: "danger",
        icon: <AlertIcon />,
        title: "Your entry took too long",
        detail: "Too many people entered at once and your entry was dropped.",
        help: "Press the button to enter again.",
        step: 1,
        retry: true,
        entered: false,
      }
    case "timed-out":
      return {
        tone: "danger",
        icon: <AlertIcon />,
        title: "This is taking too long",
        detail: "We did not hear back in time.",
        help: "Press the button to enter again.",
        step: 1,
        retry: true,
        entered: false,
      }
    case "try-again":
      return {
        tone: "danger",
        icon: <AlertIcon />,
        title: "Try again",
        detail: "Twitch did not answer in time.",
        help: "Press the button to give it another go.",
        step: 1,
        retry: true,
        entered: false,
      }
    case "invalid-state":
      return {
        tone: "danger",
        icon: <AlertIcon />,
        title: "Sign-in expired",
        detail: "Your sign-in took too long.",
        help: "Press the button to start again.",
        step: 1,
        retry: true,
        entered: false,
      }
  }
}

// The countdown is a timer role without a live region: announcing every second would drown the outcome.
function ClaimPanel({
  code,
  win,
  keyword,
}: {
  readonly code: string
  readonly win: NonNullable<GiveawayView["win"]>
  readonly keyword: string | null
}) {
  const remaining = useRemainingMs(win.claimRemainingMs)
  const { message, busy, run } = useAction()

  if (win.claim.state === "rerolled") {
    return (
      <StateCard tone="warning" icon={<AlertIcon />} title="Another winner was picked">
        <p>{viewerClaimText.rerolled}</p>
      </StateCard>
    )
  }
  const claimed = win.claim.state === "claimed" || message === viewerClaimText.claimed
  if (claimed) {
    return (
      <StateCard tone="win" icon={<TrophyIcon />} title="You won">
        <p>{viewerClaimText.claimed}</p>
      </StateCard>
    )
  }
  if (win.claim.state === "expired" || remaining === 0) {
    return (
      <StateCard tone="danger" icon={<ClockIcon />} title="Time is up">
        <p>{viewerClaimText.expired}</p>
        <p>The streamer may pick another winner.</p>
      </StateCard>
    )
  }
  return (
    <StateCard tone="win" icon={<TrophyIcon />} title="You won">
      <p className="big-clock">
        <span role="timer">{formatClock(remaining)}</span> min left to claim
      </p>
      <p>Press the button before the time runs out.</p>
      <button
        type="button"
        className="button block"
        disabled={busy}
        onClick={() => void run(() => claimPrize(code), viewerClaimText)}
      >
        Claim my prize
      </button>
      <p className="muted">
        {keyword === null ? (
          "Or write any message in the stream chat."
        ) : (
          <>
            Or type <strong>{keyword}</strong> in the stream chat.
          </>
        )}
      </p>
      {message === null ? null : <Status>{message}</Status>}
    </StateCard>
  )
}

function Rules({ giveaway }: { readonly giveaway: GiveawayView }) {
  const { rules } = giveaway
  return (
    <details className="extra">
      <summary>Rules and tickets</summary>
      <p className="help">The more tickets a group gets, the better its chance of winning.</p>
      <ul>
        {groups.map((group) => (
          <li key={group}>
            {groupLabel[group]}: {ticketText(rules.tickets[group])}
          </li>
        ))}
      </ul>
      <ul>
        {rules.minAccountAgeDays === null ? null : (
          <li>Account at least {rules.minAccountAgeDays} days old</li>
        )}
        {giveaway.closesAt === null ? null : (
          <li>Entries end {new Date(giveaway.closesAt).toLocaleString()}</li>
        )}
        <li>Winners have {claimTimeText(giveaway.claimSeconds)} to claim</li>
        <li>A winner claims on this page or in the stream chat.</li>
      </ul>
    </details>
  )
}

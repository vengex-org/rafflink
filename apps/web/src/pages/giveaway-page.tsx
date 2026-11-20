import { useCallback, useMemo, useState, type ReactNode } from "react"
import { useParams, useSearchParams } from "react-router"
import { groups } from "@rafflink/core/domain/groups"
import type { EntrySummary } from "@rafflink/core/room/rows"
import type { ViewerState } from "@rafflink/core/http/json"
import { claimPrize, entryFromQuery, getGiveaway, type GiveawayView } from "../api/client.ts"
import { Disclosure } from "../components/disclosure.tsx"
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  GiftIcon,
  InfoIcon,
  LockIcon,
  LogInIcon,
  TrophyIcon,
  UsersIcon,
} from "../components/icons.tsx"
import { Failed, Loading, NotFound, Status } from "../components/notice.tsx"
import { StateCard, type Tone } from "../components/state-card.tsx"
import { StepIndicator } from "../components/step-indicator.tsx"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { giveawayName } from "../lib/messages.ts"
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

const stepNames = ["giveaway.stepSignIn", "giveaway.stepTicket"] as const

export function GiveawayPage() {
  const { code } = useParams()
  return code === undefined ? <NotFound title="notFound.giveaway" /> : <Loaded code={code} />
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
        <NotFound title="notFound.giveaway" />
      ) : (
        <GiveawayDetails code={code} giveaway={result.value.giveaway} me={result.value.me} />
      )
  }
}

function GiveawayDetails({
  code,
  giveaway,
  me,
}: {
  readonly code: string
  readonly giveaway: GiveawayView
  readonly me: ViewerState
}) {
  const i18n = useI18n()
  const [query] = useSearchParams()
  const initial = useMemo(() => entryFromQuery(query), [query])
  const fromSignIn = useEntryResult(code, initial, giveaway.poll)
  // A returning viewer has no sign-in outcome in the URL; the viewer state says they are in. It also
  // wins over a `dropped` left in the URL, which only says the queued ticket is gone.
  const fromServer = me.kind === "entered" ? { kind: "entered" as const, entry: me.entry } : null
  const entry =
    fromSignIn?.kind === "dropped" && fromServer !== null ? fromServer : (fromSignIn ?? fromServer)
  // The viewer state was read before a queued sign-in finished, so the poll answer is the fresher entry.
  const entered = entry?.kind === "entered" || entry?.kind === "already-in" ? entry.entry : null
  const signInHref = `/auth/twitch/viewer/start?giveaway=${encodeURIComponent(code)}`
  const extraTickets = extraTicketsText(i18n, giveaway.rules.tickets)

  return (
    <article>
      <header className="card hero">
        {giveaway.prize === null ? null : (
          <p className="eyebrow">{giveawayName(i18n, giveaway.title, code)}</p>
        )}
        <h1>{giveaway.prize ?? giveawayName(i18n, giveaway.title, code)}</h1>
        <p className="muted">{i18n.t("giveaway.by", { name: giveaway.streamerName })}</p>
        <ul className="facts">
          <li>
            <UsersIcon />
            {peopleText(i18n, giveaway.entrantCount)}
          </li>
          <li>
            <ClockIcon />
            <EntriesEnd status={giveaway.status} closesAt={giveaway.closesAt} />
          </li>
          <li>
            <GiftIcon />
            <span>
              {whoCanEnterText(i18n, giveaway.rules.subsOnly, giveaway.rules.followersOnly)}
              {extraTickets === null ? null : ` ${extraTickets}`}
            </span>
          </li>
        </ul>
      </header>
      <div aria-live="polite" className="outcome">
        {me.kind === "won" ? (
          <ClaimPanel code={code} win={me} keyword={giveaway.rules.claimKeyword} />
        ) : (
          <EntryPanel
            entry={entry}
            tickets={entered ?? (me.kind === "entered" ? me.entry : null)}
            notDrawn={me.kind === "not-won"}
            giveaway={giveaway}
            signInHref={signInHref}
          />
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
  const { t } = useI18n()
  if (status !== "open") return <span>{t("giveaway.closedFact")}</span>
  if (closesAt === null) return <span>{t("giveaway.openUntilClosed")}</span>
  return <CountdownToClose closesAt={closesAt} />
}

function CountdownToClose({ closesAt }: { readonly closesAt: number }) {
  const { t } = useI18n()
  const [initial] = useState(() => Math.max(0, closesAt - Date.now()))
  const remaining = useRemainingMs(initial)
  return (
    <span>
      {remaining === 0
        ? t("giveaway.aboutToClose")
        : t("giveaway.closesIn", { time: formatLeft(remaining) })}
    </span>
  )
}

function EntryPanel({
  entry,
  tickets,
  notDrawn,
  giveaway,
  signInHref,
}: {
  readonly entry: EntryView | null
  /** The viewer's entry as the server holds it; null when the page does not know it. */
  readonly tickets: EntrySummary | null
  /** The viewer entered and was not drawn. */
  readonly notDrawn: boolean
  readonly giveaway: GiveawayView
  readonly signInHref: string
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { status } = giveaway
  const card = entry === null ? null : entryCard(entry, giveaway, i18n)
  const ticketsText =
    tickets === null
      ? null
      : t("entry.in.tickets", {
          tickets: i18n.plural("ticket", tickets.tickets),
          role: t(`entry.role.${tickets.group}`),
        })
  const canEnter = status === "open" && (card === null || card.retry)
  // These outcomes end the flow, so a step count would suggest it goes on.
  const endsFlow =
    entry?.kind === "not-eligible" || entry?.kind === "closed" || entry?.kind === "dropped"

  if (notDrawn) {
    return (
      <StateCard
        tone="info"
        align="center"
        icon={<GiftIcon />}
        title={t("giveaway.notThisTime.title")}
      >
        <p>{t("giveaway.notThisTime.text")}</p>
      </StateCard>
    )
  }
  if (card === null && status === "closed") return <ClosedCard />
  if (card === null && status === "drawn") {
    return (
      <StateCard tone="info" align="center" icon={<LockIcon />} title={t("giveaway.drawn.title")}>
        <p>{t("giveaway.drawn.text")}</p>
        <a className="button block" href={signInHref}>
          <LogInIcon />
          {t("signIn.button")}
        </a>
      </StateCard>
    )
  }
  if (card !== null && status === "drawn" && card.entered) {
    return (
      <StateCard
        tone="info"
        align="center"
        icon={<GiftIcon />}
        title={t("giveaway.notThisTime.title")}
      >
        <p>{t("giveaway.notThisTime.text")}</p>
      </StateCard>
    )
  }
  return (
    <>
      {endsFlow ? null : (
        <StepIndicator steps={stepNames} current={card === null ? 1 : card.step} />
      )}
      <StateCard
        tone={card === null ? "info" : card.tone}
        align="center"
        icon={card === null ? <GiftIcon /> : card.icon}
        title={card === null ? t("giveaway.ready.title") : card.title}
      >
        <p>{card === null ? t("giveaway.ready.text") : card.detail}</p>
        {card !== null && card.entered && ticketsText !== null ? <p>{ticketsText}</p> : null}
        {card !== null && card.help !== null ? <p>{card.help}</p> : null}
        {canEnter ? (
          <a className="button block" href={signInHref}>
            <LogInIcon />
            {t("giveaway.enter")}
          </a>
        ) : null}
        {entry?.kind === "not-eligible" && entry.reason === "broadcaster" ? (
          <a className="button tonal block" href={`${signInHref}&force_verify=true`}>
            <LogInIcon />
            {t("entry.otherAccount")}
          </a>
        ) : null}
      </StateCard>
    </>
  )
}

function ClosedCard() {
  const { t } = useI18n()
  return (
    <StateCard tone="warning" align="center" icon={<LockIcon />} title={t("giveaway.closed.title")}>
      <p>{t("giveaway.closed.text")}</p>
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

function entryCard(entry: EntryView, giveaway: GiveawayView, i18n: I18n): EntryCard {
  const { t } = i18n
  switch (entry.kind) {
    case "entered":
      return {
        tone: "success",
        icon: <CheckIcon />,
        title: t("entry.in.title"),
        detail: t("entry.in.detail"),
        help: t("entry.in.help"),
        step: 3,
        retry: false,
        entered: true,
      }
    case "already-in":
      return {
        tone: "success",
        icon: <CheckIcon />,
        title: t("entry.in.title"),
        detail: t("entry.already.detail"),
        help: t("entry.already.help"),
        step: 3,
        retry: false,
        entered: true,
      }
    case "pending":
      return {
        tone: "info",
        icon: <span className="spinner" aria-hidden="true" />,
        title: t("entry.pending.title"),
        detail: t("entry.pending.detail", { wait: waitText(i18n, giveaway.poll.maxMs) }),
        help: t("entry.pending.help"),
        step: 2,
        retry: false,
        entered: false,
      }
    case "not-eligible":
      return {
        tone: "warning",
        icon: <LockIcon />,
        title: t("entry.notEligible.title"),
        detail: t(`reason.${entry.reason}`),
        help: t(`reasonHelp.${entry.reason}`),
        step: 1,
        retry: false,
        entered: false,
      }
    case "closed":
      return {
        tone: "warning",
        icon: <LockIcon />,
        title: t("giveaway.closed.title"),
        detail: t("giveaway.closed.text"),
        help: null,
        step: 1,
        retry: false,
        entered: false,
      }
    case "dropped":
      return {
        tone: "danger",
        icon: <AlertIcon />,
        title: t("entry.dropped.title"),
        detail: t("entry.dropped.detail"),
        help: t("entry.dropped.help"),
        step: 1,
        retry: true,
        entered: false,
      }
    case "timed-out":
      return {
        tone: "danger",
        icon: <AlertIcon />,
        title: t("entry.timedOut.title"),
        detail: t("entry.timedOut.detail"),
        help: t("entry.timedOut.help"),
        step: 1,
        retry: true,
        entered: false,
      }
    case "try-again":
      return {
        tone: "danger",
        icon: <AlertIcon />,
        title: t("entry.tryAgain.title"),
        detail: t("entry.tryAgain.detail"),
        help: t("entry.tryAgain.help"),
        step: 1,
        retry: true,
        entered: false,
      }
    case "invalid-state":
      return {
        tone: "danger",
        icon: <AlertIcon />,
        title: t("entry.invalidState.title"),
        detail: t("entry.invalidState.detail"),
        help: t("entry.invalidState.help"),
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
  readonly win: Extract<ViewerState, { kind: "won" }>
  readonly keyword: string | null
}) {
  const { t, rich } = useI18n()
  const remaining = useRemainingMs(win.claimRemainingMs)
  const { message, busy, run } = useAction()

  if (win.claim.state === "rerolled") {
    return (
      <StateCard tone="warning" align="center" icon={<AlertIcon />} title={t("win.another.title")}>
        <p>{t("viewerClaim.rerolled")}</p>
      </StateCard>
    )
  }
  const claimed = win.claim.state === "claimed" || message === "viewerClaim.claimed"
  if (claimed) {
    return (
      <StateCard tone="win" align="center" icon={<TrophyIcon />} title={t("win.title")}>
        <p>{t("viewerClaim.claimed")}</p>
      </StateCard>
    )
  }
  if (win.claim.state === "expired" || remaining === 0) {
    return (
      <StateCard tone="danger" align="center" icon={<ClockIcon />} title={t("win.up.title")}>
        <p>{t("viewerClaim.expired")}</p>
        <p>{t("win.up.text")}</p>
      </StateCard>
    )
  }
  return (
    <StateCard tone="win" align="center" icon={<TrophyIcon />} title={t("win.title")}>
      <p className="big-clock">
        <span role="timer">{formatClock(remaining)}</span> {t("claim.minLeft")}
      </p>
      <p>{t("win.press")}</p>
      <button
        type="button"
        className="button block"
        disabled={busy}
        onClick={() =>
          void run(
            () => claimPrize(code),
            (outcome) => `viewerClaim.${outcome}`,
          )
        }
      >
        <TrophyIcon />
        {t("win.claim")}
      </button>
      {win.chatClaimAvailable ? (
        <p className="muted">
          {keyword === null
            ? t("win.orAny")
            : rich("win.orType", { keyword: <strong>{keyword}</strong> })}
        </p>
      ) : null}
      {message === null ? null : <Status>{t(message)}</Status>}
    </StateCard>
  )
}

function Rules({ giveaway }: { readonly giveaway: GiveawayView }) {
  const i18n = useI18n()
  const { t, plural } = i18n
  const { rules } = giveaway
  return (
    <Disclosure icon={<InfoIcon />} summary={t("rules.summary")} open={false}>
      <p className="help">{t("rules.help")}</p>
      <ul>
        {groups.map((group) => (
          <li key={group}>
            {t("rules.groupTickets", {
              group: t(`group.${group}`),
              tickets: ticketText(i18n, rules.tickets[group]),
            })}
          </li>
        ))}
      </ul>
      <ul>
        {rules.minAccountAgeDays === null ? null : (
          <li>{t("rules.accountAge", { days: plural("day", rules.minAccountAgeDays) })}</li>
        )}
        {giveaway.closesAt === null ? null : (
          <li>{t("rules.entriesEnd", { time: i18n.dateTime(giveaway.closesAt) })}</li>
        )}
        <li>{t("rules.claimTime", { time: claimTimeText(i18n, giveaway.claimSeconds) })}</li>
        <li>{t("rules.claimWhere")}</li>
      </ul>
    </Disclosure>
  )
}

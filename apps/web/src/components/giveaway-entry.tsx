import type { ReactNode } from "react"
import type { EntrySummary } from "@rafflink/core/room/rows"
import type { GiveawayView } from "../api/client.ts"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { waitText } from "../lib/rules-text.ts"
import type { EntryView } from "../lib/use-entry-result.ts"
import { AlertIcon, CheckIcon, ClockIcon, GiftIcon, LockIcon, LogInIcon } from "./icons.tsx"
import { GiveawayState, TicketBox } from "./giveaway-state.tsx"
import type { Tone } from "./state-card.tsx"
import { StepIndicator } from "./step-indicator.tsx"

const stepNames = ["giveaway.stepSignIn", "giveaway.stepTicket"] as const

/** The one state block of a viewer who is not a winner: signed out, ready, queued, in, turned away, closed or not drawn. */
export function EntryPanel({
  entry,
  tickets,
  notDrawn,
  signedOut,
  showSteps,
  giveaway,
  signInHref,
}: {
  readonly entry: EntryView | null
  /** The viewer's entry as the server holds it; null when the page does not know it. */
  readonly tickets: EntrySummary | null
  /** The viewer entered and was not drawn. */
  readonly notDrawn: boolean
  /** No valid viewer cookie: the viewer has to sign in before anything else. */
  readonly signedOut: boolean
  /** The viewer is in the sign-in flow, so the page says which of its two steps they are on. */
  readonly showSteps: boolean
  readonly giveaway: GiveawayView
  readonly signInHref: string
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { status } = giveaway
  const card = entry === null ? null : entryCard(entry, giveaway, i18n)
  const canEnter = status === "open" && (card === null || card.retry)
  // These outcomes end the flow, so a step count would suggest it goes on.
  const endsFlow =
    entry?.kind === "not-eligible" || entry?.kind === "closed" || entry?.kind === "dropped"
  const signIn = (label: string) => (
    <a className="button block" href={signInHref}>
      <LogInIcon />
      {label}
    </a>
  )

  if (notDrawn || (card !== null && status === "drawn" && card.entered)) {
    return (
      <GiveawayState tone="info" icon={<GiftIcon />} title={t("giveaway.notThisTime.title")}>
        <p className="viewer-note">{t("giveaway.notThisTime.text")}</p>
      </GiveawayState>
    )
  }
  if (tickets !== null && status === "closed" && (card === null || card.entered)) {
    return (
      <GiveawayState tone="info" icon={<ClockIcon />} title={t("giveaway.waiting.title")}>
        <TicketBox tickets={tickets} />
        <p className="viewer-note">{t("giveaway.waiting.text")}</p>
      </GiveawayState>
    )
  }
  if (card === null && status === "closed") {
    return (
      <GiveawayState tone="warning" icon={<LockIcon />} title={t("giveaway.closed.title")}>
        <p className="viewer-note">{t("giveaway.closed.text")}</p>
      </GiveawayState>
    )
  }
  if (card === null && status === "drawn") {
    return (
      <GiveawayState tone="info" icon={<LockIcon />} title={t("giveaway.drawn.title")}>
        <p className="viewer-note">{t("giveaway.drawn.text")}</p>
        {signIn(t(giveaway.platform === "kick" ? "signIn.buttonKick" : "signIn.button"))}
      </GiveawayState>
    )
  }
  return (
    <>
      {showSteps && !endsFlow ? (
        <StepIndicator steps={stepNames} current={card === null ? 1 : card.step} onSelect={null} />
      ) : null}
      <GiveawayState
        tone={card === null ? "info" : card.tone}
        icon={card === null ? <GiftIcon /> : card.icon}
        title={
          card === null
            ? t(signedOut ? "giveaway.signedOut.title" : "giveaway.ready.title")
            : card.title
        }
      >
        {card !== null && card.entered && tickets !== null ? <TicketBox tickets={tickets} /> : null}
        <div className="viewer-notes">
          <p className="viewer-note">{card === null ? t("giveaway.ready.text") : card.detail}</p>
          {card !== null && card.help !== null ? <p className="viewer-note">{card.help}</p> : null}
        </div>
        {canEnter
          ? signIn(t(giveaway.platform === "kick" ? "giveaway.enterKick" : "giveaway.enter"))
          : null}
        {entry?.kind === "not-eligible" && entry.reason === "broadcaster" ? (
          <a className="button outlined block" href={`${signInHref}&force_verify=true`}>
            <LogInIcon />
            {t("entry.otherAccount")}
          </a>
        ) : null}
      </GiveawayState>
    </>
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
    case "rate-limited":
      return {
        tone: "warning",
        icon: <AlertIcon />,
        title: t("entry.rateLimited.title"),
        detail: t("entry.rateLimited.detail"),
        help: t("entry.rateLimited.help"),
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

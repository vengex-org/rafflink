import { useState, type ReactNode } from "react"
import type { LiveWinner } from "@rafflink/core/room/giveaway-room"
import type { RoomStatus } from "@rafflink/core/room/rows"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { formatClock, useRemainingMs } from "../lib/use-remaining.ts"
import {
  ActivityIcon,
  AlertIcon,
  CheckIcon,
  ClockIcon,
  LockIcon,
  RefreshIcon,
  TrophyIcon,
  UsersIcon,
} from "./icons.tsx"

/** A number with what it counts, so no figure stands alone. */
export function Stat({
  icon,
  value,
  label,
}: {
  readonly icon: ReactNode
  readonly value: string
  readonly label: string
}) {
  return (
    <div className="stat">
      <dt>
        {icon}
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  )
}

/** Where a giveaway stands: entries open, closed or winners drawn. */
export function StatusPill({ status }: { readonly status: RoomStatus }) {
  const { t } = useI18n()
  return (
    <span className="pill" data-status={status}>
      {statusIcon(status)}
      {t(`status.${status}`)}
    </span>
  )
}

export function EntrantNames({ names }: { readonly names: readonly string[] }) {
  const { t } = useI18n()
  if (names.length === 0) {
    return (
      <p className="empty">
        <UsersIcon />
        {t("entrants.none")}
      </p>
    )
  }
  return (
    <ul className="names">
      {names.map((name, index) => (
        <li key={`${index}-${name}`}>{name}</li>
      ))}
    </ul>
  )
}

/** Every winner with how their claim stands; `actions` adds buttons per winner. */
export function WinnerList({
  winners,
  actions,
}: {
  readonly winners: readonly LiveWinner[]
  readonly actions: ((winner: LiveWinner) => ReactNode) | null
}) {
  const { t } = useI18n()
  return (
    <ul className="winners">
      {winners.map((winner) => (
        <li key={winner.n} data-claim={winner.claim.state}>
          <span className="winner-name">
            {winner.n + 1}. {winner.displayName ?? t("winner.removed")}
          </span>
          <span className="winner-claim">
            {claimIcon(winner)}
            {claimLabel(winner, t)}
          </span>
          {winner.claim.state === "waiting" ? <ClaimClock until={winner.claimUntil} /> : null}
          {actions?.(winner)}
        </li>
      ))}
    </ul>
  )
}

export function ClaimClock({ until }: { readonly until: number }) {
  const { t } = useI18n()
  const [initial] = useState(() => Math.max(0, until - Date.now()))
  const remaining = useRemainingMs(initial)
  return (
    <span className="claim-clock">
      <span role="timer">{formatClock(remaining)}</span> {t("claim.minLeft")}
    </span>
  )
}

function statusIcon(status: RoomStatus): ReactNode {
  switch (status) {
    case "open":
      return <ActivityIcon />
    case "closed":
      return <LockIcon />
    case "drawn":
      return <TrophyIcon />
  }
}

export function claimIcon(winner: LiveWinner): ReactNode {
  switch (winner.claim.state) {
    case "claimed":
      return <CheckIcon />
    case "waiting":
      return <ClockIcon />
    case "expired":
      return <AlertIcon />
    case "rerolled":
      return <RefreshIcon />
  }
}

export function claimLabel(winner: LiveWinner, t: I18n["t"]): string {
  switch (winner.claim.state) {
    case "claimed":
      return t(`claim.claimed.${winner.claim.via}`)
    case "waiting":
      return t("claim.waiting")
    case "expired":
      return t("claim.expired")
    case "rerolled":
      return t("claim.rerolled")
  }
}

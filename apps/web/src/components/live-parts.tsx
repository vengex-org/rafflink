import { useState, type ReactNode } from "react"
import type { LiveWinner } from "@rafflink/core/room/giveaway-room"
import type { RoomStatus } from "@rafflink/core/room/rows"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { formatClock, useRemainingMs } from "../lib/use-remaining.ts"
import { Countdown } from "./countdown.tsx"
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
import type { Tone } from "./state-card.tsx"
import { StatusChip } from "./status-chip.tsx"
import { WinnerPlate } from "./winner-plate.tsx"

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

/** The winner of the moment, large: the name on the plate, then the claim countdown or how the claim ended. */
export function CurrentWinner({ winner }: { readonly winner: LiveWinner }) {
  const { t } = useI18n()
  return (
    <div className="live-winner">
      <WinnerPlate key={winner.n} name={winner.displayName ?? t("winner.removed")} />
      {winner.claim.state === "waiting" ? (
        <ClaimCountdown key={`${winner.n}-${winner.claimUntil}`} until={winner.claimUntil} />
      ) : (
        <StatusChip tone={claimTone(winner)}>{claimLabel(winner, t)}</StatusChip>
      )}
    </div>
  )
}

function ClaimCountdown({ until }: { readonly until: number }) {
  const [initial] = useState(() => msUntil(until))
  return <Countdown initialMs={initial} />
}

export function ClaimClock({ until }: { readonly until: number }) {
  const { t } = useI18n()
  const [initial] = useState(() => msUntil(until))
  const remaining = useRemainingMs(initial)
  return (
    <span className="claim-left">
      <span role="timer">{formatClock(remaining)}</span> {t("claim.minLeft")}
    </span>
  )
}

function claimTone(winner: LiveWinner): Tone {
  switch (winner.claim.state) {
    case "claimed":
      return "success"
    case "waiting":
      return "info"
    case "expired":
    case "rerolled":
      return "danger"
  }
}

const msUntil = (instant: number) => Math.max(0, instant - Date.now())

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

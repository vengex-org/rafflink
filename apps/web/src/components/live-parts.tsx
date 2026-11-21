import { useState, type ReactNode } from "react"
import type { LiveSnapshot, LiveWinner } from "@rafflink/core/room/giveaway-room"
import type { RoomStatus } from "@rafflink/core/room/rows"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { initialsOf } from "../lib/initials.ts"
import { formatClock, useRemainingMs } from "../lib/use-remaining.ts"
import { PickActions, type Doing } from "./live-bar.tsx"
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

/** A round badge with the initials of a name; the name is always written beside it, so it is hidden from screen readers. */
export function Avatar({ name }: { readonly name: string }) {
  return (
    <span className="live-avatar" aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}

/** The picks other than the one on the plate, as pills with how their claim stands; `controls` adds buttons per pick. */
export function EarlierPicks({
  winners,
  snapshot,
  controls,
}: {
  readonly winners: readonly LiveWinner[]
  readonly snapshot: LiveSnapshot
  readonly controls: Doing | null
}) {
  const i18n = useI18n()
  const { t } = i18n
  if (winners.length === 0) return null
  return (
    <ul className="live-history" aria-label={t("live.history.label")}>
      {winners.map((winner) => {
        const name = winner.displayName ?? t("winner.removed")
        return (
          <li key={winner.n} className="live-hist" data-claim={winner.claim.state}>
            <Avatar name={name} />
            <span className="live-hist-name">{name}</span>
            <span className="live-hist-status">
              {winner.claim.state === "waiting" ? (
                <ClaimClock until={winner.claimUntil} />
              ) : (
                <>
                  {claimIcon(winner)}
                  {claimLabel(winner, i18n)}
                </>
              )}
            </span>
            {controls === null ? null : (
              <PickActions {...controls} snapshot={snapshot} winner={winner} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function ClaimClock({ until }: { readonly until: number }) {
  const { t } = useI18n()
  const [initial] = useState(() => msUntil(until))
  const remaining = useRemainingMs(initial)
  return (
    <span className="claim-left">
      <ClockIcon />
      <span role="timer">{formatClock(remaining)}</span> {t("claim.minLeft")}
    </span>
  )
}

export const msUntil = (instant: number) => Math.max(0, instant - Date.now())

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

export function claimLabel(winner: LiveWinner, { t, dateTime }: I18n): string {
  switch (winner.claim.state) {
    case "claimed":
      return t("claim.at", {
        label: t(`claim.claimed.${winner.claim.via}`),
        time: dateTime(winner.claim.at),
      })
    case "waiting":
      return t("claim.waiting")
    case "expired":
      return t("claim.expired")
    case "rerolled":
      return t("claim.rerolled")
  }
}

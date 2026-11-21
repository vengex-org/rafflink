import { useState, type ReactNode } from "react"
import type { LiveWinner } from "@rafflink/core/room/giveaway-room"
import type { RoomStatus } from "@rafflink/core/room/rows"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { initialsOf } from "../lib/initials.ts"
import { ActivityIcon, LockIcon, TrophyIcon, UsersIcon } from "./icons.tsx"

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

/** A round badge with the Twitch profile picture, or the initials of a name when there is no picture or it does not load; the name is always written beside it, so it is hidden from screen readers. */
export function Avatar({
  name,
  imageUrl,
}: {
  readonly name: string
  readonly imageUrl: string | null
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return (
    <span className="live-avatar" aria-hidden="true">
      {imageUrl === null || imageUrl === failedUrl ? (
        initialsOf(name)
      ) : (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(imageUrl)}
        />
      )}
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

export function claimLabel(winner: LiveWinner, { t, dateTime }: I18n): string {
  switch (winner.claim.state) {
    case "claimed":
      return t("claim.at", {
        label: t(`claim.claimed.${winner.claim.via}`),
        at: dateTime(winner.claim.at),
      })
    case "waiting":
      return t("claim.waiting")
    case "expired":
      return t("claim.expired")
    case "rerolled":
      return t("claim.rerolled")
  }
}

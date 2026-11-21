import { useState, type ReactNode } from "react"
import { groups } from "@rafflink/core/domain/groups"
import type { GiveawayView } from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import {
  claimTimeText,
  extraTicketsText,
  peopleText,
  ticketText,
  whoCanEnterText,
} from "../lib/rules-text.ts"
import { formatLeft, useClock, useRemainingMs } from "../lib/use-remaining.ts"
import { ChevronDownIcon } from "./icons.tsx"

/** Which detail rows a screen shows: what a viewer can still enter, or the pool a winner was drawn from. */
export type FactsKind = "entry" | "pool"

export function GiveawayFacts({
  kind,
  giveaway,
}: {
  readonly kind: FactsKind
  readonly giveaway: GiveawayView
}) {
  const i18n = useI18n()
  const { t } = i18n
  const extraTickets = extraTicketsText(i18n, giveaway.rules.tickets)
  return (
    <dl className="viewer-facts">
      {kind === "pool" ? (
        <Fact label={t("giveaway.row.pool")}>{peopleText(i18n, giveaway.entrantCount)}</Fact>
      ) : (
        <>
          <Fact label={t("giveaway.row.who")} format="text">
            {whoCanEnterText(i18n, giveaway.rules.subsOnly, giveaway.rules.followersOnly)}
            {extraTickets === null ? null : ` ${extraTickets}`}
          </Fact>
          {giveaway.status === "open" ? (
            <Fact label={t("giveaway.row.entries")} format="text">
              <EntriesEnd closesAt={giveaway.closesAt} />
            </Fact>
          ) : null}
        </>
      )}
      <Fact label={t("giveaway.row.code")} format="mono">
        {giveaway.code}
      </Fact>
    </dl>
  )
}

function Fact({
  label,
  format,
  children,
}: {
  readonly label: string
  /** `text` for a sentence, `mono` for a code; a figure needs neither. */
  readonly format?: "text" | "mono"
  readonly children: ReactNode
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-format={format}>{children}</dd>
    </div>
  )
}

function EntriesEnd({ closesAt }: { readonly closesAt: number | null }) {
  const { t } = useI18n()
  return closesAt === null ? (
    t("giveaway.openUntilClosed")
  ) : (
    <CountdownToClose closesAt={closesAt} />
  )
}

function CountdownToClose({ closesAt }: { readonly closesAt: number }) {
  const { t } = useI18n()
  const { now } = useClock()
  const [initial] = useState(() => Math.max(0, closesAt - now()))
  const remaining = useRemainingMs(initial)
  return remaining === 0
    ? t("giveaway.aboutToClose")
    : t("giveaway.closesIn", { time: formatLeft(remaining) })
}

export function GiveawayRules({ giveaway }: { readonly giveaway: GiveawayView }) {
  const i18n = useI18n()
  const { t, plural } = i18n
  const { rules } = giveaway
  return (
    <details className="viewer-rules">
      <summary>
        {t("rules.summary")}
        <ChevronDownIcon />
      </summary>
      <div className="viewer-rules-body">
        <p>{t("rules.help")}</p>
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
      </div>
    </details>
  )
}

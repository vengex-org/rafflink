import { useState, type ReactNode } from "react"
import type { GiveawayView } from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { shareUrl, verifyUrl } from "../lib/links.ts"
import { officialRules, officialRulesText } from "../lib/official-rules.ts"
import {
  extraTicketsText,
  peopleText,
  recentWinnersText,
  whoCanEnterText,
} from "../lib/rules-text.ts"
import { formatLeft, useClock, useRemainingMs } from "../lib/use-remaining.ts"
import { CopyButton } from "./copy-field.tsx"
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
  const recentWinners = recentWinnersText(i18n, giveaway.rules.excludeRecentWinners)
  return (
    <dl className="viewer-facts">
      {kind === "pool" ? (
        <Fact label={t("giveaway.row.pool")}>{peopleText(i18n, giveaway.entrantCount)}</Fact>
      ) : (
        <>
          <Fact label={t("giveaway.row.who")} format="text">
            {whoCanEnterText(i18n, giveaway.rules.subsOnly, giveaway.rules.followersOnly)}
            {extraTickets === null ? null : ` ${extraTickets}`}
            {recentWinners === null ? null : ` ${recentWinners}`}
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

/** The giveaway's official rules, built from its settings, with a button that copies them as text. */
export function GiveawayRules({ giveaway }: { readonly giveaway: GiveawayView }) {
  const i18n = useI18n()
  const { t } = i18n
  const rules = officialRules(i18n, giveaway, verifyUrl(giveaway.code))
  return (
    <details className="viewer-rules">
      <summary>
        {t("rules.summary")}
        <ChevronDownIcon />
      </summary>
      <div className="viewer-rules-body">
        <p>{t("rules.help")}</p>
        <ul>
          {rules.tickets.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <ul>
          {rules.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {rules.extraTerms === null ? null : (
          <>
            <p>{rules.extraTerms.heading}</p>
            <p className="viewer-rules-terms">{rules.extraTerms.text}</p>
          </>
        )}
        <p>{rules.notice}</p>
        <div className="viewer-rules-copy">
          <CopyButton
            value={officialRulesText(i18n, rules, shareUrl(giveaway.code))}
            label={t("rules.copy")}
            fieldLabel={t("rules.summary")}
          />
          <span aria-hidden="true">{t("rules.copy")}</span>
        </div>
      </div>
    </details>
  )
}

import type { Dispatch, SetStateAction } from "react"
import { groups } from "@rafflink/core/domain/groups"
import { Segmented, TextField, type SegmentOption } from "../components/form-fields.tsx"
import { ClockIcon, HeartIcon, LockIcon, StarIcon, UsersIcon } from "../components/icons.tsx"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { claimTimeText, ticketText, whoCanEnterText } from "../lib/rules-text.ts"
import {
  claimPresets,
  oddsOf,
  type Audience,
  type Ending,
  type Issue,
  type Odds,
  type Values,
} from "./create-values.ts"

interface StepProps {
  readonly values: Values
  readonly setValues: Dispatch<SetStateAction<Values>>
  readonly issue: Issue | null
}

function errorOf(i18n: I18n, issue: Issue | null, field: string): string | null {
  return issue?.field === field ? i18n.t(issue.message) : null
}

export function BasicsStep({ values, setValues, issue }: StepProps) {
  const i18n = useI18n()
  const { t } = i18n
  const endings: readonly SegmentOption<Ending>[] = [
    {
      value: "never",
      label: t("wizard.ending.never"),
      icon: <LockIcon />,
      description: t("wizard.ending.never.help"),
    },
    {
      value: "at-time",
      label: t("wizard.ending.atTime"),
      icon: <ClockIcon />,
      description: t("wizard.ending.atTime.help"),
    },
  ]
  return (
    <>
      <TextField
        name="title"
        label={t("wizard.title.label")}
        help={t("wizard.title.help")}
        type="text"
        min={null}
        value={values.title}
        error={errorOf(i18n, issue, "title")}
        onChange={(title) => setValues((current) => ({ ...current, title }))}
      />
      <TextField
        name="prize"
        label={t("wizard.prize.label")}
        help={t("wizard.prize.help")}
        type="text"
        min={null}
        value={values.prize}
        error={errorOf(i18n, issue, "prize")}
        onChange={(prize) => setValues((current) => ({ ...current, prize }))}
      />
      <Segmented
        name="ending"
        legend={t("wizard.ending.legend")}
        help={null}
        options={endings}
        value={values.ending}
        onSelect={(ending) => setValues((current) => ({ ...current, ending }))}
      />
      {values.ending === "at-time" ? (
        <TextField
          name="closesAt"
          label={t("wizard.closesAt.label")}
          help={t("wizard.closesAt.help")}
          type="datetime-local"
          min={null}
          value={values.closesAt}
          error={errorOf(i18n, issue, "closesAt")}
          onChange={(closesAt) => setValues((current) => ({ ...current, closesAt }))}
        />
      ) : null}
    </>
  )
}

export function RulesStep({ values, setValues, issue }: StepProps) {
  const i18n = useI18n()
  const { t } = i18n
  const audiences: readonly SegmentOption<Audience>[] = [
    {
      value: "everyone",
      label: t("wizard.audience.everyone"),
      icon: <UsersIcon />,
      description: t("wizard.audience.everyone.help"),
    },
    {
      value: "followers",
      label: t("wizard.audience.followers"),
      icon: <HeartIcon />,
      description: t("wizard.audience.followers.help"),
    },
    {
      value: "subscribers",
      label: t("wizard.audience.subscribers"),
      icon: <StarIcon />,
      description: t("wizard.audience.subscribers.help"),
    },
  ]
  const presets: readonly number[] = claimPresets
  const offered = presets.includes(values.claimSeconds)
    ? presets
    : [...presets, values.claimSeconds]
  const claimOptions: readonly SegmentOption<number>[] = offered.map((seconds) => ({
    value: seconds,
    label: claimTimeText(i18n, seconds),
    icon: null,
    description: "",
  }))
  const odds = oddsOf(values.tickets)
  return (
    <>
      <Segmented
        name="audience"
        legend={t("wizard.q.audience")}
        help={null}
        options={audiences}
        value={values.audience}
        onSelect={(audience) => setValues((current) => ({ ...current, audience }))}
      />
      <TextField
        name="minAccountAgeDays"
        label={t("wizard.minAge.label")}
        help={t("wizard.minAge.help")}
        type="number"
        min={0}
        value={values.minAccountAgeDays}
        error={errorOf(i18n, issue, "minAccountAgeDays")}
        onChange={(minAccountAgeDays) =>
          setValues((current) => ({ ...current, minAccountAgeDays }))
        }
      />
      <fieldset className="field">
        <legend>{t("wizard.tickets.legend")}</legend>
        <p className="help">{t("wizard.tickets.help")}</p>
        <div className="ticket-table">
          {groups.map((group) => (
            <TextField
              key={group}
              name={`tickets.${group}`}
              label={t(`group.${group}`)}
              help={null}
              type="number"
              min={0}
              value={values.tickets[group]}
              error={errorOf(i18n, issue, `tickets.${group}`)}
              onChange={(count) =>
                setValues((current) => ({
                  ...current,
                  tickets: { ...current.tickets, [group]: count },
                }))
              }
            />
          ))}
        </div>
        {odds === null ? null : <output className="odds">{oddsText(i18n, odds)}</output>}
      </fieldset>
      <TextField
        name="winnerCount"
        label={t("wizard.winners.label")}
        help={t("wizard.winners.help")}
        type="number"
        min={1}
        value={values.winnerCount}
        error={errorOf(i18n, issue, "winnerCount")}
        onChange={(winnerCount) => setValues((current) => ({ ...current, winnerCount }))}
      />
      <Segmented
        name="claimSeconds"
        legend={t("wizard.claim.legend")}
        help={t("wizard.claim.help")}
        options={claimOptions}
        value={values.claimSeconds}
        onSelect={(claimSeconds) => setValues((current) => ({ ...current, claimSeconds }))}
      />
      <TextField
        name="claimKeyword"
        label={t("wizard.keyword.label")}
        help={t("wizard.keyword.help")}
        type="text"
        min={null}
        value={values.claimKeyword}
        error={errorOf(i18n, issue, "claimKeyword")}
        onChange={(claimKeyword) => setValues((current) => ({ ...current, claimKeyword }))}
      />
    </>
  )
}

export function ReviewStep({ values }: { readonly values: Values }) {
  const i18n = useI18n()
  const { t } = i18n
  const customTickets = groups.filter((group) => values.tickets[group].trim() !== "1")
  const keyword = values.claimKeyword.trim()
  return (
    <dl className="review">
      <ReviewRow label={t("review.name")} value={textOrNotSet(i18n, values.title)} />
      <ReviewRow label={t("review.prize")} value={textOrNotSet(i18n, values.prize)} />
      <ReviewRow
        label={t("review.who")}
        value={whoCanEnterText(
          i18n,
          values.audience === "subscribers",
          values.audience === "followers",
        )}
      />
      <ReviewRow
        label={t("review.tickets")}
        value={
          customTickets.length === 0
            ? t("review.everyoneOne")
            : customTickets
                .map((group) =>
                  t("rules.groupTickets", {
                    group: t(`group.${group}`),
                    tickets: ticketText(i18n, Number(values.tickets[group])),
                  }),
                )
                .join(", ")
        }
      />
      {values.minAccountAgeDays.trim() === "" ? null : (
        <ReviewRow
          label={t("review.age")}
          value={t("review.ageText", {
            days: i18n.plural("day", Number(values.minAccountAgeDays)),
          })}
        />
      )}
      <ReviewRow
        label={t("review.end")}
        value={
          values.ending === "never"
            ? t("review.endsManual")
            : i18n.dateTime(new Date(values.closesAt).getTime())
        }
      />
      <ReviewRow label={t("review.winners")} value={i18n.number(Number(values.winnerCount))} />
      <ReviewRow
        label={t("review.claim")}
        value={t("review.claimText", {
          time: claimTimeText(i18n, values.claimSeconds),
          chat: keyword === "" ? t("review.anyChat") : t("review.keywordChat", { keyword }),
        })}
      />
    </dl>
  )
}

function textOrNotSet(i18n: I18n, text: string): string {
  return text.trim() === "" ? i18n.t("review.notSet") : text
}

function ReviewRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function oddsText(i18n: I18n, odds: Odds): string {
  switch (odds.kind) {
    case "same":
    case "viewersOut":
    case "noBetter":
      return i18n.t(`odds.${odds.kind}`)
    case "times":
      return i18n.t(`odds.${odds.group}`, { times: i18n.number(odds.times) })
  }
}

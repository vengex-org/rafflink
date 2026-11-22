import type { Dispatch, SetStateAction } from "react"
import { groups, type Group } from "@rafflink/core/domain/groups"
import {
  Segmented,
  StepperField,
  TextField,
  type SegmentOption,
} from "../components/form-fields.tsx"
import { ClockIcon, HeartIcon, LockIcon, StarIcon, UsersIcon } from "../components/icons.tsx"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import { claimTimeText, recentWinnersText, ticketText, whoCanEnterText } from "../lib/rules-text.ts"
import {
  claimPresets,
  claimSecondsOf,
  oddsOf,
  type ClaimPreset,
  type Audience,
  type Ending,
  type Issue,
  type Odds,
  type RecentWinners,
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
        value={values.title}
        error={errorOf(i18n, issue, "title")}
        onChange={(title) => setValues((current) => ({ ...current, title }))}
      />
      <TextField
        name="prize"
        label={t("wizard.prize.label")}
        help={t("wizard.prize.help")}
        type="text"
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
      {values.audience === "subscribers" ? (
        <p className="help" role="note">
          {t("wizard.audience.subscribers.warning")}
        </p>
      ) : null}
      <StepperField
        name="minAccountAgeDays"
        label={t("wizard.minAge.label")}
        help={t("wizard.minAge.help")}
        min={0}
        value={values.minAccountAgeDays}
        error={errorOf(i18n, issue, "minAccountAgeDays")}
        onChange={(minAccountAgeDays) =>
          setValues((current) => ({ ...current, minAccountAgeDays }))
        }
        decreaseLabel={t("wizard.minAge.fewer")}
        increaseLabel={t("wizard.minAge.more")}
      />
      <RecentWinnersField values={values} setValues={setValues} issue={issue} />
      <TicketsField values={values} setValues={setValues} issue={issue} shown={groups} />
      <StepperField
        name="winnerCount"
        label={t("wizard.winners.label")}
        help={t("wizard.winners.help")}
        min={1}
        value={values.winnerCount}
        error={errorOf(i18n, issue, "winnerCount")}
        onChange={(winnerCount) => setValues((current) => ({ ...current, winnerCount }))}
        decreaseLabel={t("winners.fewer")}
        increaseLabel={t("winners.more")}
      />
      <ClaimField values={values} setValues={setValues} issue={issue} />
      <TextField
        name="claimKeyword"
        label={t("wizard.keyword.label")}
        help={t("wizard.keyword.help")}
        type="text"
        value={values.claimKeyword}
        error={errorOf(i18n, issue, "claimKeyword")}
        onChange={(claimKeyword) => setValues((current) => ({ ...current, claimKeyword }))}
      />
    </>
  )
}

/** Off, or a count of the streamer's last giveaways or days whose winners cannot enter. */
function RecentWinnersField({ values, setValues, issue }: StepProps) {
  const i18n = useI18n()
  const { t } = i18n
  const options: readonly SegmentOption<RecentWinners>[] = [
    {
      value: "off",
      label: t("wizard.recent.off"),
      icon: null,
      description: t("wizard.recent.off.help"),
    },
    {
      value: "giveaways",
      label: t("wizard.recent.giveaways"),
      icon: null,
      description: t("wizard.recent.giveaways.help"),
    },
    {
      value: "days",
      label: t("wizard.recent.days"),
      icon: null,
      description: t("wizard.recent.days.help"),
    },
  ]
  return (
    <>
      <Segmented
        name="recentWinners"
        legend={t("wizard.recent.legend")}
        help={null}
        options={options}
        value={values.recentWinners}
        onSelect={(recentWinners) => setValues((current) => ({ ...current, recentWinners }))}
      />
      {values.recentWinners === "off" ? null : (
        <StepperField
          name="excludeRecentWinners.count"
          label={t(`wizard.recent.count.${values.recentWinners}`)}
          help={null}
          min={1}
          value={values.recentWinnersCount}
          error={errorOf(i18n, issue, "excludeRecentWinners.count")}
          onChange={(recentWinnersCount) =>
            setValues((current) => ({ ...current, recentWinnersCount }))
          }
          decreaseLabel={t("wizard.recent.fewer")}
          increaseLabel={t("wizard.recent.more")}
        />
      )}
    </>
  )
}

/** The tickets each group gets; `shown` picks the groups that get a row. */
export function TicketsField({
  values,
  setValues,
  issue,
  shown,
}: StepProps & { readonly shown: readonly Group[] }) {
  const i18n = useI18n()
  const { t } = i18n
  const odds = oddsOf(values.tickets)
  return (
    <fieldset className="field">
      <legend>{t("wizard.tickets.legend")}</legend>
      <p className="help">{t("wizard.tickets.help")}</p>
      <div className="ticket-table">
        {shown.map((group) => (
          <StepperField
            key={group}
            name={`tickets.${group}`}
            label={t(`group.${group}`)}
            help={null}
            min={0}
            value={values.tickets[group]}
            error={errorOf(i18n, issue, `tickets.${group}`)}
            onChange={(count) =>
              setValues((current) => ({
                ...current,
                tickets: { ...current.tickets, [group]: count },
              }))
            }
            decreaseLabel={t("wizard.tickets.fewer", { group: t(`group.${group}`) })}
            increaseLabel={t("wizard.tickets.more", { group: t(`group.${group}`) })}
          />
        ))}
      </div>
      {odds === null ? null : <output className="odds">{oddsText(i18n, odds)}</output>}
    </fieldset>
  )
}

/** The claim time: a preset, or Custom with a minutes stepper under the presets. */
function ClaimField({ values, setValues, issue }: StepProps) {
  const i18n = useI18n()
  const { t } = i18n
  const { claim } = values
  const options: readonly SegmentOption<ClaimPreset | "custom">[] = [
    ...claimPresets.map((seconds) => ({
      value: seconds,
      label: claimTimeText(i18n, seconds),
      icon: null,
      description: "",
    })),
    { value: "custom", label: t("wizard.claim.custom"), icon: null, description: "" },
  ]
  const error = errorOf(i18n, issue, "claimSeconds")
  return (
    <>
      <Segmented
        name="claimSeconds"
        legend={t("wizard.claim.legend")}
        help={null}
        options={options}
        value={claim.kind === "preset" ? claim.seconds : "custom"}
        onSelect={(choice) =>
          setValues((current) => ({
            ...current,
            claim:
              choice === "custom"
                ? { kind: "custom", minutes: String(claimSecondsOf(current.claim) / 60) }
                : { kind: "preset", seconds: choice },
          }))
        }
      />
      {claim.kind === "custom" ? (
        <StepperField
          name="claimMinutes"
          label={t("wizard.claim.minutes")}
          help={null}
          min={1}
          value={claim.minutes}
          error={error}
          onChange={(minutes) =>
            setValues((current) => ({ ...current, claim: { kind: "custom", minutes } }))
          }
          decreaseLabel={t("wizard.claim.fewer")}
          increaseLabel={t("wizard.claim.more")}
        />
      ) : error === null ? null : (
        <p className="field-error">{error}</p>
      )}
    </>
  )
}

export function ReviewStep({ values }: { readonly values: Values }) {
  const i18n = useI18n()
  const { t } = i18n
  const customTickets = groups.filter((group) => values.tickets[group].trim() !== "1")
  const keyword = values.claimKeyword.trim()
  const recent =
    values.recentWinners === "off"
      ? null
      : recentWinnersText(i18n, {
          kind: values.recentWinners,
          count: Number(values.recentWinnersCount),
        })
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
      {recent === null ? null : <ReviewRow label={t("review.recent")} value={recent} />}
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
          time: claimTimeText(i18n, claimSecondsOf(values.claim)),
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

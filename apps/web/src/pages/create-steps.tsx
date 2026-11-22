import type { Dispatch, SetStateAction } from "react"
import { supportedGroups, type Group } from "@rafflink/core/domain/groups"
import { winnerFieldKinds } from "@rafflink/core/domain/winner-form"
import type { PlatformCapabilities } from "@rafflink/core/platform/provider"
import {
  Segmented,
  StepperField,
  TextField,
  type SegmentOption,
} from "../components/form-fields.tsx"
import {
  ClockIcon,
  HeartIcon,
  LinkIcon,
  LockIcon,
  StarIcon,
  TwitchIcon,
  UsersIcon,
} from "../components/icons.tsx"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import {
  claimTimeText,
  oddsText,
  recentWinnersText,
  ticketText,
  whoCanEnterText,
} from "../lib/rules-text.ts"
import { chatEntryReconnectPath, dashboardNewPath } from "../lib/routes.ts"
import { keepDraftForReconnect } from "../lib/wizard-draft.ts"
import { useStreamerSession } from "../components/streamer-session.tsx"
import {
  audienceOffered,
  claimPresets,
  claimSecondsOf,
  entryWaysOffered,
  oddsOf,
  type ClaimPreset,
  type Audience,
  type Ending,
  type EntryWays,
  type Issue,
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
      <OfficialRulesFields values={values} setValues={setValues} issue={issue} />
    </>
  )
}

/** What the generated rules cannot know from the other answers: a minimum age, excluded places, the streamer's own terms. */
function OfficialRulesFields({ values, setValues, issue }: StepProps) {
  const i18n = useI18n()
  const { t } = i18n
  return (
    <fieldset className="field">
      <legend>{t("wizard.official.legend")}</legend>
      <p className="help">{t("wizard.official.help")}</p>
      <StepperField
        name="minAge"
        label={t("wizard.winnerAge.label")}
        help={t("wizard.winnerAge.help")}
        min={1}
        value={values.minAge}
        error={errorOf(i18n, issue, "minAge")}
        onChange={(minAge) => setValues((current) => ({ ...current, minAge }))}
        decreaseLabel={t("wizard.winnerAge.fewer")}
        increaseLabel={t("wizard.winnerAge.more")}
      />
      <TextField
        name="excludedCountries"
        label={t("wizard.excludedCountries.label")}
        help={t("wizard.excludedCountries.help")}
        type="text"
        value={values.excludedCountries}
        error={errorOf(i18n, issue, "excludedCountries")}
        onChange={(excludedCountries) =>
          setValues((current) => ({ ...current, excludedCountries }))
        }
      />
      <TextField
        name="extraTerms"
        label={t("wizard.extraTerms.label")}
        help={t("wizard.extraTerms.help")}
        type="multiline"
        value={values.extraTerms}
        error={errorOf(i18n, issue, "extraTerms")}
        onChange={(extraTerms) => setValues((current) => ({ ...current, extraTerms }))}
      />
    </fieldset>
  )
}

/** What the streamer's platform can check; the step offers only those filters, groups and entry ways. */
interface CapabilitiesProps {
  readonly capabilities: PlatformCapabilities
}

export function RulesStep({
  values,
  setValues,
  issue,
  capabilities,
}: StepProps & CapabilitiesProps) {
  const i18n = useI18n()
  const { t } = i18n
  const allAudiences: readonly SegmentOption<Audience>[] = [
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
  const audiences = allAudiences.filter((option) => audienceOffered(option.value, capabilities))
  return (
    <>
      {audiences.length > 1 ? (
        <Segmented
          name="audience"
          legend={t("wizard.q.audience")}
          help={null}
          options={audiences}
          value={values.audience}
          onSelect={(audience) => setValues((current) => ({ ...current, audience }))}
        />
      ) : null}
      {audiences.length > 1 && values.audience === "subscribers" ? (
        <p className="help" role="note">
          {t("wizard.audience.subscribers.warning")}
        </p>
      ) : null}
      {capabilities.accountAge ? (
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
      ) : null}
      <RecentWinnersField values={values} setValues={setValues} issue={issue} />
      <TicketsField
        values={values}
        setValues={setValues}
        issue={issue}
        shown={supportedGroups(capabilities)}
      />
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
      <EntryWaysField
        values={values}
        setValues={setValues}
        issue={issue}
        capabilities={capabilities}
      />
      <WinnerFormField values={values} setValues={setValues} />
    </>
  )
}

/** The fields the winner fills in after the claim, in the order the form shows them. */
function WinnerFormField({ values, setValues }: Omit<StepProps, "issue">) {
  const { t } = useI18n()
  return (
    <fieldset className="field">
      <legend>{t("wizard.winnerForm.legend")}</legend>
      <p className="help">{t("wizard.winnerForm.help")}</p>
      {winnerFieldKinds.map((kind) => (
        <label key={kind} className="check">
          <input
            type="checkbox"
            name="winnerForm"
            value={kind}
            checked={values.winnerForm.includes(kind)}
            onChange={(event) => {
              const checked = event.currentTarget.checked
              setValues((current) => ({
                ...current,
                winnerForm: winnerFieldKinds.filter((candidate) =>
                  candidate === kind ? checked : current.winnerForm.includes(candidate),
                ),
              }))
            }}
          />
          {t(`winnerField.${kind}`)}
        </label>
      ))}
    </fieldset>
  )
}

/**
 * Page entry, the chat keyword, or both, with the keyword field under the choice. A streamer whose token
 * lacks the scopes chat entry needs is asked to reconnect Twitch, so the follow of a chat entrant can be read.
 */
function EntryWaysField({ values, setValues, issue, capabilities }: StepProps & CapabilitiesProps) {
  const i18n = useI18n()
  const { t } = i18n
  const { streamer } = useStreamerSession()
  const allOptions: readonly SegmentOption<EntryWays>[] = [
    {
      value: "page",
      label: t("wizard.entry.page"),
      icon: <LinkIcon />,
      description: t("wizard.entry.page.help"),
    },
    {
      value: "page-and-chat",
      label: t("wizard.entry.both"),
      icon: <TwitchIcon />,
      description: t("wizard.entry.both.help"),
    },
    {
      value: "chat",
      label: t("wizard.entry.chat"),
      icon: <TwitchIcon />,
      description: t("wizard.entry.chat.help"),
    },
  ]
  const options = allOptions.filter((option) => entryWaysOffered(option.value, capabilities))
  const usesChat = values.entryWays !== "page"
  return (
    <>
      <Segmented
        name="entryWays"
        legend={t("wizard.entry.legend")}
        help={null}
        options={options}
        value={values.entryWays}
        onSelect={(entryWays) => setValues((current) => ({ ...current, entryWays }))}
      />
      {usesChat ? (
        <TextField
          name="chatKeyword"
          label={t("wizard.chatKeyword.label")}
          help={t("wizard.chatKeyword.help")}
          type="text"
          value={values.chatKeyword}
          error={errorOf(i18n, issue, "chatKeyword")}
          onChange={(chatKeyword) => setValues((current) => ({ ...current, chatKeyword }))}
        />
      ) : null}
      {usesChat && streamer !== null && !streamer.chatEntryReady ? (
        <div className="help" role="note">
          <p>{t("wizard.reconnect.text")}</p>
          <a
            className="button outlined"
            href={chatEntryReconnectPath(dashboardNewPath({ step: 2 }))}
            onClick={() => keepDraftForReconnect(values)}
          >
            <TwitchIcon />
            {t("wizard.reconnect.button")}
          </a>
        </div>
      ) : null}
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
  const odds = oddsOf(values.tickets, shown)
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

export function ReviewStep({
  values,
  capabilities,
}: { readonly values: Values } & CapabilitiesProps) {
  const i18n = useI18n()
  const { t } = i18n
  const customTickets = supportedGroups(capabilities).filter(
    (group) => values.tickets[group].trim() !== "1",
  )
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
          Number(values.tickets.viewer) === 0,
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
      <ReviewRow label={t("review.entry")} value={entryWaysText(i18n, values)} />
      <ReviewRow label={t("review.winners")} value={i18n.number(Number(values.winnerCount))} />
      {values.minAge.trim() === "" ? null : (
        <ReviewRow
          label={t("review.winnerAge")}
          value={i18n.plural("year", Number(values.minAge))}
        />
      )}
      {values.excludedCountries.trim() === "" ? null : (
        <ReviewRow label={t("review.excludedCountries")} value={values.excludedCountries.trim()} />
      )}
      {values.extraTerms.trim() === "" ? null : (
        <ReviewRow label={t("review.extraTerms")} value={values.extraTerms.trim()} />
      )}
      <ReviewRow
        label={t("review.claim")}
        value={t("review.claimText", {
          time: claimTimeText(i18n, claimSecondsOf(values.claim)),
          chat: keyword === "" ? t("review.anyChat") : t("review.keywordChat", { keyword }),
        })}
      />
      {values.winnerForm.length === 0 ? null : (
        <ReviewRow
          label={t("wizard.winnerForm.legend")}
          value={values.winnerForm.map((kind) => t(`winnerField.${kind}`)).join(", ")}
        />
      )}
    </dl>
  )
}

function entryWaysText(i18n: I18n, values: Values): string {
  const keyword = values.chatKeyword.trim()
  switch (values.entryWays) {
    case "page":
      return i18n.t("review.entryPage")
    case "page-and-chat":
      return i18n.t("review.entryBoth", { keyword })
    case "chat":
      return i18n.t("review.entryChat", { keyword })
  }
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

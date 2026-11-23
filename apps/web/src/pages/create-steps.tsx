import { useId, useState, type Dispatch, type ReactNode, type SetStateAction } from "react"
import type { Group } from "@rafflink/core/domain/groups"
import type { StreamerFeature } from "@rafflink/core/domain/streamer-features"
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
  LogInIcon,
  StarIcon,
  TagIcon,
  TwitchIcon,
  UsersIcon,
} from "../components/icons.tsx"
import { Disclosure } from "../components/disclosure.tsx"
import { InfoTip } from "../components/info-tip.tsx"
import { Notice } from "../components/notice.tsx"
import type { PointsRewardsJson } from "@rafflink/core/http/json"
import { getPointsRewards, getRequestBudget, getYouTubeBudget } from "../api/client.ts"
import { useI18n, type I18n } from "../i18n/i18n.tsx"
import {
  claimTimeText,
  oddsText,
  recentWinnersText,
  ticketText,
  whoCanEnterText,
} from "../lib/rules-text.ts"
import { dashboardNewPath, featureReconnectPath } from "../lib/routes.ts"
import { useLoad } from "../lib/use-load.ts"
import { keepDraftForReconnect } from "../lib/wizard-draft.ts"
import { useStreamerSession } from "../components/streamer-session.tsx"
import { platformNames } from "../lib/platform-name.ts"
import {
  audienceOffered,
  claimPresets,
  claimSecondsOf,
  entryWaysOffered,
  initialValues,
  missingFeatures,
  neededFeatures,
  oddsOf,
  ticketGroups,
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
        help={null}
        optional
        placeholder={t("wizard.title.placeholder")}
        type="text"
        value={values.title}
        error={errorOf(i18n, issue, "title")}
        onChange={(title) => setValues((current) => ({ ...current, title }))}
      />
      <TextField
        name="prize"
        label={t("wizard.prize.label")}
        help={null}
        optional
        placeholder={t("wizard.prize.placeholder")}
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

const officialFields = ["minAge", "excludedCountries", "extraTerms"] as const

function flaggedBy(problem: Issue | null): boolean {
  return officialFields.some((field) => problem?.field === field)
}

/**
 * What the generated rules cannot know from the other answers: a minimum age, excluded places, the streamer's own
 * terms. Few giveaways need them, so the section starts closed unless one is filled in or has a problem to fix.
 */
function OfficialRulesFields({ values, setValues, issue }: StepProps) {
  const i18n = useI18n()
  const { t } = i18n
  const [open, setOpen] = useState(
    () => flaggedBy(issue) || officialFields.some((field) => values[field].trim() !== ""),
  )
  // A new problem in one of these fields opens the section; the streamer can still close it afterwards.
  const [seenIssue, setSeenIssue] = useState(issue)
  if (issue !== seenIssue) {
    setSeenIssue(issue)
    if (flaggedBy(issue)) setOpen(true)
  }
  return (
    <Disclosure
      icon={<TagIcon />}
      summary={t("wizard.official.legend")}
      open={open}
      onToggle={setOpen}
    >
      <p className="help official-intro">{t("wizard.official.help")}</p>
      <StepperField
        name="minAge"
        label={t("wizard.winnerAge.label")}
        help={null}
        info={t("wizard.winnerAge.info")}
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
        placeholder={t("wizard.excludedCountries.placeholder")}
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
    </Disclosure>
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
      <WizardGroup title={t("wizard.group.entry")}>
        <EntryWaysField
          values={values}
          setValues={setValues}
          issue={issue}
          capabilities={capabilities}
        />
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
          <Notice tone="warning">
            <p>
              {t("wizard.audience.subscribers.warning")}{" "}
              <InfoTip
                topic={t("wizard.audience.subscribers")}
                text={t("wizard.audience.subscribers.info")}
              />
            </p>
          </Notice>
        ) : null}
      </WizardGroup>
      <WizardGroup title={t("wizard.group.odds")}>
        <TicketsField
          values={values}
          setValues={setValues}
          issue={issue}
          shown={ticketGroups(values, capabilities)}
        />
        <FeaturesReconnectNote values={values} issue={issue} />
        <RecentWinnersField values={values} setValues={setValues} issue={issue} />
        {capabilities.accountAge ? (
          <StepperField
            name="minAccountAgeDays"
            label={t("wizard.minAge.label")}
            help={t("wizard.minAge.help")}
            optional
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
      </WizardGroup>
      <WizardGroup title={t("wizard.group.winners")}>
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
          optional
          type="text"
          value={values.claimKeyword}
          error={errorOf(i18n, issue, "claimKeyword")}
          onChange={(claimKeyword) => setValues((current) => ({ ...current, claimKeyword }))}
        />
        <WinnerFormField values={values} setValues={setValues} />
      </WizardGroup>
    </>
  )
}

/** A titled part of a step: the rules step splits its fields into who enters, the odds, and the winners. */
function WizardGroup({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  const id = useId()
  return (
    <section className="wizard-group" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  )
}

/** The fields the winner fills in after the claim, in the order the form shows them. */
function WinnerFormField({ values, setValues }: Omit<StepProps, "issue">) {
  const { t } = useI18n()
  return (
    <fieldset className="field">
      <legend>{t("wizard.winnerForm.legend")}</legend>
      <p className="help">
        {t("wizard.winnerForm.help")}{" "}
        <InfoTip topic={t("wizard.winnerForm.legend")} text={t("wizard.winnerForm.info")} />
      </p>
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
 * Page entry, the chat keyword, or both, with the keyword field under the choice, then the entries that come
 * by themselves: subs and a channel point reward. Page or chat is always one of the choices, so sub and points
 * entry never stand alone. A streamer whose token lacks the scopes of a way they use is asked to reconnect Twitch.
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
  // Twitch gives subs and channel points to Affiliates and Partners only; the reward list says which a channel is.
  const { result } = useLoad(getPointsRewards)
  const rewards = result.state === "ready" && result.value !== "unauthorized" ? result.value : null
  const offersSupport = rewards !== null && rewards.kind !== "no-channel-points"
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
          info={t("wizard.chatKeyword.info")}
          type="text"
          value={values.chatKeyword}
          error={errorOf(i18n, issue, "chatKeyword")}
          onChange={(chatKeyword) => setValues((current) => ({ ...current, chatKeyword }))}
        />
      ) : null}
      {usesChat && streamer?.platform === "kick" ? <KickChatCostNote /> : null}
      {usesChat && streamer?.platform === "youtube" ? (
        <YouTubeQuotaNote closedByHand={values.ending === "never"} />
      ) : null}
      {offersSupport && (capabilities.subEntry || capabilities.pointsEntry) ? (
        <fieldset className="field">
          <legend>{t("wizard.autoEntry.legend")}</legend>
          {capabilities.subEntry ? (
            <>
              <div className="field-head">
                <label className="check">
                  <input
                    type="checkbox"
                    name="subEntry"
                    checked={values.subEntry}
                    onChange={(event) => {
                      const subEntry = event.currentTarget.checked
                      setValues((current) => ({ ...current, subEntry }))
                    }}
                  />
                  {t("wizard.subEntry.label")}
                </label>
                <InfoTip
                  topic={t("wizard.subEntry.label")}
                  text={t(
                    streamer?.platform === "kick"
                      ? "wizard.subEntry.info.kick"
                      : "wizard.subEntry.info",
                  )}
                />
              </div>
              <p className="help">{t("wizard.subEntry.help")}</p>
            </>
          ) : null}
          {capabilities.pointsEntry && rewards !== null ? (
            <PointsRewardField values={values} setValues={setValues} rewards={rewards} />
          ) : null}
        </fieldset>
      ) : null}
      {errorOf(i18n, issue, "subEntry") === null ? null : (
        <p className="field-error">{errorOf(i18n, issue, "subEntry")}</p>
      )}
    </>
  )
}

/**
 * The reward whose redemption enters, picked from the streamer's rewards. Hidden for a channel without
 * channel points; a token without the points scopes is asked to reconnect before the list can be read.
 */
function PointsRewardField({
  values,
  setValues,
  rewards: answer,
}: Omit<StepProps, "issue"> & { readonly rewards: PointsRewardsJson }) {
  const { t } = useI18n()
  const { streamer } = useStreamerSession()
  switch (answer.kind) {
    case "no-channel-points":
      return null
    case "reconnect":
      return (
        <ReconnectNote
          reasons={[
            t(
              streamer?.platform === "kick"
                ? "wizard.reconnect.points.info.kick"
                : "wizard.reconnect.redemptions.info",
            ),
          ]}
          features={[...neededFeatures(values), "redemptions"]}
          values={values}
        />
      )
    case "rewards": {
      if (answer.rewards.length === 0) {
        return (
          <Notice tone="info">
            <p>{t("wizard.points.none")}</p>
          </Notice>
        )
      }
      const options: readonly SegmentOption<string>[] = [
        { value: "", label: t("wizard.points.off"), icon: null, description: "" },
        ...answer.rewards.map((reward) => ({
          value: reward.id,
          label: reward.title,
          icon: null,
          description: t("wizard.points.selected"),
        })),
      ]
      return (
        <Segmented
          name="pointsReward"
          legend={t("wizard.points.legend")}
          help={t("wizard.points.help")}
          options={options}
          value={values.pointsReward?.id ?? ""}
          onSelect={(id) => {
            const pointsReward = answer.rewards.find((reward) => reward.id === id) ?? null
            setValues((current) => ({ ...current, pointsReward }))
          }}
        />
      )
    }
  }
}

/**
 * Kick sends every chat message of the channel as a webhook, each one a Worker request, so a chat entry
 * giveaway on a plan with a daily cap shows that cap and what is left of it today. Hidden without a cap.
 */
function KickChatCostNote() {
  const i18n = useI18n()
  const { result } = useLoad(getRequestBudget)
  const budget =
    result.state === "ready" && result.value !== "unauthorized" ? result.value.budget : null
  if (budget === null) return null
  return (
    <Notice tone="info">
      <p>
        {i18n.t("wizard.chatCost.kick", {
          remaining: i18n.number(Math.max(0, budget.remaining)),
        })}{" "}
        <InfoTip
          topic={i18n.t("wizard.chatCost.topic")}
          text={i18n.t("wizard.chatCost.kick.info", { limit: i18n.number(budget.limit) })}
        />
      </p>
    </Notice>
  )
}

/**
 * Rafflink reads a YouTube chat by polling, and every read spends the install's daily YouTube units, so a
 * YouTube giveaway shows what a minute of reading costs and what is left today. A giveaway closed by hand
 * has no end the server can check its units against, so it says how many minutes today's units cover.
 */
function YouTubeQuotaNote({ closedByHand }: { readonly closedByHand: boolean }) {
  const i18n = useI18n()
  const { result } = useLoad(getYouTubeBudget)
  const budget = result.state === "ready" && result.value !== "unauthorized" ? result.value : null
  if (budget === null) return null
  const math = i18n.t("wizard.chatCost.youtube.info", {
    perMinute: i18n.number(budget.unitsPerMinute),
    winnerPerMinute: i18n.number(budget.winnerUnitsPerMinute),
    limit: i18n.number(budget.limit),
  })
  const byHand = i18n.t("wizard.chatCost.youtubeByHand", {
    minutes: i18n.number(Math.max(0, Math.floor(budget.remaining / budget.unitsPerMinute))),
  })
  return (
    <Notice tone="info">
      <p>
        {i18n.t("wizard.chatCost.youtube", {
          remaining: i18n.number(Math.max(0, budget.remaining)),
        })}{" "}
        <InfoTip
          topic={i18n.t("wizard.chatCost.topic")}
          text={closedByHand ? `${math} ${byHand}` : math}
        />
      </p>
    </Notice>
  )
}

/**
 * The rules that need a scope the token lacks, a follower rule or VIP tickets for example, ask to reconnect
 * once for all of them. The reward list asks for its own scope, so channel points are left to it.
 */
function FeaturesReconnectNote({ values, issue }: Pick<StepProps, "values" | "issue">) {
  const i18n = useI18n()
  const { streamer } = useStreamerSession()
  if (streamer === null) return null
  const missing = missingFeatures(values, streamer.grantedFeatures).filter(
    (feature) => feature !== "redemptions",
  )
  if (missing.length === 0) return null
  return (
    <>
      <ReconnectNote
        reasons={missing.map((feature) => i18n.t(`wizard.reconnect.${feature}.info`))}
        features={neededFeatures(values)}
        values={values}
      />
      {errorOf(i18n, issue, "reconnect") === null ? null : (
        <p className="field-error">{errorOf(i18n, issue, "reconnect")}</p>
      )}
    </>
  )
}

/**
 * Asks the streamer to sign in again with the scopes of `features`, with what each scope is for behind the (i);
 * the answers wait in session storage meanwhile.
 */
function ReconnectNote({
  reasons,
  features,
  values,
}: {
  readonly reasons: readonly string[]
  readonly features: readonly StreamerFeature[]
  readonly values: Values
}) {
  const { t } = useI18n()
  const { streamer } = useStreamerSession()
  const platform = streamer?.platform ?? "twitch"
  const button = t("wizard.reconnect.button", { platform: platformNames[platform] })
  return (
    <Notice tone="warning">
      <p>
        {t("wizard.reconnect.text", { platform: platformNames[platform] })}{" "}
        <InfoTip topic={button} text={reasons.join(" ")} />
      </p>
      <div className="notice-action">
        <a
          className="button outlined"
          href={featureReconnectPath(platform, features, dashboardNewPath({ step: 2 }))}
          onClick={() => keepDraftForReconnect(values)}
        >
          <LogInIcon />
          {button}
        </a>
      </div>
    </Notice>
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

/**
 * The tickets each group gets, behind a Bonus tickets switch; `shown` picks the groups that get a row.
 * Switching it off puts every group back to the default tickets.
 */
export function TicketsField({
  values,
  setValues,
  issue,
  shown,
}: StepProps & { readonly shown: readonly Group[] }) {
  const i18n = useI18n()
  const { t } = i18n
  const on = values.bonusTickets
  const odds = oddsOf(values.tickets, shown)
  return (
    <div className="field">
      <label className="check bonus-toggle">
        <input
          type="checkbox"
          name="bonusTickets"
          checked={on}
          onChange={(event) => {
            const bonusTickets = event.currentTarget.checked
            setValues((current) => ({
              ...current,
              bonusTickets,
              tickets: bonusTickets ? current.tickets : initialValues.tickets,
            }))
          }}
        />
        {t("wizard.tickets.legend")}
      </label>
      <p className="help">{t("wizard.tickets.help")}</p>
      {on ? <TicketRows values={values} setValues={setValues} issue={issue} shown={shown} /> : null}
      {on && odds !== null && odds.kind !== "same" ? (
        <output className="odds">{oddsText(i18n, odds)}</output>
      ) : null}
    </div>
  )
}

function TicketRows({
  values,
  setValues,
  issue,
  shown,
}: StepProps & { readonly shown: readonly Group[] }) {
  const i18n = useI18n()
  const { t } = i18n
  return (
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
  const customTickets = ticketGroups(values, capabilities).filter(
    (group) => values.tickets[group].trim() !== "1",
  )
  const keyword = values.claimKeyword.trim()
  const recent =
    values.recentWinners === "off"
      ? null
      : recentWinnersText(
          i18n,
          { kind: values.recentWinners, count: Number(values.recentWinnersCount) },
          { kind: "own" },
        )
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
      {values.subEntry || values.pointsReward !== null ? (
        <ReviewRow
          label={t("wizard.autoEntry.legend")}
          value={[
            ...(values.subEntry ? [t("review.subEntry")] : []),
            ...(values.pointsReward === null
              ? []
              : [t("review.pointsEntry", { reward: values.pointsReward.title })]),
          ].join(" ")}
        />
      ) : null}
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

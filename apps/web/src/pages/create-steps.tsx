import type { Dispatch, SetStateAction } from "react"
import { groups } from "@rafflink/core/domain/groups"
import { Segmented, TextField, type SegmentOption } from "../components/form-fields.tsx"
import { groupLabel } from "../lib/messages.ts"
import { claimTimeText, ticketText, whoCanEnterText } from "../lib/rules-text.ts"
import {
  claimPresets,
  type Audience,
  type ClaimPreset,
  type Ending,
  type Issue,
  type Values,
} from "./create-values.ts"

interface StepProps {
  readonly values: Values
  readonly setValues: Dispatch<SetStateAction<Values>>
  readonly issue: Issue | null
}

function errorOf(issue: Issue | null, field: string): string | null {
  return issue?.field === field ? issue.message : null
}

export function GiveawayStep({ values, setValues, issue }: StepProps) {
  return (
    <>
      <TextField
        name="title"
        label="Giveaway name (optional)"
        help="Viewers see this at the top of the page. Example: Friday gaming chair giveaway. Leave it empty and they see the giveaway code instead."
        type="text"
        min={null}
        value={values.title}
        error={errorOf(issue, "title")}
        onChange={(title) => setValues((current) => ({ ...current, title }))}
      />
      <TextField
        name="prize"
        label="What does the winner get? (optional)"
        help="Example: A gaming chair, or a 25 euro Steam card"
        type="text"
        min={null}
        value={values.prize}
        error={errorOf(issue, "prize")}
        onChange={(prize) => setValues((current) => ({ ...current, prize }))}
      />
    </>
  )
}

const audiences: readonly SegmentOption<Audience>[] = [
  {
    value: "everyone",
    label: "Everyone",
    description: "Any viewer with a Twitch account can enter.",
  },
  {
    value: "followers",
    label: "Followers only",
    description: "Only people who follow your channel can enter.",
  },
  {
    value: "subscribers",
    label: "Subscribers only",
    description: "Only your paying subscribers can enter.",
  },
]

const endings: readonly SegmentOption<Ending>[] = [
  {
    value: "never",
    label: "When I close them",
    description: "Entries stay open until you press Close entries.",
  },
  {
    value: "at-time",
    label: "At a set time",
    description: "Entries close by themselves at the time you pick.",
  },
]

const claimOptions: readonly SegmentOption<ClaimPreset>[] = claimPresets.map((seconds) => ({
  value: seconds,
  label: claimTimeText(seconds),
  description: "",
}))

export function AudienceStep({ values, setValues, issue }: StepProps) {
  return (
    <>
      <Segmented
        name="audience"
        legend="Who can enter?"
        help={null}
        options={audiences}
        value={values.audience}
        onSelect={(audience) => setValues((current) => ({ ...current, audience }))}
      />
      <TextField
        name="minAccountAgeDays"
        label="Minimum account age in days (optional)"
        help="Stops people from making fresh accounts just to enter. Leave it empty to allow any account."
        type="number"
        min={0}
        value={values.minAccountAgeDays}
        error={errorOf(issue, "minAccountAgeDays")}
        onChange={(minAccountAgeDays) =>
          setValues((current) => ({ ...current, minAccountAgeDays }))
        }
      />
      <details className="extra" open={issue?.field.startsWith("tickets.") === true}>
        <summary>Extra tickets (optional)</summary>
        <p className="help">
          Every group gets 1 ticket. More tickets mean a better chance of winning, for example 3 for
          subscribers. Leave this as it is if everyone should have the same chance.
        </p>
        {groups.map((group) => (
          <TextField
            key={group}
            name={`tickets.${group}`}
            label={groupLabel[group]}
            help={null}
            type="number"
            min={0}
            value={values.tickets[group]}
            error={errorOf(issue, `tickets.${group}`)}
            onChange={(count) =>
              setValues((current) => ({
                ...current,
                tickets: { ...current.tickets, [group]: count },
              }))
            }
          />
        ))}
      </details>
    </>
  )
}

export function TimingStep({ values, setValues, issue }: StepProps) {
  return (
    <>
      <Segmented
        name="ending"
        legend="When do entries end?"
        help={null}
        options={endings}
        value={values.ending}
        onSelect={(ending) => setValues((current) => ({ ...current, ending }))}
      />
      {values.ending === "at-time" ? (
        <TextField
          name="closesAt"
          label="Entries end at"
          help="This uses the time zone of this device."
          type="datetime-local"
          min={null}
          value={values.closesAt}
          error={errorOf(issue, "closesAt")}
          onChange={(closesAt) => setValues((current) => ({ ...current, closesAt }))}
        />
      ) : null}
      <Segmented
        name="claimSeconds"
        legend="How long does a winner have to claim the prize?"
        help="Most streams use 5 minutes."
        options={claimOptions}
        value={values.claimSeconds}
        onSelect={(claimSeconds) => setValues((current) => ({ ...current, claimSeconds }))}
      />
      <TextField
        name="claimKeyword"
        label="Chat word (optional)"
        help="A winner can also claim by typing this word in your chat. Leave it empty and any chat message from the winner counts."
        type="text"
        min={null}
        value={values.claimKeyword}
        error={errorOf(issue, "claimKeyword")}
        onChange={(claimKeyword) => setValues((current) => ({ ...current, claimKeyword }))}
      />
    </>
  )
}

export function ReviewStep({ values }: { readonly values: Values }) {
  const customTickets = groups.filter((group) => values.tickets[group].trim() !== "1")
  const keyword = values.claimKeyword.trim()
  return (
    <dl className="review">
      <ReviewRow label="Name" value={textOrNotSet(values.title)} />
      <ReviewRow label="Prize" value={textOrNotSet(values.prize)} />
      <ReviewRow
        label="Who can enter"
        value={whoCanEnterText(values.audience === "subscribers", values.audience === "followers")}
      />
      <ReviewRow
        label="Tickets"
        value={
          customTickets.length === 0
            ? "Everyone gets 1 ticket."
            : customTickets
                .map(
                  (group) => `${groupLabel[group]}: ${ticketText(Number(values.tickets[group]))}`,
                )
                .join(", ")
        }
      />
      {values.minAccountAgeDays.trim() === "" ? null : (
        <ReviewRow
          label="Account age"
          value={`Accounts must be at least ${Number(values.minAccountAgeDays)} days old.`}
        />
      )}
      <ReviewRow
        label="Entries end"
        value={
          values.ending === "never"
            ? "When you close them."
            : new Date(values.closesAt).toLocaleString()
        }
      />
      <ReviewRow
        label="Time to claim"
        value={`${claimTimeText(values.claimSeconds)}. ${
          keyword === ""
            ? "Any chat message from the winner also counts."
            : `The winner can also type "${keyword}" in your chat.`
        }`}
      />
    </dl>
  )
}

function textOrNotSet(text: string): string {
  return text.trim() === "" ? "Not set" : text
}

function ReviewRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

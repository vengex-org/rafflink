import { useId, useState, type FormEvent } from "react"
import { groups, type Group } from "@rafflink/core/domain/groups"
import { createGiveaway, type CreateGiveawayBody, type CreateResult } from "../api/client.ts"
import { groupLabel, issueText } from "../lib/messages.ts"
import { errorClass } from "../lib/use-load.ts"

type Created = Extract<CreateResult, { kind: "created" }>
type Invalid = Extract<CreateResult, { kind: "invalid" }>

interface Values {
  title: string
  prize: string
  tickets: Record<Group, string>
  subsOnly: boolean
  followersOnly: boolean
  minAccountAgeDays: string
  closesAt: string
  claimSeconds: string
  claimKeyword: string
}

const initialValues: Values = {
  title: "",
  prize: "",
  tickets: {
    viewer: "1",
    follower: "1",
    sub_t1: "1",
    sub_t2: "1",
    sub_t3: "1",
    vip: "1",
    moderator: "1",
  },
  subsOnly: false,
  followersOnly: false,
  minAccountAgeDays: "",
  closesAt: "",
  claimSeconds: "",
  claimKeyword: "",
}

/** Creates a giveaway; the server's first complaint is shown at its field. */
export function CreateForm({
  onCreated,
  onUnauthorized,
}: {
  readonly onCreated: (created: Created) => void
  readonly onUnauthorized: () => void
}) {
  const [values, setValues] = useState(initialValues)
  const [invalid, setInvalid] = useState<Invalid | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFailed(false)
    try {
      const result = await createGiveaway(toBody(values))
      setInvalid(result.kind === "invalid" ? result : null)
      if (result.kind === "created") onCreated(result)
      if (result.kind === "unauthorized") onUnauthorized()
    } catch (error) {
      console.error("create failed", { errorClass: errorClass(error) })
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate aria-labelledby="create-title">
      <h2 id="create-title">New giveaway</h2>
      {invalid === null ? null : (
        <p role="alert">
          {fieldTitle(invalid.field)}: {issueText[invalid.code]}
        </p>
      )}
      <TextInput
        name="title"
        label="Title"
        value={values.title}
        invalid={invalid}
        onChange={(title) => setValues({ ...values, title })}
      />
      <TextInput
        name="prize"
        label="Prize"
        value={values.prize}
        invalid={invalid}
        onChange={(prize) => setValues({ ...values, prize })}
      />
      <fieldset>
        <legend>Tickets per group</legend>
        {groups.map((group) => (
          <TextInput
            key={group}
            name={`tickets.${group}`}
            label={groupLabel[group]}
            type="number"
            value={values.tickets[group]}
            invalid={invalid}
            onChange={(count) =>
              setValues({ ...values, tickets: { ...values.tickets, [group]: count } })
            }
          />
        ))}
      </fieldset>
      <fieldset>
        <legend>Who can enter</legend>
        <Check
          label="Subscribers only"
          checked={values.subsOnly}
          onChange={(subsOnly) => setValues({ ...values, subsOnly })}
        />
        <Check
          label="Followers only"
          checked={values.followersOnly}
          onChange={(followersOnly) => setValues({ ...values, followersOnly })}
        />
        <TextInput
          name="minAccountAgeDays"
          label="Minimum account age in days"
          type="number"
          value={values.minAccountAgeDays}
          invalid={invalid}
          onChange={(minAccountAgeDays) => setValues({ ...values, minAccountAgeDays })}
        />
      </fieldset>
      <TextInput
        name="closesAt"
        label="Entries end (optional)"
        type="datetime-local"
        value={values.closesAt}
        invalid={invalid}
        onChange={(closesAt) => setValues({ ...values, closesAt })}
      />
      <TextInput
        name="claimSeconds"
        label="Seconds to claim (empty uses the default, 300)"
        type="number"
        value={values.claimSeconds}
        invalid={invalid}
        onChange={(claimSeconds) => setValues({ ...values, claimSeconds })}
      />
      <TextInput
        name="claimKeyword"
        label="Claim keyword (optional, empty accepts any chat message)"
        value={values.claimKeyword}
        invalid={invalid}
        onChange={(claimKeyword) => setValues({ ...values, claimKeyword })}
      />
      <button type="submit" disabled={busy}>
        Create giveaway
      </button>
      {failed ? <p role="alert">Something went wrong. Try again.</p> : null}
    </form>
  )
}

function toBody(values: Values): CreateGiveawayBody {
  return {
    title: values.title,
    prize: values.prize,
    rules: {
      tickets: {
        viewer: numberOrUndefined(values.tickets.viewer),
        follower: numberOrUndefined(values.tickets.follower),
        sub_t1: numberOrUndefined(values.tickets.sub_t1),
        sub_t2: numberOrUndefined(values.tickets.sub_t2),
        sub_t3: numberOrUndefined(values.tickets.sub_t3),
        vip: numberOrUndefined(values.tickets.vip),
        moderator: numberOrUndefined(values.tickets.moderator),
      },
      subsOnly: values.subsOnly,
      followersOnly: values.followersOnly,
      minAccountAgeDays: numberOrUndefined(values.minAccountAgeDays),
      claimKeyword: values.claimKeyword,
    },
    closesAt: instantOrUndefined(values.closesAt),
    claimSeconds: numberOrUndefined(values.claimSeconds),
  }
}

function numberOrUndefined(text: string): number | undefined {
  return text.trim() === "" ? undefined : Number(text)
}

// A datetime-local value has no zone; the browser reads it in the streamer's own zone.
function instantOrUndefined(text: string): string | undefined {
  if (text === "") return undefined
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? text : date.toISOString()
}

function fieldTitle(field: string): string {
  return field.replace(/^tickets\./, "tickets ")
}

function TextInput({
  name,
  label,
  value,
  invalid,
  onChange,
  type = "text",
}: {
  readonly name: string
  readonly label: string
  readonly value: string
  readonly invalid: Invalid | null
  readonly onChange: (value: string) => void
  readonly type?: "text" | "number" | "datetime-local"
}) {
  const id = useId()
  const problem = invalid?.field === name ? issueText[invalid.code] : null
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        aria-invalid={problem !== null}
        aria-describedby={problem === null ? undefined : `${id}-error`}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {problem === null ? null : (
        <p id={`${id}-error`} className="field-error">
          {problem}
        </p>
      )}
    </div>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
  )
}

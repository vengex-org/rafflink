import { useEffect, useRef, useState, type FormEvent } from "react"
import { createGiveaway, type CreateResult } from "../api/client.ts"
import { StepIndicator } from "../components/step-indicator.tsx"
import { issueText } from "../lib/messages.ts"
import { errorClass } from "../lib/use-load.ts"
import { AudienceStep, GiveawayStep, ReviewStep, TimingStep } from "./create-steps.tsx"
import {
  initialValues,
  stepIssue,
  stepOfField,
  toBody,
  type Issue,
  type Step,
} from "./create-values.ts"

type Created = Extract<CreateResult, { kind: "created" }>

const stepNames = ["What you give away", "Who can enter", "When it ends", "Review"] as const

const stepQuestions: Readonly<Record<Step, string>> = {
  1: "What are you giving away?",
  2: "Who can enter?",
  3: "When does it end?",
  4: "Check your giveaway",
}

/** Creates a giveaway in four steps; each step is checked before the next, and the server's complaint sends the streamer back to its step. */
export function CreateForm({
  onCreated,
  onUnauthorized,
  onCancel,
}: {
  readonly onCreated: (created: Created) => void
  readonly onUnauthorized: () => void
  readonly onCancel: () => void
}) {
  const [values, setValues] = useState(initialValues)
  const [step, setStep] = useState<Step>(1)
  const [issue, setIssue] = useState<Issue | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (step !== 4) {
      const problem = stepIssue(step, values, Date.now())
      setIssue(problem)
      if (problem === null) setStep(following(step))
      return
    }
    setBusy(true)
    setFailed(false)
    try {
      const result = await createGiveaway(toBody(values))
      switch (result.kind) {
        case "created":
          setIssue(null)
          onCreated(result)
          return
        case "invalid":
          setIssue({ field: result.field, message: issueText[result.code] })
          setStep(stepOfField(result.field))
          return
        case "unauthorized":
          onUnauthorized()
          return
      }
    } catch (error) {
      console.error("create failed", { errorClass: errorClass(error) })
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="card wizard"
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-labelledby="wizard-title"
    >
      <StepIndicator steps={stepNames} current={step} />
      <StepHeading key={step} text={stepQuestions[step]} />
      {issue === null ? null : (
        <p role="alert" className="form-alert">
          Please fix this to continue.
        </p>
      )}
      {step === 1 ? <GiveawayStep values={values} setValues={setValues} issue={issue} /> : null}
      {step === 2 ? <AudienceStep values={values} setValues={setValues} issue={issue} /> : null}
      {step === 3 ? <TimingStep values={values} setValues={setValues} issue={issue} /> : null}
      {step === 4 ? <ReviewStep values={values} /> : null}
      {step === 4 && issue !== null ? <p className="field-error">{issue.message}</p> : null}
      {failed ? (
        <p role="alert" className="form-alert">
          Something went wrong. Try again.
        </p>
      ) : null}
      <div className="actions wizard-actions">
        {step === 1 ? (
          <button type="button" className="button text" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button
            key="back"
            type="button"
            className="button text"
            onClick={() => {
              setIssue(null)
              setStep(previous(step))
            }}
          >
            Back
          </button>
        )}
        {step === 4 ? (
          <button key="start" type="submit" className="button" disabled={busy}>
            {busy ? "Starting…" : "Start giveaway"}
          </button>
        ) : (
          <button key="next" type="submit" className="button">
            Next
          </button>
        )}
      </div>
    </form>
  )
}

// Focus moves when the step changes (a new `key` mounts a new heading), never on a render caused by typing.
function StepHeading({ text }: { readonly text: string }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <h2 id="wizard-title" tabIndex={-1} ref={heading}>
      {text}
    </h2>
  )
}

function following(step: Exclude<Step, 4>): Step {
  switch (step) {
    case 1:
      return 2
    case 2:
      return 3
    case 3:
      return 4
  }
}

function previous(step: Exclude<Step, 1>): Step {
  switch (step) {
    case 2:
      return 1
    case 3:
      return 2
    case 4:
      return 3
  }
}

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { createGiveaway, type CreateResult } from "../api/client.ts"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CloseIcon,
  GiftIcon,
  PlayIcon,
  UsersIcon,
} from "../components/icons.tsx"
import { StepIndicator } from "../components/step-indicator.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { errorClass } from "@rafflink/core/lib/error-class"
import { BasicsStep, ReviewStep, RulesStep } from "./create-steps.tsx"
import {
  stepIssue,
  stepOfField,
  toBody,
  type Issue,
  type Step,
  type Values,
} from "./create-values.ts"

type Created = Extract<CreateResult, { kind: "created" }>

const stepNames = ["wizard.step.basics", "wizard.step.rules", "wizard.step.review"] as const

/** Creates a giveaway in three steps; each step is checked before the next, and the server's complaint sends the streamer back to its step. */
export function CreateForm({
  seed,
  onCreated,
  onUnauthorized,
  onCancel,
}: {
  /** The answers the form starts with. */
  readonly seed: Values
  readonly onCreated: (created: Created) => void
  readonly onUnauthorized: () => void
  readonly onCancel: () => void
}) {
  const { t } = useI18n()
  const [values, setValues] = useState(seed)
  const [step, setStep] = useState<Step>(1)
  const [issue, setIssue] = useState<Issue | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (step !== 3) {
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
          setIssue({ field: result.field, message: `issue.${result.code}` })
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
      <div className="wizard-body">
        <StepHeading key={step} icon={stepIcon(step)} text={t(stepQuestion(step))} />
        {issue === null ? null : (
          <p role="alert" className="form-alert">
            {t("wizard.fix")}
          </p>
        )}
        {step === 1 ? <BasicsStep values={values} setValues={setValues} issue={issue} /> : null}
        {step === 2 ? <RulesStep values={values} setValues={setValues} issue={issue} /> : null}
        {step === 3 ? <ReviewStep values={values} /> : null}
        {step === 3 && issue !== null ? <p className="field-error">{t(issue.message)}</p> : null}
        {failed ? (
          <p role="alert" className="form-alert">
            {t("action.failed")}
          </p>
        ) : null}
        <div className="actions wizard-actions">
          {step === 1 ? (
            <button type="button" className="button text" onClick={onCancel}>
              <CloseIcon />
              {t("common.cancel")}
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
              <ArrowLeftIcon />
              {t("common.back")}
            </button>
          )}
          {step === 3 ? (
            <button key="start" type="submit" className="button" disabled={busy}>
              <PlayIcon />
              {busy ? t("wizard.starting") : t("wizard.start")}
            </button>
          ) : (
            <button key="next" type="submit" className="button">
              {t("common.next")}
              <ArrowRightIcon />
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

// Focus moves when the step changes (a new `key` mounts a new heading), never on a render caused by typing.
function StepHeading({ icon, text }: { readonly icon: ReactNode; readonly text: string }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <h2 id="wizard-title" className="wizard-heading" tabIndex={-1} ref={heading}>
      {icon}
      {text}
    </h2>
  )
}

function stepQuestion(step: Step) {
  switch (step) {
    case 1:
      return "wizard.q.basics"
    case 2:
      return "wizard.q.rules"
    case 3:
      return "wizard.q.review"
  }
}

function stepIcon(step: Step): ReactNode {
  switch (step) {
    case 1:
      return <GiftIcon />
    case 2:
      return <UsersIcon />
    case 3:
      return <CheckCircleIcon />
  }
}

function following(step: Exclude<Step, 3>): Step {
  switch (step) {
    case 1:
      return 2
    case 2:
      return 3
  }
}

function previous(step: Exclude<Step, 1>): Step {
  switch (step) {
    case 2:
      return 1
    case 3:
      return 2
  }
}

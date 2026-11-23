import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Link, Navigate, useLocation, useSearchParams } from "react-router"
import { channelEntryVias } from "@rafflink/core/domain/rules"
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
import { useStreamerSession } from "../components/streamer-session.tsx"
import { everyCapability } from "@rafflink/core/platform/provider"
import { useI18n } from "../i18n/i18n.tsx"
import { dashboardPath } from "../lib/routes.ts"
import { isCreated, markCreated, readDraft, takeReconnectDraft } from "../lib/wizard-draft.ts"
import { errorClass } from "@rafflink/core/lib/error-class"
import { reportError } from "../lib/error-reporting.ts"
import { BasicsStep, ReviewStep, RulesStep } from "./create-steps.tsx"
import {
  fitValues,
  missingEntryScopes,
  stepIssue,
  stepOfField,
  toBody,
  type Issue,
  type Step,
  type Values,
} from "./create-values.ts"

type Created = Extract<CreateResult, { kind: "created" }>

// Long enough that typing is one write to the history entry.
const saveAfterMs = 400

const stepNames = ["wizard.step.basics", "wizard.step.rules", "wizard.step.review"] as const

// Sub or points entry is on and Twitch has not granted its scopes: the reconnect note sits next to the field.
const reconnectIssue: Issue = { field: "subEntry", message: "issue.reconnect" }
const youtubeQuotaIssue: Issue = { field: "chatKeyword", message: "issue.youtubeQuota" }
/**
 * Creates a giveaway in three steps; each step is checked before the next, and the server's complaint sends the streamer back to its step.
 * The step is the `?step=` of the address: Next and Back add a history entry, so the browser's back button walks the steps.
 * The answers and the furthest step checked are kept in the history entries, so Back, Forward and a reload restore them;
 * an address typed by hand has none, and opens the first step. Once the giveaway exists, an entry of the same run sends
 * the streamer to the dashboard instead of showing a form that would create it a second time.
 */
export function CreateForm({
  seed,
  onCreated,
  onUnauthorized,
  onNotApproved,
}: {
  /** The answers the form starts with. */
  readonly seed: Values
  readonly onCreated: (created: Created) => void
  readonly onUnauthorized: () => void
  readonly onNotApproved: () => void
}) {
  const { t } = useI18n()
  const { state } = useLocation()
  const [query, setQuery] = useSearchParams()
  // Coming back from "Reconnect Twitch" lands on the rules step with no history entry; the answers wait in session storage.
  const [saved] = useState(
    () => readDraft(state) ?? (query.get("step") === "2" ? takeReconnectDraft() : null),
  )
  const [id] = useState(() => saved?.id ?? crypto.randomUUID())
  const [typed, setValues] = useState(saved?.values ?? seed)
  // Until the session answers the wizard offers every rule; the server refuses one the platform cannot check.
  const { streamer } = useStreamerSession()
  const capabilities = streamer?.capabilities ?? everyCapability
  // Signed out, the page shows the sign-in instead of the form, so nothing is missing yet.
  const readyEntryWays = streamer?.readyEntryWays ?? channelEntryVias
  const values = fitValues(typed, capabilities)
  const [furthest, setFurthest] = useState<Step>(saved?.furthest ?? 1)
  const wanted = query.get("step")
  const step = clampStep(wanted, furthest)
  const [issue, setIssue] = useState<Issue | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  // Decided when the wizard opens: the create that finishes this run must not send it to the dashboard.
  const [created] = useState(() => saved !== null && isCreated(saved.id))
  const draftState = (reached: Step) => ({ draft: { id, values: typed, furthest: reached } })

  const showStep = (target: Step, mode: "push" | "replace", reached: Step = furthest) =>
    setQuery(
      (current) => {
        const next = new URLSearchParams(current)
        if (target === 1) next.delete("step")
        else next.set("step", String(target))
        return next
      },
      { replace: mode === "replace", state: draftState(reached) },
    )

  // The entry the streamer is on keeps the answers typed since the last step change, a moment after typing pauses.
  const saveDraft = useEffectEvent((answers: Values, reached: Step) =>
    setQuery((current) => current, {
      replace: true,
      state: { draft: { id, values: answers, furthest: reached } },
    }),
  )
  useEffect(() => {
    if (created) return
    const timer = setTimeout(() => saveDraft(typed, furthest), saveAfterMs)
    return () => clearTimeout(timer)
  }, [typed, furthest, created])

  // An address that asks for a step the answers have not reached, or for none, is corrected in place.
  useEffect(() => {
    if (wanted !== null && wanted !== String(step)) showStep(step, "replace")
  })

  // Going back skips the checks: the answers stay in `values`, and the next step is checked again on Next.
  const goBack = (target: Step) => {
    setIssue(null)
    showStep(target, "push")
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (step !== 1 && missingEntryScopes(values, readyEntryWays).length > 0) {
      setIssue(reconnectIssue)
      if (step === 3) showStep(2, "replace")
      return
    }
    if (step !== 3) {
      const problem = stepIssue(step, values, Date.now())
      setIssue(problem)
      if (problem === null) {
        const target = following(step)
        const reached = furthest > target ? furthest : target
        setFurthest(reached)
        // The entry left behind keeps the answers of this step.
        showStep(step, "replace")
        showStep(target, "push", reached)
      }
      return
    }
    setBusy(true)
    setFailed(false)
    try {
      const result = await createGiveaway(toBody(values))
      switch (result.kind) {
        case "created":
          setIssue(null)
          markCreated(id)
          onCreated(result)
          return
        case "invalid":
          setIssue({ field: result.field, message: `issue.${result.code}` })
          // A refused ticket count needs its row, which shows only with Bonus tickets on.
          if (result.field.startsWith("tickets.")) {
            setValues((current) => ({ ...current, bonusTickets: true }))
          }
          showStep(stepOfField(result.field), "replace")
          return
        case "unauthorized":
          onUnauthorized()
          return
        case "not-approved":
          onNotApproved()
          return
        case "reconnect":
          setIssue(reconnectIssue)
          showStep(2, "replace")
          return
        case "youtube-quota":
          setIssue(youtubeQuotaIssue)
          showStep(2, "replace")
          return
      }
    } catch (error) {
      console.error("create failed", { errorClass: errorClass(error) })
      reportError(error)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (created) return <Navigate replace to={dashboardPath} />

  return (
    <form
      className="card wizard"
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-labelledby="wizard-title"
    >
      <StepIndicator
        steps={stepNames}
        current={step}
        onSelect={(target) => {
          if (target === 1 || target === 2) goBack(target)
        }}
      />
      <div className="wizard-body">
        <StepHeading key={step} icon={stepIcon(step)} text={t(stepQuestion(step))} />
        {issue === null ? null : (
          <p role="alert" className="form-alert">
            {t("wizard.fix")}
          </p>
        )}
        {step === 1 ? <BasicsStep values={values} setValues={setValues} issue={issue} /> : null}
        {step === 2 ? (
          <RulesStep
            values={values}
            setValues={setValues}
            issue={issue}
            capabilities={capabilities}
          />
        ) : null}
        {step === 3 ? <ReviewStep values={values} capabilities={capabilities} /> : null}
        {step === 3 && issue !== null ? <p className="field-error">{t(issue.message)}</p> : null}
        {failed ? (
          <p role="alert" className="form-alert">
            {t("action.failed")}
          </p>
        ) : null}
        <div className="actions wizard-actions">
          {step === 1 ? (
            <Link className="button text" to={dashboardPath}>
              <CloseIcon />
              {t("common.cancel")}
            </Link>
          ) : (
            <button
              key="back"
              type="button"
              className="button text"
              onClick={() => goBack(previous(step))}
            >
              <ArrowLeftIcon />
              {t("common.back")}
            </button>
          )}
          {step === 3 ? (
            <button key="start" type="submit" className="button large" disabled={busy}>
              <PlayIcon />
              {busy ? t("wizard.starting") : t("wizard.start")}
            </button>
          ) : (
            <button key="next" type="submit" className="button large">
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

/** The step the address asks for, never one past what the answers have reached. */
function clampStep(wanted: string | null, furthest: Step): Step {
  const asked = stepOfQuery(wanted)
  return asked > furthest ? furthest : asked
}

function stepOfQuery(wanted: string | null): Step {
  switch (wanted) {
    case "2":
      return 2
    case "3":
      return 3
    default:
      return 1
  }
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

import { useI18n } from "../i18n/i18n.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { CheckIcon } from "./icons.tsx"

/**
 * Where the user is in a flow. A `current` past the last step means every step is done.
 * With `onSelect`, a done step is a button that goes back to it; the current and later steps never are, so no step's checks can be skipped.
 */
export function StepIndicator({
  steps,
  current,
  onSelect,
}: {
  readonly steps: readonly [MessageKey, ...MessageKey[]]
  readonly current: number
  readonly onSelect: ((step: number) => void) | null
}) {
  const { t } = useI18n()
  const currentStep = steps[current - 1]
  const label =
    currentStep === undefined
      ? t("step.allDone", { total: steps.length })
      : t("step.of", { current, total: steps.length, name: t(currentStep) })
  return (
    <div className="steps">
      <p className="step-label">{label}</p>
      <ol aria-label={t("step.list")}>
        {steps.map((step, index) => {
          const number = index + 1
          const state = number < current ? "done" : number === current ? "current" : "todo"
          const content = (
            <>
              <span className="step-marker" aria-hidden="true">
                {state === "done" ? <CheckIcon /> : number}
              </span>
              <span className="step-name">{t(step)}</span>
            </>
          )
          return (
            <li
              key={step}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
            >
              {state === "done" && onSelect !== null ? (
                <button
                  type="button"
                  className="step-link"
                  aria-label={t("step.go", { number, name: t(step) })}
                  onClick={() => onSelect(number)}
                >
                  {content}
                </button>
              ) : (
                content
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

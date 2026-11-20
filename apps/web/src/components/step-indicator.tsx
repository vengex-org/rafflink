/** Where the user is in a flow. A `current` past the last step means every step is done. */
export function StepIndicator({
  steps,
  current,
}: {
  readonly steps: readonly [string, ...string[]]
  readonly current: number
}) {
  const label =
    current > steps.length
      ? `All ${steps.length} steps done`
      : `Step ${current} of ${steps.length}: ${steps[current - 1]}`
  return (
    <div className="steps">
      <p className="step-label">{label}</p>
      <ol aria-label="Steps">
        {steps.map((step, index) => {
          const number = index + 1
          const state = number < current ? "done" : number === current ? "current" : "todo"
          return (
            <li
              key={step}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="step-number">{number < current ? "✓" : number}</span>
              <span className="step-name">{step}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

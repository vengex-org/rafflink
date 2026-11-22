import { useId, useRef } from "react"
import { MinusIcon, PlusIcon } from "./icons.tsx"
import { SegmentRow, type SegmentRowOption } from "./segment-row.tsx"

/** A labelled input with optional help under the label and the problem under the input. */
export function TextField({
  name,
  label,
  help,
  value,
  error,
  onChange,
  type,
}: {
  readonly name: string
  readonly label: string
  readonly help: string | null
  readonly value: string
  readonly error: string | null
  readonly onChange: (value: string) => void
  readonly type: "text" | "datetime-local"
}) {
  const id = useId()
  const describedBy = [help === null ? null : `${id}-help`, error === null ? null : `${id}-error`]
    .filter((part) => part !== null)
    .join(" ")
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {help === null ? null : (
        <p id={`${id}-help`} className="help">
          {help}
        </p>
      )}
      <input
        id={id}
        name={name}
        type={type}
        autoComplete="off"
        value={value}
        aria-invalid={error !== null}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {error === null ? null : (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}

/** A labelled {@link Stepper} with optional help under the label and the problem under the control. */
export function StepperField({
  name,
  label,
  help,
  value,
  min,
  error,
  onChange,
  decreaseLabel,
  increaseLabel,
}: {
  readonly name: string
  readonly label: string
  readonly help: string | null
  readonly value: string
  readonly min: number
  readonly error: string | null
  readonly onChange: (value: string) => void
  readonly decreaseLabel: string
  readonly increaseLabel: string
}) {
  const id = useId()
  const describedBy = [help === null ? null : `${id}-help`, error === null ? null : `${id}-error`]
    .filter((part) => part !== null)
    .join(" ")
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {help === null ? null : (
        <p id={`${id}-help`} className="help">
          {help}
        </p>
      )}
      <Stepper
        id={id}
        name={name}
        value={value}
        min={min}
        invalid={error !== null}
        describedBy={describedBy === "" ? null : describedBy}
        onChange={onChange}
        decreaseLabel={decreaseLabel}
        increaseLabel={increaseLabel}
      />
      {error === null ? null : (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}

/** A whole-number input between a minus and a plus button; the buttons and the arrow keys step by 1, never below `min`. The caller labels the input by `id`. */
export function Stepper({
  id,
  name,
  value,
  min,
  invalid,
  describedBy,
  onChange,
  decreaseLabel,
  increaseLabel,
}: {
  readonly id: string
  readonly name: string
  readonly value: string
  readonly min: number
  readonly invalid: boolean
  readonly describedBy: string | null
  readonly onChange: (value: string) => void
  readonly decreaseLabel: string
  readonly increaseLabel: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const count = Number(value)
  const atMin = !(count > min)
  // A value that is not a number yet (empty, a typo) steps from `min`; a fraction steps from its whole part.
  const stepBy = (delta: number) => {
    const from = value.trim() !== "" && Number.isFinite(count) ? Math.trunc(count) : min
    const next = Math.max(min, from + delta)
    onChange(String(next))
    return next
  }
  return (
    <div className="stepper">
      <button
        type="button"
        className="icon-button"
        aria-label={decreaseLabel}
        disabled={atMin}
        onClick={() => {
          if (stepBy(-1) === min) inputRef.current?.focus()
        }}
      >
        <MinusIcon />
      </button>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        autoComplete="off"
        min={min}
        value={value}
        aria-invalid={invalid}
        aria-describedby={describedBy ?? undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
          event.preventDefault()
          stepBy(event.key === "ArrowUp" ? 1 : -1)
        }}
      />
      <button
        type="button"
        className="icon-button"
        aria-label={increaseLabel}
        onClick={() => stepBy(1)}
      >
        <PlusIcon />
      </button>
    </div>
  )
}

export interface SegmentOption<T extends string | number> extends SegmentRowOption<T> {
  /** Shown under the control while this option is selected. */
  readonly description: string
}

/** A row of mutually exclusive presets that explains the selected one. */
export function Segmented<T extends string | number>({
  name,
  legend,
  help,
  options,
  value,
  onSelect,
}: {
  readonly name: string
  readonly legend: string
  readonly help: string | null
  readonly options: readonly SegmentOption<T>[]
  readonly value: T
  readonly onSelect: (value: T) => void
}) {
  const selected = options.find((option) => option.value === value)
  return (
    <fieldset className="field">
      <legend>{legend}</legend>
      {help === null ? null : <p className="help">{help}</p>}
      <SegmentRow name={name} options={options} value={value} onSelect={onSelect} labels="shown" />
      {selected === undefined || selected.description === "" ? null : (
        <p className="help">{selected.description}</p>
      )}
    </fieldset>
  )
}

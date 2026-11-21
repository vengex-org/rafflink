import { useId } from "react"
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
  min,
}: {
  readonly name: string
  readonly label: string
  readonly help: string | null
  readonly value: string
  readonly error: string | null
  readonly onChange: (value: string) => void
  readonly type: "text" | "number" | "datetime-local"
  readonly min: number | null
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
        min={min ?? undefined}
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

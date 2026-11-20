import { useId, type ReactNode } from "react"

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

/** One big radio button that explains itself; put several in a `ChoiceGroup`. */
export function Choice({
  name,
  title,
  description,
  checked,
  onSelect,
}: {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly checked: boolean
  readonly onSelect: () => void
}) {
  const id = useId()
  return (
    <div className="choice" data-checked={checked}>
      <input id={id} type="radio" name={name} checked={checked} onChange={onSelect} />
      <label htmlFor={id} className="choice-text">
        <strong>{title}</strong>
        <span>{description}</span>
      </label>
    </div>
  )
}

export function ChoiceGroup({
  legend,
  children,
}: {
  readonly legend: string
  readonly children: ReactNode
}) {
  return (
    <fieldset className="choices">
      <legend>{legend}</legend>
      {children}
    </fieldset>
  )
}

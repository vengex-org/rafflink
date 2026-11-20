import { useId, type ReactNode } from "react"

export interface SegmentRowOption<T extends string | number> {
  readonly value: T
  readonly label: string
  readonly icon: ReactNode | null
}

/** A row of mutually exclusive choices; every segment is a radio button. `hidden` labels stay readable to screen readers. */
export function SegmentRow<T extends string | number>({
  name,
  options,
  value,
  onSelect,
  labels,
}: {
  readonly name: string
  readonly options: readonly SegmentRowOption<T>[]
  readonly value: T
  readonly onSelect: (value: T) => void
  readonly labels: "shown" | "hidden"
}) {
  const id = useId()
  return (
    <div className="segmented">
      {options.map((option) => (
        <div key={option.value} className="segment">
          <input
            id={`${id}-${option.value}`}
            type="radio"
            name={name}
            checked={option.value === value}
            onChange={() => onSelect(option.value)}
          />
          <label htmlFor={`${id}-${option.value}`}>
            {option.icon}
            <span className={labels === "hidden" ? "sr-only" : undefined}>{option.label}</span>
          </label>
        </div>
      ))}
    </div>
  )
}

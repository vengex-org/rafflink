import type { ReactNode } from "react"
import { ChevronDownIcon } from "./icons.tsx"

/** A collapsible section whose summary row shows an icon and a chevron; `onToggle` hears every open and close. */
export function Disclosure({
  icon,
  summary,
  open,
  onToggle,
  children,
}: {
  readonly icon: ReactNode
  readonly summary: string
  readonly open: boolean
  readonly onToggle?: (open: boolean) => void
  readonly children: ReactNode
}) {
  return (
    <details
      className="extra"
      open={open}
      onToggle={(event) => onToggle?.(event.currentTarget.open)}
    >
      <summary>
        {icon}
        <span className="summary-text">{summary}</span>
        <span className="chevron">
          <ChevronDownIcon />
        </span>
      </summary>
      {children}
    </details>
  )
}

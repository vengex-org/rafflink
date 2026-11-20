import type { ReactNode } from "react"
import { ChevronDownIcon } from "./icons.tsx"

/** A collapsible section whose summary row shows an icon and a chevron. */
export function Disclosure({
  icon,
  summary,
  open,
  children,
}: {
  readonly icon: ReactNode
  readonly summary: string
  readonly open: boolean
  readonly children: ReactNode
}) {
  return (
    <details className="extra" open={open}>
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

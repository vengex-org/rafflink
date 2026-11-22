import type { ReactNode } from "react"

/** One row of a `verify-facts` list; `mono` sets hashes and ids in the monospace face. */
export function Fact({
  label,
  mono,
  children,
}: {
  readonly label: string
  readonly mono?: boolean
  readonly children: ReactNode
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-format={mono === true ? "mono" : undefined}>{children}</dd>
    </div>
  )
}

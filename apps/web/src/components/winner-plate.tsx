import type { CSSProperties } from "react"

/** The winner's name on the accent plate; mount it with a new `key` per draw so the reveal plays again. `--chars` lets a page fit the name on one line. */
export function WinnerPlate({ name }: { readonly name: string }) {
  const style: CSSProperties & Record<"--chars", number> = { "--chars": [...name].length }
  return (
    <div className="winner-plate" style={style}>
      <span className="winner-plate-name">{name}</span>
    </div>
  )
}

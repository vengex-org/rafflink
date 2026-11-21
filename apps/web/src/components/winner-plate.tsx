/** The winner's name on the accent plate; mount it with a new `key` per draw so the reveal plays again. */
export function WinnerPlate({ name }: { readonly name: string }) {
  return (
    <div className="winner-plate">
      <span className="winner-plate-name">{name}</span>
    </div>
  )
}

import { useId } from "react"

/** A read-only value that selects itself on focus, for links the streamer pastes elsewhere. */
export function CopyField({ label, value }: { readonly label: string; readonly value: string }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
    </div>
  )
}

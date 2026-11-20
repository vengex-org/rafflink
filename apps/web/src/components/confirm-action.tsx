import { useEffect, useRef, useState } from "react"

/** A button for something that cannot be undone: it first asks in plain words what will happen. */
export function ConfirmAction({
  label,
  question,
  detail,
  confirmLabel,
  busy,
  disabled,
  quiet,
  onConfirm,
}: {
  readonly label: string
  readonly question: string
  readonly detail: string
  readonly confirmLabel: string
  readonly busy: boolean
  readonly disabled: boolean
  /** A smaller button for an action that is not the screen's main step. */
  readonly quiet: boolean
  readonly onConfirm: () => void
}) {
  const [asking, setAsking] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const wasAsking = useRef(false)

  useEffect(() => {
    if (asking) cancel.current?.focus()
    else if (wasAsking.current) trigger.current?.focus()
    wasAsking.current = asking
  }, [asking])

  if (!asking) {
    return (
      <button
        ref={trigger}
        type="button"
        className={quiet ? "button secondary small" : "button"}
        disabled={busy || disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    )
  }
  return (
    <fieldset className="confirm">
      <legend className="confirm-question">{question}</legend>
      <p>{detail}</p>
      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            setAsking(false)
            onConfirm()
          }}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          ref={cancel}
          className="button secondary"
          onClick={() => setAsking(false)}
        >
          Cancel
        </button>
      </div>
    </fieldset>
  )
}

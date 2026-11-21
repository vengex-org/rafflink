import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useI18n } from "../i18n/i18n.tsx"
import { useShortcut } from "../lib/use-shortcut.ts"
import { CloseIcon } from "./icons.tsx"

/** A button for something that cannot be undone: it first asks in a dialog, in plain words, what will happen. */
export function ConfirmAction({
  icon,
  label,
  question,
  detail,
  confirmLabel,
  busy,
  disabled,
  className,
  shortcut,
  onConfirm,
}: {
  readonly icon: ReactNode
  readonly label: ReactNode
  readonly question: string
  readonly detail: string
  readonly confirmLabel: string
  readonly busy: boolean
  readonly disabled: boolean
  /** The classes of the button that opens the question. */
  readonly className: string
  /** A key that opens the question like a click does, shown beside the label; null for none. */
  readonly shortcut: string | null
  readonly onConfirm: () => void
}) {
  const { t } = useI18n()
  const questionId = useId()
  const [asking, setAsking] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const wasAsking = useRef(false)
  const ask = useCallback(() => {
    if (!busy && !disabled) setAsking(true)
  }, [busy, disabled])
  useShortcut(shortcut, ask)

  useEffect(() => {
    if (asking) {
      dialog.current?.showModal()
      cancel.current?.focus()
    } else if (wasAsking.current) trigger.current?.focus()
    wasAsking.current = asking
  }, [asking])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        disabled={busy || disabled}
        aria-keyshortcuts={shortcut ?? undefined}
        onClick={() => setAsking(true)}
      >
        {icon}
        {label}
        {shortcut === null ? null : <kbd aria-hidden="true">{shortcut.toUpperCase()}</kbd>}
      </button>
      {asking ? (
        <dialog
          ref={dialog}
          className="dialog"
          aria-labelledby={questionId}
          onCancel={(event) => {
            event.preventDefault()
            setAsking(false)
          }}
        >
          <h2 id={questionId}>{question}</h2>
          <p>{detail}</p>
          <div className="actions dialog-actions">
            <button
              type="button"
              ref={cancel}
              className="button text"
              onClick={() => setAsking(false)}
            >
              <CloseIcon />
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setAsking(false)
                onConfirm()
              }}
            >
              {icon}
              {confirmLabel}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  )
}

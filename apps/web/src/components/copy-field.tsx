import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useI18n } from "../i18n/i18n.tsx"
import { errorClass } from "@rafflink/core/lib/error-class"
import { CheckIcon, CopyIcon } from "./icons.tsx"

type CopyState = "idle" | "copied" | "failed"

const feedbackMs = 3000

/**
 * A labelled link in one row: `children` show it, the icon button copies `value`. A long address is cut with an
 * ellipsis when `clipped`; the whole value still goes to the clipboard.
 */
export function CopyLink({
  label,
  value,
  buttonLabel,
  clipped,
  children,
}: {
  readonly label: string
  readonly value: string
  readonly buttonLabel: string
  readonly clipped: boolean
  readonly children: ReactNode
}) {
  const labelId = useId()
  return (
    <fieldset className="field" aria-labelledby={labelId}>
      <span className="field-label" id={labelId}>
        {label}
      </span>
      <div className="share-link">
        <span className="share-link-url" data-clipped={clipped}>
          {children}
        </span>
        <CopyButton value={value} label={buttonLabel} fieldLabel={label} />
      </div>
    </fieldset>
  )
}

/**
 * An icon button that copies `value`. The value also sits in a read-only field, invisible until the browser refuses
 * the copy; then the field shows with the whole value selected for Ctrl+C. `fieldLabel` names that field.
 */
export function CopyButton({
  value,
  label,
  fieldLabel,
}: {
  readonly value: string
  readonly label: string
  readonly fieldLabel: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const { state, copy } = useCopy(value, () => input.current?.select())
  return (
    <span className="copy-button" data-state={state}>
      <input
        ref={input}
        readOnly
        tabIndex={-1}
        aria-label={fieldLabel}
        value={value}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" className="icon-button" aria-label={label} onClick={() => void copy()}>
        {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      </button>
      <CopyFeedback state={state} />
    </span>
  )
}

/** Copies `value` and says how it went for a few seconds; `onFailed` puts the text where the streamer can copy it by hand. */
function useCopy(value: string, onFailed: () => void) {
  const [state, setState] = useState<CopyState>("idle")

  useEffect(() => {
    if (state === "idle") return
    const timer = setTimeout(() => setState("idle"), feedbackMs)
    return () => clearTimeout(timer)
  }, [state])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState("copied")
    } catch (error) {
      console.error("copy failed", { errorClass: errorClass(error) })
      onFailed()
      setState("failed")
    }
  }
  return { state, copy }
}

function CopyFeedback({ state }: { readonly state: CopyState }) {
  const { t } = useI18n()
  return (
    <output className="snackbar">
      {state === "copied" ? (
        <>
          <CheckIcon />
          {t("copy.copied")}
        </>
      ) : null}
      {state === "failed" ? t("copy.failed") : null}
    </output>
  )
}

import { useEffect, useId, useRef, useState, type RefObject } from "react"
import { useI18n } from "../i18n/i18n.tsx"
import { errorClass } from "@rafflink/core/lib/error-class"
import { CheckIcon, CopyIcon } from "./icons.tsx"

type CopyState = "idle" | "copied" | "failed"

const feedbackMs = 3000

/**
 * A read-only value with a button that copies it and says so: "Copied!", or how to copy by hand.
 * With `code`, the box shows the value without its protocol and `code` marked in lime; the input stays
 * under it, invisible until a copy fails and its selected text has to be seen.
 */
export function CopyField({
  label,
  value,
  buttonLabel,
  code,
}: {
  readonly label: string
  readonly value: string
  readonly buttonLabel: string
  readonly code?: string
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const { state, copy } = useCopy(value, () => input.current?.select())

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="copy-row" data-state={state}>
        <div className="copy-value" data-marked={code !== undefined}>
          {code === undefined ? null : <MarkedLink value={value} code={code} />}
          <input
            ref={input}
            id={id}
            readOnly
            value={value}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
        <button type="button" className="button" onClick={() => void copy()}>
          {state === "copied" ? <CheckIcon /> : <CopyIcon />}
          {buttonLabel}
        </button>
      </div>
      <CopyFeedback state={state} />
    </div>
  )
}

/** An icon button that copies `value`; when the browser refuses, it selects the text of `fallback` for Ctrl+C. */
export function CopyButton({
  value,
  label,
  fallback,
}: {
  readonly value: string
  readonly label: string
  readonly fallback: RefObject<HTMLElement | null>
}) {
  const { state, copy } = useCopy(value, () => {
    if (fallback.current !== null) window.getSelection()?.selectAllChildren(fallback.current)
  })
  return (
    <>
      <button type="button" className="icon-button" aria-label={label} onClick={() => void copy()}>
        {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      </button>
      <CopyFeedback state={state} />
    </>
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

function MarkedLink({ value, code }: { readonly value: string; readonly code: string }) {
  const head = value.endsWith(code) ? value.slice(0, -code.length) : value
  return (
    <code aria-hidden="true">
      {head.replace(/^https?:\/\//, "")}
      {head === value ? null : <em>{code}</em>}
    </code>
  )
}

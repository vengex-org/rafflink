import { useEffect, useId, useRef, useState } from "react"
import { useI18n } from "../i18n/i18n.tsx"
import { errorClass } from "@rafflink/core/lib/error-class"
import { CheckIcon, CopyIcon } from "./icons.tsx"

type CopyState = "idle" | "copied" | "failed"

const feedbackMs = 3000

/** A read-only value with a button that copies it and says so: "Copied!", or how to copy by hand. */
export function CopyField({
  label,
  value,
  buttonLabel,
}: {
  readonly label: string
  readonly value: string
  readonly buttonLabel: string
}) {
  const { t } = useI18n()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
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
      input.current?.select()
      setState("failed")
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="copy-row">
        <input
          ref={input}
          id={id}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className="button tonal" onClick={() => void copy()}>
          {state === "copied" ? <CheckIcon /> : <CopyIcon />}
          {buttonLabel}
        </button>
      </div>
      <output className="snackbar">
        {state === "copied" ? (
          <>
            <CheckIcon />
            {t("copy.copied")}
          </>
        ) : null}
        {state === "failed" ? t("copy.failed") : null}
      </output>
    </div>
  )
}

import { useEffect, useId, useRef, useState } from "react"
import { errorClass } from "../lib/use-load.ts"

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
          {buttonLabel}
        </button>
      </div>
      <output className="snackbar">
        {state === "copied" ? "Copied!" : null}
        {state === "failed" ? "Could not copy. The text is selected: press Ctrl+C." : null}
      </output>
    </div>
  )
}

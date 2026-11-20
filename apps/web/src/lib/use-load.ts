import { errorClass } from "@rafflink/core/lib/error-class"
import { useCallback, useEffect, useState } from "react"

export type Load<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "failed" }

/** Runs `load` on mount and whenever its identity changes; `reload` runs it again. A throw is logged and shown as failed. */
export function useLoad<T>(load: () => Promise<T>): { readonly result: Load<T>; reload(): void } {
  const [result, setResult] = useState<Load<T>>({ state: "loading" })
  const [round, setRound] = useState(0)

  useEffect(() => {
    let current = true
    load().then(
      (value) => {
        if (current) setResult({ state: "ready", value })
      },
      (error: unknown) => {
        console.error("load failed", { errorClass: errorClass(error), round })
        if (current) setResult({ state: "failed" })
      },
    )
    return () => {
      current = false
    }
  }, [load, round])

  const reload = useCallback(() => setRound((value) => value + 1), [])
  return { result, reload }
}

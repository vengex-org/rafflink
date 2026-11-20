import { useCallback, useState } from "react"
import { errorClass } from "./use-load.ts"

const failedText = "Something went wrong. Try again."

/** Runs one request at a time and keeps the sentence for its outcome, for a polite live region. */
export function useAction() {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async <K extends string>(
      call: () => Promise<K>,
      texts: Readonly<Record<K, string>>,
    ): Promise<K | "failed"> => {
      setBusy(true)
      try {
        const outcome = await call()
        setMessage(texts[outcome])
        return outcome
      } catch (error) {
        console.error("action failed", { errorClass: errorClass(error) })
        setMessage(failedText)
        return "failed"
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  return { message, busy, run }
}

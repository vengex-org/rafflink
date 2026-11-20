import { useCallback, useState } from "react"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { errorClass } from "./use-load.ts"

/** Runs one request at a time and keeps the message for its outcome, for a polite live region; the page shows it in the current language. */
export function useAction() {
  const [message, setMessage] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async <K extends string>(
      call: () => Promise<K>,
      messageOf: (outcome: K) => MessageKey,
    ): Promise<K | "failed"> => {
      setBusy(true)
      try {
        const outcome = await call()
        setMessage(messageOf(outcome))
        return outcome
      } catch (error) {
        console.error("action failed", { errorClass: errorClass(error) })
        setMessage("action.failed")
        return "failed"
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  return { message, busy, run }
}

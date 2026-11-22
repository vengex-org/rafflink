import { useEffect, useState } from "react"
import { useSearchParams } from "react-router"

// Long enough that a typed word is one address update; short enough that a reload right after typing keeps the search.
const settleMs = 400

/**
 * The text of a search box, kept in `?q=` so a reload or a shared link opens the same search. The box follows
 * every keystroke; the address follows once typing pauses, replacing the history entry, so the back button skips the typing.
 */
export function useSearchQuery(): readonly [string, (text: string) => void] {
  const [params, setParams] = useSearchParams()
  const [text, setText] = useState(() => params.get("q") ?? "")
  const inAddress = params.get("q") ?? ""
  useEffect(() => {
    if (inAddress === text) return
    const timer = setTimeout(
      () =>
        setParams(
          (previous) => {
            const next = new URLSearchParams(previous)
            if (text === "") next.delete("q")
            else next.set("q", text)
            return next
          },
          { replace: true },
        ),
      settleMs,
    )
    return () => clearTimeout(timer)
  }, [text, inAddress, setParams])
  return [text, setText]
}

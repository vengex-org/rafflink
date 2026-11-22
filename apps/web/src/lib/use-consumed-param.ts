import { useEffect, useState } from "react"
import { useSearchParams } from "react-router"

/**
 * The value of query parameter `name` when the page opened. The parameter is then removed from the address
 * (replacing the history entry), so a reload, a shared link or the back button does not apply it again.
 */
export function useConsumedParam(name: string): string | null {
  const [query, setQuery] = useSearchParams()
  const [value] = useState(() => query.get(name))
  const present = query.has(name)
  useEffect(() => {
    if (!present) return
    setQuery(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete(name)
        return next
      },
      { replace: true },
    )
  }, [present, name, setQuery])
  return value
}

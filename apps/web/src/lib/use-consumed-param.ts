import { useEffect, useEffectEvent, useState } from "react"
import { useSearchParams } from "react-router"

/**
 * The value of query parameter `name` as it came into the address, the latest one: a link followed later in the
 * page brings a new object, even with the same value, so an effect keyed on it applies it again. The parameter is
 * removed from the address (replacing the history entry) right after, so a reload, a shared link or the back
 * button does not apply it twice. Null until the parameter has come.
 */
export function useConsumedParam(name: string): { readonly value: string } | null {
  const [query, setQuery] = useSearchParams()
  const value = query.get(name)
  const [consumed, setConsumed] = useState(value === null ? null : { value })
  const [present, setPresent] = useState(value !== null)
  if ((value !== null) !== present) {
    setPresent(value !== null)
    if (value !== null) setConsumed({ value })
  }
  const remove = useEffectEvent(() =>
    setQuery(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete(name)
        return next
      },
      { replace: true },
    ),
  )
  useEffect(() => {
    if (value !== null) remove()
  }, [value])
  return consumed
}

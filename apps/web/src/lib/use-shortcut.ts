import { useEffect } from "react"

/** Runs `onPress` for a plain press of `key` unless the streamer is typing in a field or a question is open; Ctrl, Meta and Alt keep their own meaning. A null `key` listens to nothing. */
export function useShortcut(key: string | null, onPress: () => void): void {
  useEffect(() => {
    if (key === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== key || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTyping(event.target) || document.querySelector("dialog[open]") !== null) return
      onPress()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [key, onPress])
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  )
}

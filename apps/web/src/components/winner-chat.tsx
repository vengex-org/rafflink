import { useEffect, useId, useRef, type ReactNode } from "react"
import type { WinnerChatLine } from "@rafflink/core/room/giveaway-room"
import { useI18n } from "../i18n/i18n.tsx"

/** What the winners typed in chat, newest last, so the streamer can see who answered. Until a winner writes the box is not shown; `hint` says what will appear (null for none). */
export function WinnerChat({
  lines,
  hint,
}: {
  readonly lines: readonly WinnerChatLine[]
  readonly hint: ReactNode
}) {
  const { t } = useI18n()
  const titleId = useId()
  const list = useRef<HTMLOListElement>(null)
  const seen = useRef<ReadonlySet<number>>(new Set())

  // A push repeats the older lines; only a last line the page has not shown before moves the scroll, so
  // reading back is not interrupted, and a reroll that drops lines does not count as a new one.
  useEffect(() => {
    const last = lines.at(-1)
    if (last !== undefined && !seen.current.has(last.id) && list.current !== null) {
      list.current.scrollTop = list.current.scrollHeight
    }
    seen.current = new Set(lines.map((line) => line.id))
  }, [lines])

  if (lines.length === 0) return hint === null ? null : <p className="winner-chat-hint">{hint}</p>
  return (
    <section className="winner-chat" aria-labelledby={titleId}>
      <h2 id={titleId}>{t("live.chat.title")}</h2>
      <ol ref={list} aria-labelledby={titleId} aria-live="polite">
        {lines.map((line) => (
          <li key={line.id}>
            <strong>{line.name}</strong>
            <span>{line.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

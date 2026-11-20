import { useEffect, useId, useRef } from "react"
import type { WinnerChatLine } from "@rafflink/core/room/giveaway-room"
import { useI18n } from "../i18n/i18n.tsx"

/** What the winners typed in chat, newest last, so the streamer can see who answered; nothing is shown until a winner writes. */
export function WinnerChat({ lines }: { readonly lines: readonly WinnerChatLine[] }) {
  const { t } = useI18n()
  const titleId = useId()
  const list = useRef<HTMLOListElement>(null)
  const newestAt = lines.at(-1)?.at

  // A push repeats the older lines; only a newer last line moves the scroll, so reading back is not interrupted.
  useEffect(() => {
    if (newestAt !== undefined && list.current !== null) {
      list.current.scrollTop = list.current.scrollHeight
    }
  }, [newestAt])

  if (lines.length === 0) return null
  return (
    <section className="winner-chat" aria-labelledby={titleId}>
      <h2 id={titleId}>{t("live.chat.title")}</h2>
      <ol ref={list} aria-labelledby={titleId} aria-live="polite">
        {lines.map((line, index) => (
          <li key={`${line.at}-${index}`}>
            <strong>{line.name}</strong>
            <span>{line.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

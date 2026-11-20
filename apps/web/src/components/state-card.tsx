import type { ReactNode } from "react"

export type Tone = "success" | "win" | "info" | "warning" | "danger"

/** One state of a screen as a full card: an icon, a headline, a sentence that explains it and the next action. */
export function StateCard({
  tone,
  icon,
  title,
  level,
  children,
}: {
  readonly tone: Tone
  readonly icon: ReactNode
  readonly title: string
  /** 1 when the card is the whole page; 2 (the default) when the page has its own h1. */
  readonly level?: 1 | 2
  readonly children: ReactNode
}) {
  const Heading = level === 1 ? "h1" : "h2"
  return (
    <section className="card state-card" data-tone={tone}>
      <span className="state-icon">{icon}</span>
      <Heading>{title}</Heading>
      {children}
    </section>
  )
}

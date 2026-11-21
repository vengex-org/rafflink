import type { ReactNode } from "react"

/**
 * `wide` fills the frame the app bar and the footer share; `text` is the measure for reading and forms;
 * `compact` is the phone-sized column of the viewer's giveaway card. The widths are tokens in tokens.css.
 */
export type PageWidth = "wide" | "text" | "compact"

/** The one way a page sets its width: narrower columns sit in the middle of the frame, so no page invents its own. */
export function Page({
  width,
  as: Element = "div",
  className,
  children,
}: {
  readonly width: PageWidth
  readonly as?: "div" | "article" | "section"
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <Element className={className === undefined ? "page" : `page ${className}`} data-width={width}>
      {children}
    </Element>
  )
}

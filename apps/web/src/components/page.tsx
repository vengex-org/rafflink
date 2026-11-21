import { createContext, useContext, type ReactNode } from "react"

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
  readonly className?: string | undefined
  readonly children: ReactNode
}) {
  return (
    <Element className={className === undefined ? "page" : `page ${className}`} data-width={width}>
      {children}
    </Element>
  )
}

const inAppFrame = createContext(false)

/** Set by the app layout around its routes; the live page and the overlay draw their own full-screen frame. */
export const AppFrame = inAppFrame.Provider

/**
 * A state screen (sign-in, error, not found) is a text column inside the app frame; on the live page and the
 * overlay it keeps the layout of the page that shows it.
 */
export function StateColumn({
  as: Element = "div",
  className,
  children,
}: {
  readonly as?: "div" | "section"
  readonly className?: string
  readonly children: ReactNode
}) {
  if (useContext(inAppFrame)) {
    return (
      <Page width="text" as={Element} className={className}>
        {children}
      </Page>
    )
  }
  return className === undefined ? children : <Element className={className}>{children}</Element>
}

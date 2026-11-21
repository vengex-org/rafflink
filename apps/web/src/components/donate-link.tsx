import type { ReactNode } from "react"
import { HeartIcon } from "./icons.tsx"

/** The quiet link to the deployment's support page (`DONATE_URL`), opening in a new tab. */
export function DonateLink({
  url,
  onClick,
  children,
}: {
  readonly url: string
  readonly onClick?: (() => void) | undefined
  readonly children: ReactNode
}) {
  return (
    <a className="donate-link" href={url} target="_blank" rel="noopener" onClick={onClick}>
      <HeartIcon />
      {children}
    </a>
  )
}

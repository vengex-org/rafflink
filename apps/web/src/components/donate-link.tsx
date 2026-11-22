import type { ReactNode } from "react"
import { ExternalLink } from "./external-link.tsx"
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
    <ExternalLink kind="donate" className="donate-link" href={url} onClick={onClick}>
      <HeartIcon />
      {children}
    </ExternalLink>
  )
}

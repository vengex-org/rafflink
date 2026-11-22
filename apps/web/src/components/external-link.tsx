import { useId, type ComponentProps } from "react"
import { useI18n } from "../i18n/i18n.tsx"

/**
 * `own`: our properties, keep referrer and link equity. `donate`: sponsored, no endorsement.
 * `reference`: someone else's site, no referrer.
 */
type ExternalLinkKind = "own" | "donate" | "reference"

const relOf: Readonly<Record<ExternalLinkKind, string>> = {
  own: "noopener",
  donate: "noopener nofollow",
  reference: "noopener noreferrer",
}

/** A link to another site: always opens in a new tab, with the rel its kind needs and a spoken hint about the new tab. */
export function ExternalLink({
  kind,
  href,
  children,
  ...props
}: Omit<ComponentProps<"a">, "href" | "target" | "rel" | "aria-describedby"> & {
  readonly kind: ExternalLinkKind
  readonly href: string
}) {
  const { t } = useI18n()
  const hintId = useId()
  return (
    <>
      <a {...props} href={href} target="_blank" rel={relOf[kind]} aria-describedby={hintId}>
        {children}
      </a>
      <span id={hintId} className="sr-only">
        {t("link.newTab")}
      </span>
    </>
  )
}

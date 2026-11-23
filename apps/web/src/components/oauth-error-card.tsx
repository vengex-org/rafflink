import { isPlatform, type Platform } from "@rafflink/core/platform/provider"
import { useLocation, useSearchParams } from "react-router"
import { useI18n } from "../i18n/i18n.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { parseGiveawayCode } from "../lib/giveaway-code.ts"
import { appSetupUrls } from "../lib/links.ts"
import { platformNames } from "../lib/platform-name.ts"
import { dashboardPath, pageOfPath, streamerSignInPath, viewerSignInPath } from "../lib/routes.ts"
import { useHydrated } from "../lib/use-hydrated.ts"
import { ExternalLink } from "./external-link.tsx"
import { AlertIcon, LogInIcon } from "./icons.tsx"
import { Page } from "./page.tsx"
import { StateCard } from "./state-card.tsx"

// What the platform puts in the query of a failed sign-in, besides `error`: the sign-in's own state, and the platform
// the callback names.
const signInParams = ["error", "error_description", "state", "nonce", "platform"] as const

/**
 * Shown above any page that a sign-in callback sent back with `error` and `platform` in the query. Both are untrusted
 * text: an unknown platform shows no card, and `error_description` is never shown.
 */
export function OAuthErrorCard() {
  const { t } = useI18n()
  const [query, setQuery] = useSearchParams()
  const { pathname } = useLocation()
  const hydrated = useHydrated()
  const error = query.get("error")
  const platform = query.get("platform")
  if (!hydrated || error === null || platform === null || !isPlatform(platform)) return null

  const dismiss = () =>
    setQuery(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const name of signInParams) next.delete(name)
        return next
      },
      { replace: true },
    )

  // Above a giveaway page it is as wide as the viewer's card; above any other page, a text column.
  const signIn = signInOf(platform, pathname)
  const name = { platform: platformNames[platform] }
  return (
    <Page width={signIn.viewer ? "compact" : "text"} className="oauth-error">
      <StateCard
        tone="danger"
        align="center"
        icon={<AlertIcon />}
        title={t("oauthError.title", name)}
      >
        <p role="alert">{t(messageOf(error), name)}</p>
        {error === "redirect_mismatch" ? (
          <p>
            <ExternalLink kind="own" href={appSetupUrls[platform]}>
              {t("oauthError.setupLink", name)}
            </ExternalLink>
          </p>
        ) : null}
        {error === "access_denied" || error === "redirect_mismatch" ? null : (
          <small>{t("oauthError.code", { code: error.slice(0, 50) })}</small>
        )}
        <a className="button block" href={signIn.href}>
          <LogInIcon />
          {t("oauthError.tryAgain")}
        </a>
        <button type="button" className="button text" onClick={dismiss}>
          {t("oauthError.dismiss")}
        </button>
      </StateCard>
    </Page>
  )
}

function messageOf(error: string): MessageKey {
  switch (error) {
    case "access_denied":
      return "oauthError.access_denied"
    case "redirect_mismatch":
      return "oauthError.redirect_mismatch"
    default:
      return "oauthError.generic"
  }
}

/**
 * A giveaway page signs a viewer in; any other page signs a streamer in and brings them back to it, both on the
 * platform that refused. The query is left out, it holds the error. The home page, where a failed streamer sign-in
 * lands, stands for the dashboard.
 */
function signInOf(
  platform: Platform,
  pathname: string,
): { readonly viewer: boolean; readonly href: string } {
  const segments = pathname.split("/").filter((segment) => segment !== "")
  const [first] = segments
  const code = segments.length === 1 && first !== undefined ? parseGiveawayCode(first) : null
  if (code !== null) return { viewer: true, href: viewerSignInPath(platform, code) }
  return {
    viewer: false,
    href: streamerSignInPath(
      platform,
      pageOfPath(pathname)?.page === "home" ? dashboardPath : pathname,
    ),
  }
}

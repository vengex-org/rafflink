import type { Platform } from "@rafflink/core/platform/provider"
import { useEffect, useState, type ReactNode } from "react"
import { Link, useLocation } from "react-router"
import { useI18n } from "../i18n/i18n.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useLocalizedPath } from "../i18n/localized-pages.ts"
import { streamerSignInPath } from "../lib/routes.ts"
import {
  AlertIcon,
  ArrowLeftIcon,
  CloseIcon,
  LockIcon,
  PlatformIcon,
  RefreshIcon,
} from "./icons.tsx"
import { StateColumn } from "./page.tsx"
import { StateCard } from "./state-card.tsx"
import {
  StreamerSessionProvider,
  useHasStreamerSession,
  useStreamerSession,
} from "./streamer-session.tsx"

export function Loading() {
  const { t } = useI18n()
  return (
    <output className="loading">
      <span className="spinner" aria-hidden="true" />
      {t("common.loading")}
    </output>
  )
}

/** `onReload` loads the page's data again; without it, which a page that holds no loader has, the whole document reloads. */
export function Failed({ onReload }: { readonly onReload?: (() => void) | undefined }) {
  const { t } = useI18n()
  return (
    <StateColumn>
      <StateCard
        tone="danger"
        align="center"
        icon={<AlertIcon />}
        title={t("failed.title")}
        level={1}
      >
        <p role="alert">{t("failed.text")}</p>
        <button
          type="button"
          className="button"
          onClick={onReload ?? (() => window.location.reload())}
        >
          <RefreshIcon />
          {t("common.reloadPage")}
        </button>
      </StateCard>
    </StateColumn>
  )
}

export function NotFound({ title }: { readonly title: MessageKey }) {
  const { t } = useI18n()
  const homePath = useLocalizedPath("home")
  return (
    <StateColumn as="section" className="not-found">
      <p className="not-found-code" aria-hidden="true">
        <span>404</span>
      </p>
      <h1>{t(title)}</h1>
      <p>{t("notFound.hint")}</p>
      <Link className="button large" to={homePath}>
        <ArrowLeftIcon />
        {t("notFound.home")}
      </Link>
    </StateColumn>
  )
}

const toastMs = 6000

/** A result toast: screen readers announce it when it appears or changes; it goes away after a few seconds or on dismiss. */
export function Status({ children }: { readonly children: ReactNode }) {
  const { t } = useI18n()
  const [dismissed, setDismissed] = useState<ReactNode>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDismissed(children), toastMs)
    return () => clearTimeout(timer)
  }, [children])

  return (
    <output className="toast">
      {dismissed === children ? null : (
        <>
          <span>{children}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={t("common.dismiss")}
            onClick={() => setDismissed(children)}
          >
            <CloseIcon />
          </button>
        </>
      )}
    </output>
  )
}

const signInLabels: Readonly<Record<Platform, MessageKey>> = {
  twitch: "signIn.button",
  kick: "signIn.buttonKick",
  youtube: "signIn.buttonYouTube",
}

/**
 * Signing in brings the streamer back to the page they are on; one button per platform the install signs in with.
 * `why` says what the sign-in is for when the page around it does not. A page outside the layout asks the session
 * here, so its buttons follow the install's platforms too.
 */
export function SignIn({ why }: { readonly why?: MessageKey | undefined }) {
  return useHasStreamerSession() ? (
    <SignInCard why={why} />
  ) : (
    <StreamerSessionProvider>
      <SignInCard why={why} />
    </StreamerSessionProvider>
  )
}

function SignInCard({ why }: { readonly why: MessageKey | undefined }) {
  const { t } = useI18n()
  const { pathname, search } = useLocation()
  const { signInPlatforms } = useStreamerSession()
  return (
    <StateColumn>
      <StateCard tone="info" align="center" icon={<LockIcon />} title={t("signIn.title")} level={1}>
        {why === undefined ? null : <p>{t(why)}</p>}
        {signInPlatforms.map((platform) => (
          <a
            key={platform}
            className="button outlined block"
            href={streamerSignInPath(platform, `${pathname}${search}`)}
          >
            <PlatformIcon platform={platform} />
            {t(signInLabels[platform])}
          </a>
        ))}
      </StateCard>
    </StateColumn>
  )
}

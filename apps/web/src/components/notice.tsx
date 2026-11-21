import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router"
import { useI18n } from "../i18n/i18n.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { AlertIcon, ArrowLeftIcon, CloseIcon, LockIcon, LogInIcon, RefreshIcon } from "./icons.tsx"
import { StateColumn } from "./page.tsx"
import { StateCard } from "./state-card.tsx"

export function Loading() {
  const { t } = useI18n()
  return (
    <output className="loading">
      <span className="spinner" aria-hidden="true" />
      {t("common.loading")}
    </output>
  )
}

export function Failed() {
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
        <button type="button" className="button" onClick={() => window.location.reload()}>
          <RefreshIcon />
          {t("common.reloadPage")}
        </button>
      </StateCard>
    </StateColumn>
  )
}

export function NotFound({ title }: { readonly title: MessageKey }) {
  const { t } = useI18n()
  return (
    <StateColumn as="section" className="not-found">
      <p className="not-found-code" aria-hidden="true">
        <span>404</span>
      </p>
      <h1>{t(title)}</h1>
      <p>{t("notFound.hint")}</p>
      <Link className="button large" to="/">
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

export function SignIn({ why }: { readonly why: MessageKey }) {
  const { t } = useI18n()
  return (
    <StateColumn>
      <StateCard tone="info" align="center" icon={<LockIcon />} title={t("signIn.title")} level={1}>
        <p>{t(why)}</p>
        <a className="button block" href="/auth/twitch/streamer/start">
          <LogInIcon />
          {t("signIn.button")}
        </a>
      </StateCard>
    </StateColumn>
  )
}

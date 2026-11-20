import { useEffect, useState, type ReactNode } from "react"
import { useI18n } from "../i18n/i18n.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { AlertIcon, CloseIcon, LockIcon, LogInIcon, RefreshIcon } from "./icons.tsx"
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
  )
}

export function NotFound({ title }: { readonly title: MessageKey }) {
  const { t } = useI18n()
  return (
    <StateCard tone="warning" align="center" icon={<AlertIcon />} title={t(title)} level={1}>
      <p>{t("notFound.hint")}</p>
    </StateCard>
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
    <StateCard tone="info" align="center" icon={<LockIcon />} title={t("signIn.title")} level={1}>
      <p>{t(why)}</p>
      <a className="button block" href="/auth/twitch/streamer/start">
        <LogInIcon />
        {t("signIn.button")}
      </a>
    </StateCard>
  )
}

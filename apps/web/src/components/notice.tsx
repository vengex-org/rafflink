import type { ReactNode } from "react"
import { AlertIcon, LockIcon } from "./icons.tsx"
import { StateCard } from "./state-card.tsx"

export function Loading() {
  return (
    <output className="loading">
      <span className="spinner" aria-hidden="true" />
      Loading…
    </output>
  )
}

export function Failed() {
  return (
    <StateCard tone="danger" icon={<AlertIcon />} title="Something went wrong" level={1}>
      <p role="alert">Something went wrong. Reload the page.</p>
      <button type="button" className="button" onClick={() => window.location.reload()}>
        Reload page
      </button>
    </StateCard>
  )
}

export function NotFound({ title }: { readonly title: string }) {
  return (
    <StateCard tone="warning" icon={<AlertIcon />} title={title} level={1}>
      <p>Check the link and try again.</p>
    </StateCard>
  )
}

/** A sentence that screen readers announce when it appears or changes; empty until there is one. */
export function Status({ children }: { readonly children: ReactNode }) {
  return <output className="status">{children}</output>
}

export function SignIn({ why }: { readonly why: string }) {
  return (
    <StateCard tone="info" icon={<LockIcon />} title="Sign in" level={1}>
      <p>{why}</p>
      <a className="button big" href="/auth/twitch/streamer/start">
        Sign in with Twitch
      </a>
    </StateCard>
  )
}

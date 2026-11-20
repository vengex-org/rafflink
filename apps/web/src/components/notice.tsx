import type { ReactNode } from "react"

export function Loading() {
  return <p aria-busy="true">Loading…</p>
}

export function Failed() {
  return <p role="alert">Something went wrong. Reload the page.</p>
}

export function NotFound({ title }: { readonly title: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>Check the link and try again.</p>
    </section>
  )
}

/** A sentence that screen readers announce when it appears or changes; empty until there is one. */
export function Status({ children }: { readonly children: ReactNode }) {
  return <output className="status">{children}</output>
}

export function SignIn({ why }: { readonly why: string }) {
  return (
    <section>
      <h1>Sign in</h1>
      <p>{why}</p>
      <a className="button" href="/auth/twitch/streamer/start">
        Sign in with Twitch
      </a>
    </section>
  )
}

import { Link, useSearchParams } from "react-router"
import { AlertIcon, GiftIcon, PlusIcon } from "../components/icons.tsx"
import { StateCard } from "../components/state-card.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"

export function HomePage() {
  const { t } = useI18n()
  const [query] = useSearchParams()
  const problem = signInProblem(query.get("signin"))
  return (
    <>
      {problem === null ? null : (
        <StateCard tone="danger" align="center" icon={<AlertIcon />} title={t("home.problemTitle")}>
          <p role="alert">{t(problem)}</p>
        </StateCard>
      )}
      <StateCard tone="info" align="center" icon={<GiftIcon />} title={t("home.title")} level={1}>
        <p>{t("home.text")}</p>
        <Link className="button block" to="/dashboard">
          <PlusIcon />
          {t("home.create")}
        </Link>
      </StateCard>
    </>
  )
}

// The streamer sign-in callback redirects here with `?signin=` when it fails.
function signInProblem(reason: string | null): MessageKey | null {
  switch (reason) {
    case "invalid-state":
      return "home.problem.invalidState"
    case "try-again":
      return "home.problem.tryAgain"
    default:
      return null
  }
}

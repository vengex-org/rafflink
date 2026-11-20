import { Link, useSearchParams } from "react-router"

export function HomePage() {
  const [query] = useSearchParams()
  const problem = signInProblem(query.get("signin"))
  return (
    <section>
      <h1>Rafflink</h1>
      <p>
        Chat giveaways for big Twitch channels. Viewers enter with one Twitch sign-in instead of
        typing fast.
      </p>
      {problem === null ? null : <p role="alert">{problem}</p>}
      <Link className="button" to="/dashboard">
        Streamer dashboard
      </Link>
    </section>
  )
}

// The streamer sign-in callback redirects here with `?signin=` when it fails.
function signInProblem(reason: string | null): string | null {
  switch (reason) {
    case "invalid-state":
      return "The sign-in expired. Please try again."
    case "try-again":
      return "Twitch did not answer. Please try again."
    default:
      return null
  }
}

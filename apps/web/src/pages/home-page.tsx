import { Link, useSearchParams } from "react-router"
import { AlertIcon, GiftIcon } from "../components/icons.tsx"
import { StateCard } from "../components/state-card.tsx"

export function HomePage() {
  const [query] = useSearchParams()
  const problem = signInProblem(query.get("signin"))
  return (
    <>
      {problem === null ? null : (
        <StateCard tone="danger" icon={<AlertIcon />} title="Sign-in did not work">
          <p role="alert">{problem}</p>
        </StateCard>
      )}
      <StateCard tone="info" icon={<GiftIcon />} title="Giveaways for your Twitch chat" level={1}>
        <p>
          Viewers enter with one Twitch sign-in instead of typing fast in chat. You share a link,
          close entries and draw the winner live.
        </p>
        <Link className="button block" to="/dashboard">
          Create a giveaway
        </Link>
      </StateCard>
    </>
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

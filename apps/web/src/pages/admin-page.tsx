import type { Usage } from "@rafflink/core/ports"
import { getAdminUsage, type AdminUsage } from "../api/client.ts"
import { Failed, Loading, SignIn } from "../components/notice.tsx"
import { useLoad } from "../lib/use-load.ts"

export function AdminPage() {
  const { result } = useLoad(getAdminUsage)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "ready":
      if (result.value === "unauthorized")
        return <SignIn why="Sign in with Twitch to open the admin page." />
      if (result.value === "forbidden") {
        return (
          <section>
            <h1>Admin</h1>
            <p>This Twitch account is not an admin.</p>
          </section>
        )
      }
      return <Report report={result.value} />
  }
}

function Report({ report }: { readonly report: AdminUsage }) {
  const { queue } = report
  return (
    <>
      <h1>Admin</h1>
      <section aria-labelledby="usage">
        <h2 id="usage">Today's usage</h2>
        <UsageTable usage={report.usage} />
      </section>
      <section aria-labelledby="queue">
        <h2 id="queue">Entry queue</h2>
        <dl className="stats">
          <div>
            <dt>Waiting</dt>
            <dd>{queue.queued}</dd>
          </div>
          <div>
            <dt>Rate per second</dt>
            <dd>{queue.ratePerSecond}</dd>
          </div>
          <div>
            <dt>Dropped</dt>
            <dd>{queue.dropped}</dd>
          </div>
          <div>
            <dt>Results nobody polled</dt>
            <dd>{queue.abandonedResults}</dd>
          </div>
          <div>
            <dt>Cooldown until</dt>
            <dd>
              {queue.cooldownUntil === 0
                ? "none"
                : new Date(queue.cooldownUntil).toLocaleTimeString()}
            </dd>
          </div>
        </dl>
      </section>
    </>
  )
}

function UsageTable({ usage }: { readonly usage: Usage | null | "unavailable" }) {
  if (usage === null) return <p>no daily limit</p>
  if (usage === "unavailable") return <p>unavailable</p>
  return (
    <dl className="stats">
      <div>
        <dt>Worker requests</dt>
        <dd>
          {usage.workerRequests.used} of {usage.workerRequests.limit}
        </dd>
      </div>
      <div>
        <dt>Durable Object requests</dt>
        <dd>
          {usage.doRequests.used} of {usage.doRequests.limit}
        </dd>
      </div>
    </dl>
  )
}

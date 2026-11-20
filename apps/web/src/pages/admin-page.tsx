import type { Usage } from "@rafflink/core/ports"
import { getAdminUsage, type AdminUsage } from "../api/client.ts"
import { LockIcon } from "../components/icons.tsx"
import { Stat } from "../components/live-parts.tsx"
import { Failed, Loading, SignIn } from "../components/notice.tsx"
import { StateCard } from "../components/state-card.tsx"
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
          <StateCard tone="warning" icon={<LockIcon />} title="Admins only" level={1}>
            <p>This Twitch account is not an admin.</p>
          </StateCard>
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
      <section className="card" aria-labelledby="usage">
        <h2 id="usage">Today's usage</h2>
        <UsageBars usage={report.usage} />
      </section>
      <section className="card" aria-labelledby="queue">
        <h2 id="queue">Entry line</h2>
        <p className="muted">Entries wait here when many viewers sign in at once.</p>
        <dl className="stats">
          <Stat value={String(queue.queued)} label="entries waiting" />
          <Stat value={String(queue.ratePerSecond)} label="entries let in per second" />
          <Stat value={String(queue.dropped)} label="entries dropped" />
          <Stat value={String(queue.abandonedResults)} label="results nobody picked up" />
          <Stat
            value={
              queue.cooldownUntil === 0
                ? "none"
                : new Date(queue.cooldownUntil).toLocaleTimeString()
            }
            label="Twitch cooldown until"
          />
        </dl>
      </section>
    </>
  )
}

function UsageBars({ usage }: { readonly usage: Usage | null | "unavailable" }) {
  if (usage === null) return <p>This server has no daily request limit.</p>
  if (usage === "unavailable") return <p>Today's usage is unavailable right now.</p>
  return (
    <>
      <Bar
        label="Worker requests"
        used={usage.workerRequests.used}
        limit={usage.workerRequests.limit}
      />
      <Bar
        label="Durable Object requests"
        used={usage.doRequests.used}
        limit={usage.doRequests.limit}
      />
    </>
  )
}

function Bar({
  label,
  used,
  limit,
}: {
  readonly label: string
  readonly used: number
  readonly limit: number
}) {
  const text = `${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} requests used today`
  return (
    <div className="usage">
      <p>
        <strong>{label}</strong>
      </p>
      <progress value={used} max={limit} aria-label={label} />
      <p>{text}</p>
    </div>
  )
}

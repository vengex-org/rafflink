import type { ReactNode } from "react"
import type { Usage } from "@rafflink/core/ports"
import { getAdminUsage, type AdminUsage } from "../api/client.ts"
import {
  ActivityIcon,
  AlertIcon,
  ClockIcon,
  DatabaseIcon,
  LockIcon,
  ServerIcon,
  UsersIcon,
} from "../components/icons.tsx"
import { Stat } from "../components/live-parts.tsx"
import { Failed, Loading, SignIn } from "../components/notice.tsx"
import { StateCard } from "../components/state-card.tsx"
import { useI18n } from "../i18n/i18n.tsx"
import { useLoad } from "../lib/use-load.ts"

export function AdminPage() {
  const { t } = useI18n()
  const { result } = useLoad(getAdminUsage)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "ready":
      if (result.value === "unauthorized") return <SignIn why="signIn.why.admin" />
      if (result.value === "forbidden") {
        return (
          <StateCard
            tone="warning"
            align="center"
            icon={<LockIcon />}
            title={t("admin.only.title")}
            level={1}
          >
            <p>{t("admin.only.text")}</p>
          </StateCard>
        )
      }
      return <Report report={result.value} />
  }
}

function Report({ report }: { readonly report: AdminUsage }) {
  const i18n = useI18n()
  const { t } = i18n
  const { queue } = report
  return (
    <>
      <h1>{t("admin.title")}</h1>
      <div className="card-grid">
        <section className="card" aria-labelledby="usage">
          <h2 id="usage">{t("admin.usage.title")}</h2>
          <UsageBars usage={report.usage} />
        </section>
        <section className="card" aria-labelledby="queue">
          <h2 id="queue">{t("admin.queue.title")}</h2>
          <p className="muted">{t("admin.queue.hint")}</p>
          <dl className="stats">
            <Stat
              icon={<ClockIcon />}
              value={i18n.number(queue.queued)}
              label={t("admin.queue.waiting")}
            />
            <Stat
              icon={<ActivityIcon />}
              value={i18n.number(queue.ratePerSecond)}
              label={t("admin.queue.rate")}
            />
            <Stat
              icon={<AlertIcon />}
              value={i18n.number(queue.dropped)}
              label={t("admin.queue.dropped")}
            />
            <Stat
              icon={<UsersIcon />}
              value={i18n.number(queue.abandonedResults)}
              label={t("admin.queue.abandoned")}
            />
            <Stat
              icon={<ClockIcon />}
              value={
                queue.cooldownUntil === 0
                  ? t("admin.queue.noCooldown")
                  : i18n.time(queue.cooldownUntil)
              }
              label={t("admin.queue.cooldown")}
            />
          </dl>
        </section>
      </div>
    </>
  )
}

function UsageBars({ usage }: { readonly usage: Usage | null | "unavailable" }) {
  const { t } = useI18n()
  if (usage === null) return <p>{t("admin.noLimit")}</p>
  if (usage === "unavailable") return <p>{t("admin.unavailable")}</p>
  return (
    <>
      <Bar
        icon={<ServerIcon />}
        label={t("admin.workerRequests")}
        used={usage.workerRequests.used}
        limit={usage.workerRequests.limit}
      />
      <Bar
        icon={<DatabaseIcon />}
        label={t("admin.doRequests")}
        used={usage.doRequests.used}
        limit={usage.doRequests.limit}
      />
    </>
  )
}

function Bar({
  icon,
  label,
  used,
  limit,
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly used: number
  readonly limit: number
}) {
  const { t, number } = useI18n()
  return (
    <div className="usage">
      <p className="usage-label">
        {icon}
        <strong>{label}</strong>
      </p>
      <progress value={used} max={limit} aria-label={label} />
      <p>{t("admin.usageText", { used: number(used), limit: number(limit) })}</p>
    </div>
  )
}

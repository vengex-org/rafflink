import { useId, useState, type ReactNode } from "react"
import type { AdminPlanJson } from "@rafflink/core/http/json"
import type { CloudflarePlan } from "@rafflink/core/plan/plan-limits"
import type { Usage, UsageAlert } from "@rafflink/core/plan/usage"
import { getAdminUsage, switchPlan, type AdminUsage } from "../api/client.ts"
import {
  ActivityIcon,
  AlertIcon,
  ClockIcon,
  CloseIcon,
  CloudIcon,
  DatabaseIcon,
  LockIcon,
  ServerIcon,
  UsersIcon,
} from "../components/icons.tsx"
import { Stat } from "../components/live-parts.tsx"
import { Failed, Loading, SignIn, Status } from "../components/notice.tsx"
import { Page } from "../components/page.tsx"
import { SegmentRow } from "../components/segment-row.tsx"
import { StateCard } from "../components/state-card.tsx"
import type { MessageKey } from "../i18n/dictionaries.ts"
import { useI18n } from "../i18n/i18n.tsx"
import { cloudflarePlansUrl } from "../lib/links.ts"
import { useAction } from "../lib/use-action.ts"
import { useLoad } from "../lib/use-load.ts"

export function AdminPage() {
  const { t } = useI18n()
  const { result, reload } = useLoad(getAdminUsage)
  switch (result.state) {
    case "loading":
      return <Loading />
    case "failed":
      return <Failed />
    case "ready":
      if (result.value === "unauthorized") return <SignIn why="signIn.why.admin" />
      if (result.value === "forbidden") {
        return (
          <Page width="text">
            <StateCard
              tone="warning"
              align="center"
              icon={<LockIcon />}
              title={t("admin.only.title")}
              level={1}
            >
              <p>{t("admin.only.text")}</p>
            </StateCard>
          </Page>
        )
      }
      return <Report report={result.value} onPlanSwitched={reload} />
  }
}

function Report({
  report,
  onPlanSwitched,
}: {
  readonly report: AdminUsage
  readonly onPlanSwitched: () => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { queue, plan } = report
  return (
    <>
      <div className="page-head">
        <h1>{t("admin.title")}</h1>
      </div>
      {report.alerts.length === 0 ? null : (
        <UsageAlerts alerts={report.alerts} onFree={plan?.current === "free"} />
      )}
      <div className="card-grid">
        <section className="card" aria-labelledby="usage">
          <h2 id="usage">{t("admin.usage.title")}</h2>
          <UsageBars usage={report.usage} />
        </section>
        {plan === null ? null : <PlanCard plan={plan} onSwitched={onPlanSwitched} />}
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
              icon={<AlertIcon />}
              value={i18n.number(queue.lostClaims)}
              label={t("admin.queue.lostClaims")}
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

const alertMessages: Readonly<Record<UsageAlert["limit"], MessageKey>> = {
  "worker-requests": "admin.alert.workerRequests",
  "do-requests": "admin.alert.doRequests",
}

function UsageAlerts({
  alerts,
  onFree,
}: {
  readonly alerts: readonly UsageAlert[]
  readonly onFree: boolean
}) {
  const { t, number } = useI18n()
  return (
    <section role="alert" className="card banner usage-alert" data-tone="warning">
      <span className="state-icon">
        <AlertIcon />
      </span>
      <h2>{t("admin.alert.title")}</h2>
      {alerts.map((alert) => (
        <p key={alert.limit}>{t(alertMessages[alert.limit], { percent: number(alert.percent) })}</p>
      ))}
      {onFree ? <p>{t("admin.alert.hint")}</p> : null}
    </section>
  )
}

const planQuestions: Readonly<
  Record<CloudflarePlan, { question: MessageKey; detail: MessageKey; confirm: MessageKey }>
> = {
  paid: {
    question: "admin.plan.paid.question",
    detail: "admin.plan.paid.detail",
    confirm: "admin.plan.paid.confirm",
  },
  free: {
    question: "admin.plan.free.question",
    detail: "admin.plan.free.detail",
    confirm: "admin.plan.free.confirm",
  },
}

// A choice in the switch only asks; the plan changes after the confirm step below it.
function PlanCard({
  plan,
  onSwitched,
}: {
  readonly plan: AdminPlanJson
  readonly onSwitched: () => void
}) {
  const { t } = useI18n()
  const questionId = useId()
  const [pending, setPending] = useState<CloudflarePlan | null>(null)
  const { message, busy, run } = useAction()
  const confirm = async (target: CloudflarePlan) => {
    const outcome = await run(
      () => switchPlan(target),
      (kind): MessageKey => (kind === "switched" ? "admin.plan.switched" : "admin.plan.failed"),
    )
    setPending(null)
    if (outcome === "switched") onSwitched()
  }
  return (
    <section className="card plan-card" aria-labelledby="plan">
      <h2 id="plan">{t("admin.plan.title")}</h2>
      <p className="muted">
        {t("admin.plan.hint")}{" "}
        <a href={cloudflarePlansUrl} target="_blank" rel="noreferrer">
          {t("admin.plan.link")}
        </a>
      </p>
      <SegmentRow
        name="cloudflare-plan"
        options={[
          { value: "free", label: t("admin.plan.free"), icon: null },
          { value: "paid", label: t("admin.plan.paid"), icon: <CloudIcon /> },
        ]}
        value={pending ?? plan.current}
        onSelect={(value) => setPending(value === plan.current ? null : value)}
        labels="shown"
      />
      {pending === null ? null : (
        <section className="plan-confirm" aria-labelledby={questionId}>
          <h3 id={questionId}>{t(planQuestions[pending].question)}</h3>
          <p>{t(planQuestions[pending].detail)}</p>
          <div className="actions">
            <button
              type="button"
              className="button text"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              <CloseIcon />
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void confirm(pending)}
            >
              <CloudIcon />
              {t(planQuestions[pending].confirm)}
            </button>
          </div>
        </section>
      )}
      <ActiveLimits limits={plan.limits} />
      {message === null ? null : <Status>{t(message)}</Status>}
    </section>
  )
}

function ActiveLimits({ limits }: { readonly limits: AdminPlanJson["limits"] }) {
  const { t, number } = useI18n()
  const perDay = (value: number | null) => (value === null ? t("admin.limits.none") : number(value))
  const monthly: readonly (readonly [MessageKey, number | null])[] = [
    ["admin.limits.workerPerMonth", limits.workerRequestsPerMonth],
    ["admin.limits.doPerMonth", limits.doRequestsPerMonth],
  ]
  const rows: readonly (readonly [MessageKey, string])[] = [
    ["admin.limits.workerPerDay", perDay(limits.workerRequestsPerDay)],
    ["admin.limits.doPerDay", perDay(limits.doRequestsPerDay)],
    // Only Paid includes a monthly amount; Free bills nothing.
    ...monthly.flatMap(([label, value]) =>
      value === null ? [] : [[label, number(value)] as const],
    ),
    ["admin.limits.subrequests", number(limits.subrequestsPerInvocation)],
  ]
  return (
    <>
      <h3 className="plan-limits-title">{t("admin.limits.title")}</h3>
      <dl className="plan-limits">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
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
  /** Null on a plan without a daily cap: the count shows without a bar. */
  readonly limit: number | null
}) {
  const { t, number } = useI18n()
  return (
    <div className="usage">
      <p className="usage-label">
        {icon}
        <strong>{label}</strong>
      </p>
      {limit === null ? null : <progress value={used} max={limit} aria-label={label} />}
      <p className="usage-text">
        {limit === null
          ? t("admin.usageNoLimit", { used: number(used) })
          : t("admin.usageText", { used: number(used), limit: number(limit) })}
      </p>
    </div>
  )
}

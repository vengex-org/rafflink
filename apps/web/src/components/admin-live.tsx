import { presenceKinds } from "@rafflink/core/presence/site-presence"
import type { AdminStats } from "../api/client.ts"
import { useI18n } from "../i18n/i18n.tsx"
import type { AdminStatsLoad } from "../lib/use-admin-stats.ts"
import { GrowthChart, MinuteChart } from "./admin-charts.tsx"
import { ActivityIcon, AlertIcon, EyeIcon, GiftIcon, UsersIcon } from "./icons.tsx"
import { InfoTip } from "./info-tip.tsx"
import { Stat } from "./live-parts.tsx"
import { Status } from "./notice.tsx"

/** A card's heading, with the longer explanation of what it counts behind an (i) beside it. */
export function CardTitle({
  id,
  title,
  info,
}: {
  readonly id: string
  readonly title: string
  readonly info: string
}) {
  return (
    <div className="card-title">
      <h2 id={id}>{title}</h2>
      <InfoTip topic={title} text={info} />
    </div>
  )
}

/** When the numbers were read, or that they could not be refreshed. */
export function LiveStatus({ load }: { readonly load: AdminStatsLoad }) {
  const { t, time } = useI18n()
  if (load.state === "loading") return null
  return (
    <>
      {load.state === "failed" ? <Status>{t("admin.live.failed")}</Status> : null}
      {load.stats === null ? null : (
        <p className="muted">{t("admin.live.updated", { time: time(load.stats.generatedAt) })}</p>
      )}
    </>
  )
}

/** The key numbers of this minute, the people on the site, the open giveaways, the last hour and the growth, each as a card of the admin grid. */
export function LiveCards({ stats }: { readonly stats: AdminStats }) {
  return (
    <>
      <LiveNow stats={stats} />
      <OnSite presence={stats.presence} />
      <OpenGiveaways stats={stats} />
      <LastHour stats={stats} />
      <Growth stats={stats} />
      <Referrals stats={stats} />
    </>
  )
}

function LiveNow({ stats }: { readonly stats: AdminStats }) {
  const { t, number } = useI18n()
  const rateLimited = stats.series.reduce((sum, point) => sum + point.rateLimited, 0)
  return (
    <section className="card" aria-labelledby="live-now">
      <h2 id="live-now">{t("admin.live.title")}</h2>
      <dl className="stats">
        <Stat
          icon={<GiftIcon />}
          value={number(stats.openGiveaways)}
          label={t("admin.live.openGiveaways")}
        />
        <Stat icon={<UsersIcon />} value={number(stats.viewers)} label={t("admin.live.viewers")} />
        <Stat
          icon={<ActivityIcon />}
          value={number(stats.entriesLastMinute)}
          label={t("admin.live.entriesMinute")}
        />
        <Stat
          icon={<ActivityIcon />}
          value={number(stats.claimsLastMinute)}
          label={t("admin.live.claimsMinute")}
        />
        <Stat
          icon={<AlertIcon />}
          value={number(rateLimited)}
          label={t("admin.live.rateLimitedHour")}
        />
      </dl>
      {stats.giveaways.length < stats.openGiveaways ? (
        <p className="muted">
          {t("admin.live.partial", {
            shown: number(stats.giveaways.length),
            total: number(stats.openGiveaways),
          })}
        </p>
      ) : null}
    </section>
  )
}

function OnSite({ presence }: { readonly presence: AdminStats["presence"] }) {
  const { t, number } = useI18n()
  return (
    <section className="card" aria-labelledby="on-site">
      <CardTitle id="on-site" title={t("admin.presence.title")} info={t("admin.presence.hint")} />
      {presence === "unavailable" ? (
        <p>{t("admin.presence.unavailable")}</p>
      ) : (
        <dl className="stats">
          <Stat
            icon={<UsersIcon />}
            value={number(presence.total)}
            label={t("admin.presence.total")}
          />
          {presenceKinds.map((kind) => (
            <Stat
              key={kind}
              icon={<EyeIcon />}
              value={number(presence.byKind[kind])}
              label={t(`admin.presence.${kind}`)}
            />
          ))}
        </dl>
      )}
    </section>
  )
}

function OpenGiveaways({ stats }: { readonly stats: AdminStats }) {
  const { t, number, dateTime } = useI18n()
  return (
    <section className="card live-giveaways" aria-labelledby="open-giveaways">
      <h2 id="open-giveaways">{t("admin.giveaways.title")}</h2>
      {stats.giveaways.length === 0 ? (
        <p className="muted">{t("admin.giveaways.none")}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">{t("admin.giveaways.streamer")}</th>
              <th scope="col">{t("admin.giveaways.giveaway")}</th>
              <th scope="col">{t("admin.giveaways.viewers")}</th>
              <th scope="col">{t("admin.giveaways.entries")}</th>
              <th scope="col">{t("admin.giveaways.ends")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.giveaways.map((giveaway) => (
              <tr key={giveaway.code}>
                <th scope="row">{giveaway.streamerName}</th>
                <td>{giveaway.title ?? giveaway.code}</td>
                <td>{giveaway.counts === null ? "–" : number(giveaway.counts.viewers)}</td>
                <td>{giveaway.counts === null ? "–" : number(giveaway.counts.entrants)}</td>
                <td>
                  {giveaway.closesAt === null
                    ? t("admin.giveaways.noEnd")
                    : dateTime(giveaway.closesAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function LastHour({ stats }: { readonly stats: AdminStats }) {
  const { t } = useI18n()
  return (
    <section className="card" aria-labelledby="last-hour">
      <CardTitle id="last-hour" title={t("admin.hour.title")} info={t("admin.hour.hint")} />
      <MinuteChart series={stats.series} />
    </section>
  )
}

function Growth({ stats }: { readonly stats: AdminStats }) {
  const { t, number } = useI18n()
  const { access } = stats
  const count = (value: number, truncated: boolean) =>
    truncated ? t("admin.growth.atLeast", { count: number(value) }) : number(value)
  return (
    <section className="card" aria-labelledby="growth">
      <h2 id="growth">{t("admin.growth.title")}</h2>
      <p className="muted">{t("admin.growth.hint", { days: number(stats.growth.length) })}</p>
      <GrowthChart growth={stats.growth} />
      <dl className="stats">
        <Stat
          icon={<UsersIcon />}
          value={number(stats.returningStreamers)}
          label={t("admin.growth.returning", { days: number(stats.returningWithinDays) })}
        />
        {access === null ? null : (
          <>
            <Stat
              icon={<UsersIcon />}
              value={count(access.pending, access.truncated)}
              label={t("admin.growth.pending")}
            />
            <Stat
              icon={<UsersIcon />}
              value={count(access.approved, access.truncated)}
              label={t("admin.growth.approved")}
            />
          </>
        )}
      </dl>
    </section>
  )
}

function Referrals({ stats }: { readonly stats: AdminStats }) {
  const { t, number } = useI18n()
  return (
    <section className="card" aria-labelledby="referrals">
      <CardTitle
        id="referrals"
        title={t("admin.refs.title")}
        info={t("admin.refs.hint", { days: number(stats.growth.length) })}
      />
      {stats.referrals.length === 0 ? (
        <p className="muted">{t("admin.refs.none")}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">{t("admin.refs.source")}</th>
              <th scope="col">{t("admin.refs.visits")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.referrals.map((row) => (
              <tr key={row.ref}>
                <th scope="row">{row.ref}</th>
                <td>{number(row.visits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

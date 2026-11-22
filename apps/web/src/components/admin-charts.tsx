import type { SeriesMinute, GrowthDay } from "@rafflink/core/stats/series"
import { useI18n } from "../i18n/i18n.tsx"

const width = 600
const height = 140
const pad = 6

/** Entries and claims per minute as two lines, a dashed vertical mark where the token endpoint answered 429. Colors come from the theme tokens, so it follows light and dark. */
export function MinuteChart({ series }: { readonly series: readonly SeriesMinute[] }) {
  const { t, number } = useI18n()
  const peak = Math.max(1, ...series.map((point) => Math.max(point.entries, point.claims)))
  const x = (index: number) => pad + (index * (width - 2 * pad)) / Math.max(1, series.length - 1)
  const y = (value: number) => height - pad - (value * (height - 2 * pad)) / peak
  const line = (pick: (point: SeriesMinute) => number) =>
    series.map((point, index) => `${x(index)},${y(pick(point))}`).join(" ")
  const total = (pick: (point: SeriesMinute) => number) =>
    series.reduce((sum, point) => sum + pick(point), 0)
  const label = t("admin.hour.label", {
    entries: number(total((point) => point.entries)),
    claims: number(total((point) => point.claims)),
    rateLimited: number(total((point) => point.rateLimited)),
  })
  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
      >
        <line
          className="chart-axis"
          x1={pad}
          x2={width - pad}
          y1={height - pad}
          y2={height - pad}
        />
        {series.map((point, index) =>
          point.rateLimited > 0 ? (
            <line
              key={point.minute}
              className="chart-mark"
              x1={x(index)}
              x2={x(index)}
              y1={pad}
              y2={height - pad}
            />
          ) : null,
        )}
        <polyline className="chart-line chart-entries" points={line((point) => point.entries)} />
        <polyline className="chart-line chart-claims" points={line((point) => point.claims)} />
      </svg>
      <figcaption>
        <ul className="chart-legend">
          <li data-series="entries">{t("admin.hour.entries")}</li>
          <li data-series="claims">{t("admin.hour.claims")}</li>
          <li data-series="rate-limited">{t("admin.hour.rateLimited")}</li>
        </ul>
        <span className="muted">{t("admin.hour.peak", { count: number(peak) })}</span>
      </figcaption>
    </figure>
  )
}

const barWidth = 14
const gap = 2

/** Giveaways created and new streamers per day as pairs of bars. */
export function GrowthChart({ growth }: { readonly growth: readonly GrowthDay[] }) {
  const { t, number, date } = useI18n()
  const peak = Math.max(1, ...growth.map((day) => Math.max(day.giveaways, day.streamers)))
  const slot = width / Math.max(1, growth.length)
  const barHeight = (value: number) => (value * (height - 2 * pad)) / peak
  const label = t("admin.growth.label", {
    giveaways: number(growth.reduce((sum, day) => sum + day.giveaways, 0)),
    streamers: number(growth.reduce((sum, day) => sum + day.streamers, 0)),
    days: number(growth.length),
  })
  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        preserveAspectRatio="none"
      >
        <line
          className="chart-axis"
          x1={pad}
          x2={width - pad}
          y1={height - pad}
          y2={height - pad}
        />
        {growth.map((day, index) => {
          const left = index * slot + (slot - 2 * barWidth - gap) / 2
          return (
            <g key={day.day}>
              <rect
                className="chart-bar chart-giveaways"
                x={left}
                y={height - pad - barHeight(day.giveaways)}
                width={barWidth}
                height={barHeight(day.giveaways)}
              >
                <title>{`${date(day.day)}: ${number(day.giveaways)}`}</title>
              </rect>
              <rect
                className="chart-bar chart-streamers"
                x={left + barWidth + gap}
                y={height - pad - barHeight(day.streamers)}
                width={barWidth}
                height={barHeight(day.streamers)}
              >
                <title>{`${date(day.day)}: ${number(day.streamers)}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      <figcaption>
        <ul className="chart-legend">
          <li data-series="giveaways">{t("admin.growth.giveaways")}</li>
          <li data-series="streamers">{t("admin.growth.streamers")}</li>
        </ul>
      </figcaption>
    </figure>
  )
}

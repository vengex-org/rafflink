import type { ResolvedConfig } from "@rafflink/core/config"
import { errorClass } from "@rafflink/core/lib/error-class"
import { UsageUnavailable } from "@rafflink/core/lib/usage-unavailable"
import type { Clock, VisitDay, VisitsMeter } from "@rafflink/core/ports"
import { dayMs, startOfDay } from "@rafflink/core/stats/time"
import { isRecord, readBody, type UsageFetch } from "./cloudflare-usage-meter.ts"

export type VisitsMeterConfig = Pick<
  ResolvedConfig,
  "cloudflareZoneId" | "cloudflareApiToken" | "cloudflareUsageUrl" | "cloudflareUsageTimeoutMs"
>

const visitsQuery = `query Visits($zoneTag: String!, $since: Date!, $until: Date!, $days: Int!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      days: httpRequests1dGroups(limit: $days, orderBy: [date_ASC], filter: { date_geq: $since, date_leq: $until }) {
        dimensions { date }
        sum { pageViews }
        uniq { uniques }
      }
    }
  }
}`

/**
 * Reads the zone's daily page views and unique visitors from the Cloudflare GraphQL Analytics API on every
 * call. Static pages come from the assets without a Worker request, so only zone analytics count them.
 * Without a zone id and API token it reports the visits as unavailable.
 */
export function createVisitsMeter(
  config: VisitsMeterConfig,
  clock: Clock,
  fetchImpl: UsageFetch,
): VisitsMeter {
  const { cloudflareZoneId: zoneId, cloudflareApiToken: apiToken } = config

  return {
    lastDays: async (days) => {
      if (zoneId === null || apiToken === null)
        throw new UsageUnavailable("CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN is not set")
      const today = startOfDay(clock.now())
      const first = today - (days - 1) * dayMs
      const response = await send(first, today, days)
      const rows = parseRows(await readBody(response, [zoneId, apiToken]))
      if (rows === null) throw new UsageUnavailable("Analytics answer has no visit numbers")
      return Array.from({ length: days }, (_, index) => {
        const day = first + index * dayMs
        return rows.get(day) ?? { day, pageViews: 0, uniqueVisitors: 0 }
      })
    },
  }

  async function send(first: number, today: number, days: number): Promise<Response> {
    try {
      return await fetchImpl(config.cloudflareUsageUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          query: visitsQuery,
          variables: {
            zoneTag: zoneId,
            since: isoDate(first),
            until: isoDate(today),
            days,
          },
        }),
        signal: AbortSignal.timeout(config.cloudflareUsageTimeoutMs),
      })
    } catch (error) {
      throw new UsageUnavailable(`Analytics request failed: ${errorClass(error)}`, { cause: error })
    }
  }
}

function isoDate(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10)
}

// A zone the token cannot read answers with an empty `zones` list instead of an error.
function parseRows(body: unknown): Map<number, VisitDay> | null {
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.viewer)) return null
  const { zones } = body.data.viewer
  const zone = Array.isArray(zones) ? zones[0] : null
  if (!isRecord(zone) || !Array.isArray(zone.days)) return null
  const rows = new Map<number, VisitDay>()
  for (const row of zone.days) {
    const visit = parseRow(row)
    if (visit === null) return null
    rows.set(visit.day, visit)
  }
  return rows
}

function parseRow(row: unknown): VisitDay | null {
  if (!isRecord(row) || !isRecord(row.dimensions) || !isRecord(row.sum) || !isRecord(row.uniq))
    return null
  const { date } = row.dimensions
  const { pageViews } = row.sum
  const { uniques } = row.uniq
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const day = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(day) || !isCount(pageViews) || !isCount(uniques)) return null
  return { day, pageViews, uniqueVisitors: uniques }
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

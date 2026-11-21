import type { ResolvedConfig } from "@rafflink/core/config"
import { errorClass } from "@rafflink/core/lib/error-class"
import type { Clock, UsageMeter } from "@rafflink/core/ports"
import { UsageUnavailable } from "@rafflink/core/lib/usage-unavailable"

export type UsageMeterConfig = Pick<
  ResolvedConfig,
  | "cloudflareAccountId"
  | "cloudflareApiToken"
  | "cloudflareUsageUrl"
  | "cloudflareUsageTimeoutMs"
  | "workerRequestLimit"
  | "durableObjectRequestLimit"
>

/** The `fetch` the meter sends its call through; the global `fetch` fits. */
export type UsageFetch = (input: string, init?: RequestInit) => Promise<Response>

const usageQuery = `query Usage($accountTag: String!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workers: workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $since, datetime_leq: $until }) {
        sum { requests }
      }
      durableObjects: durableObjectsInvocationsAdaptiveGroups(limit: 1, filter: { datetime_geq: $since, datetime_leq: $until }) {
        sum { requests }
      }
    }
  }
}`

/**
 * Reads the requests of the current UTC day from the Cloudflare GraphQL Analytics API on every call.
 * Without an account id and API token there is nothing to read, and the meter reports no limit.
 */
export function createUsageMeter(
  config: UsageMeterConfig,
  clock: Clock,
  fetchImpl: UsageFetch,
): UsageMeter {
  const { cloudflareAccountId: accountId, cloudflareApiToken: apiToken } = config
  if (accountId === null || apiToken === null) return { today: async () => null }

  return {
    today: async () => {
      const now = clock.now()
      const response = await send(now)
      const counts = parseCounts(await readBody(response, [accountId, apiToken]))
      if (counts === null) throw new UsageUnavailable("Analytics answer has no usage numbers")
      return {
        workerRequests: { used: counts.workerRequests, limit: config.workerRequestLimit },
        doRequests: { used: counts.durableObjectRequests, limit: config.durableObjectRequestLimit },
      }
    },
  }

  async function send(now: number): Promise<Response> {
    const since = new Date(now)
    since.setUTCHours(0, 0, 0, 0)
    try {
      return await fetchImpl(config.cloudflareUsageUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          query: usageQuery,
          variables: {
            accountTag: accountId,
            since: since.toISOString(),
            until: new Date(now).toISOString(),
          },
        }),
        signal: AbortSignal.timeout(config.cloudflareUsageTimeoutMs),
      })
    } catch (error) {
      throw new UsageUnavailable(`Analytics request failed: ${errorClass(error)}`, { cause: error })
    }
  }
}

async function readBody(response: Response, secrets: readonly string[]): Promise<unknown> {
  if (!response.ok) throw new UsageUnavailable(`Analytics answered ${response.status}`)
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new UsageUnavailable("Analytics answer is not JSON", { cause: error })
  }
  const messages = errorMessages(body)
  if (messages.length > 0)
    throw new UsageUnavailable(`Analytics answered errors: ${redact(messages.join("; "), secrets)}`)
  return body
}

// GraphQL reports an error with status 200: `errors` is a non-empty list, and `data` is then null or partial.
function errorMessages(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.errors)) return []
  return body.errors.map((error) => {
    if (!isRecord(error)) return "unknown error"
    const message = typeof error.message === "string" ? error.message : "unknown error"
    const code = isRecord(error.extensions) ? error.extensions.code : undefined
    return typeof code === "string" ? `${message} [${code}]` : message
  })
}

// Cloudflare echoes request values such as the account tag in its error messages.
function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce((result, secret) => result.replaceAll(secret, "[redacted]"), text)
}

interface Counts {
  readonly workerRequests: number
  readonly durableObjectRequests: number
}

function parseCounts(body: unknown): Counts | null {
  if (!isRecord(body)) return null
  const account = firstOf(isRecord(body.data) ? body.data.viewer : null, "accounts")
  if (!isRecord(account)) return null
  const workers = requestsOf(account.workers)
  const durableObjects = requestsOf(account.durableObjects)
  return workers === null || durableObjects === null
    ? null
    : { workerRequests: workers, durableObjectRequests: durableObjects }
}

function firstOf(parent: unknown, key: string): unknown {
  const list = isRecord(parent) ? parent[key] : null
  return Array.isArray(list) ? list[0] : null
}

// No row means no request was counted yet today.
function requestsOf(rows: unknown): number | null {
  if (!Array.isArray(rows)) return null
  if (rows.length === 0) return 0
  const sum = isRecord(rows[0]) ? rows[0].sum : null
  const requests = isRecord(sum) ? sum.requests : null
  return typeof requests === "number" && Number.isSafeInteger(requests) && requests >= 0
    ? requests
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

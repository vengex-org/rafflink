import { fileURLToPath } from "node:url"

/** The fields of `wrangler.jsonc` the tests read. */
export interface WranglerConfig {
  readonly compatibilityDate: string
  readonly compatibilityFlags: readonly string[]
  readonly crons: readonly string[]
  /** The `assets.run_worker_first` patterns: only these paths run the Worker. */
  readonly runWorkerFirst: readonly string[]
  readonly notFoundHandling: "single-page-application" | "404-page" | "none"
  /** The `ratelimits` bindings by binding name; the period is in seconds. */
  readonly rateLimits: Readonly<Record<string, RateLimitConfig>>
}

export interface RateLimitConfig {
  readonly namespaceId: string
  readonly limit: number
  readonly period: number
}

export const wranglerConfigPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url))

export async function readWranglerConfig(): Promise<WranglerConfig> {
  const parsed: unknown = Bun.JSONC.parse(await Bun.file(wranglerConfigPath).text())
  if (!isRecord(parsed)) throw new TypeError("wrangler.jsonc is not an object")
  const { compatibility_date: date, compatibility_flags: flags, triggers } = parsed
  const crons = isRecord(triggers) ? triggers.crons : undefined
  const assets = isRecord(parsed.assets) ? parsed.assets : {}
  const { not_found_handling: notFound, run_worker_first: workerFirst } = assets
  const rateLimits = parseRateLimits(parsed.ratelimits)
  if (
    typeof date !== "string"
    || !isStrings(flags)
    || !isStrings(crons)
    || !isStrings(workerFirst)
    || !isNotFoundHandling(notFound)
  ) {
    throw new TypeError(
      "wrangler.jsonc lacks compatibility_date, compatibility_flags, triggers.crons, assets.run_worker_first or a valid assets.not_found_handling",
    )
  }
  return {
    compatibilityDate: date,
    compatibilityFlags: flags,
    crons,
    runWorkerFirst: workerFirst,
    notFoundHandling: notFound,
    rateLimits,
  }
}

function parseRateLimits(value: unknown): Record<string, RateLimitConfig> {
  if (!Array.isArray(value)) throw new TypeError("wrangler.jsonc lacks ratelimits")
  const limits: Record<string, RateLimitConfig> = {}
  for (const item of value) {
    const simple = isRecord(item) ? item.simple : undefined
    if (
      !isRecord(item)
      || typeof item.name !== "string"
      || typeof item.namespace_id !== "string"
      || !isRecord(simple)
      || typeof simple.limit !== "number"
      || typeof simple.period !== "number"
    ) {
      throw new TypeError("a wrangler.jsonc ratelimits entry lacks name, namespace_id or simple")
    }
    limits[item.name] = {
      namespaceId: item.namespace_id,
      limit: simple.limit,
      period: simple.period,
    }
  }
  return limits
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNotFoundHandling(value: unknown): value is WranglerConfig["notFoundHandling"] {
  return value === "single-page-application" || value === "404-page" || value === "none"
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

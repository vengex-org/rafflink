import { fileURLToPath } from "node:url"

/** The fields of `wrangler.jsonc` the tests read. */
export interface WranglerConfig {
  readonly compatibilityDate: string
  readonly compatibilityFlags: readonly string[]
  readonly crons: readonly string[]
  readonly assetsBinding: string
  /** The `assets.run_worker_first` patterns; one starting with `!` is left to the assets. */
  readonly runWorkerFirst: readonly string[]
}

export const wranglerConfigPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url))

export async function readWranglerConfig(): Promise<WranglerConfig> {
  const parsed: unknown = Bun.JSONC.parse(await Bun.file(wranglerConfigPath).text())
  if (!isRecord(parsed)) throw new TypeError("wrangler.jsonc is not an object")
  const { compatibility_date: date, compatibility_flags: flags, triggers } = parsed
  const crons = isRecord(triggers) ? triggers.crons : undefined
  const assets = isRecord(parsed.assets) ? parsed.assets : {}
  const { binding, run_worker_first: workerFirst } = assets
  if (
    typeof date !== "string"
    || !isStrings(flags)
    || !isStrings(crons)
    || typeof binding !== "string"
    || !isStrings(workerFirst)
  ) {
    throw new TypeError(
      "wrangler.jsonc lacks compatibility_date, compatibility_flags, triggers.crons, assets.binding or assets.run_worker_first",
    )
  }
  return {
    compatibilityDate: date,
    compatibilityFlags: flags,
    crons,
    assetsBinding: binding,
    runWorkerFirst: workerFirst,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

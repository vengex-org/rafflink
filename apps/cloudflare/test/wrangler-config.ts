import { fileURLToPath } from "node:url"

/** The fields of `wrangler.jsonc` the tests read. */
export interface WranglerConfig {
  readonly compatibilityDate: string
  readonly compatibilityFlags: readonly string[]
  readonly crons: readonly string[]
}

export const wranglerConfigPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url))

export async function readWranglerConfig(): Promise<WranglerConfig> {
  const parsed: unknown = Bun.JSONC.parse(await Bun.file(wranglerConfigPath).text())
  if (!isRecord(parsed)) throw new TypeError("wrangler.jsonc is not an object")
  const { compatibility_date: date, compatibility_flags: flags, triggers } = parsed
  const crons = isRecord(triggers) ? triggers.crons : undefined
  if (typeof date !== "string" || !isStrings(flags) || !isStrings(crons)) {
    throw new TypeError(
      "wrangler.jsonc lacks compatibility_date, compatibility_flags or triggers.crons",
    )
  }
  return { compatibilityDate: date, compatibilityFlags: flags, crons }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

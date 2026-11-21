import { parseArgs } from "node:util"

export interface LoadPlan {
  /** Viewers that start a sign-in per second. */
  readonly rate: number
  readonly durationSeconds: number
  /** Share of viewers, in percent, that sign in a second time after the first sign-in answered. */
  readonly duplicatePercent: number
}

export interface LoadTestOptions {
  readonly plan: LoadPlan
  /** The fake Twitch answers 429 on the token endpoint above this many calls per second; null for no limit. */
  readonly tokenLimitPerSecond: number | null
}

export const usage = `Usage: bun run load-test -- [flags]
  --rate <n>             viewers started per second (default 500)
  --duration <s>         seconds to keep that rate (default 30)
  --duplicates <percent> viewers that enter a second time (default 5)
  --token-limit <n>      fake Twitch answers 429 on the token endpoint above n per second
The server and the fake Twitch are spawned on local ports; the load test only talks to localhost, 127.0.0.1 and [::1].`

/** Reads the CLI flags; throws a plain Error naming the bad flag. */
export function parseOptions(argv: readonly string[]): LoadTestOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      rate: { type: "string", default: "500" },
      duration: { type: "string", default: "30" },
      duplicates: { type: "string", default: "5" },
      "token-limit": { type: "string" },
    },
    strict: true,
  })
  const plan: LoadPlan = {
    rate: integer("rate", values.rate, 1),
    durationSeconds: integer("duration", values.duration, 1),
    duplicatePercent: integer("duplicates", values.duplicates, 0, 100),
  }
  const tokenLimit = values["token-limit"]
  return {
    plan,
    tokenLimitPerSecond: tokenLimit === undefined ? null : integer("token-limit", tokenLimit, 1),
  }
}

function integer(flag: string, text: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = Number(text)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${flag} must be an integer from ${min} to ${max}, got "${text}"`)
  }
  return value
}

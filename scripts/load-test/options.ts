import { parseArgs } from "node:util"
import { assertLocalUrl } from "./local-host.ts"

export interface LoadPlan {
  /** Viewers that start a sign-in per second. */
  readonly rate: number
  readonly durationSeconds: number
  /** Share of viewers, in percent, that sign in a second time after the first sign-in answered. */
  readonly duplicatePercent: number
}

export type TargetChoice =
  | { readonly kind: "spawn"; readonly tokenLimitPerSecond: number | null }
  | { readonly kind: "external"; readonly target: URL }

export interface LoadTestOptions {
  readonly plan: LoadPlan
  readonly targets: TargetChoice
}

export const usage = `Usage: bun run load-test -- [flags]
  --rate <n>             viewers started per second (default 500)
  --duration <s>         seconds to keep that rate (default 30)
  --duplicates <percent> viewers that enter a second time (default 5)
  --token-limit <n>      fake Twitch answers 429 on the token endpoint above n per second (spawned fake only)
  --target <url>         use a running local target instead of spawning the server and the fake Twitch;
                         its Twitch URLs must point at the fake started with SEED_USERS of at least rate x duration
Only localhost, 127.0.0.1 and [::1] are accepted.`

/** Reads the CLI flags; throws a plain Error naming the bad flag. */
export function parseOptions(argv: readonly string[]): LoadTestOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      rate: { type: "string", default: "500" },
      duration: { type: "string", default: "30" },
      duplicates: { type: "string", default: "5" },
      "token-limit": { type: "string" },
      target: { type: "string" },
    },
    strict: true,
  })
  const plan: LoadPlan = {
    rate: integer("rate", values.rate, 1),
    durationSeconds: integer("duration", values.duration, 1),
    duplicatePercent: integer("duplicates", values.duplicates, 0, 100),
  }
  const tokenLimit = values["token-limit"]
  if (values.target === undefined) {
    const tokenLimitPerSecond =
      tokenLimit === undefined ? null : integer("token-limit", tokenLimit, 1)
    return { plan, targets: { kind: "spawn", tokenLimitPerSecond } }
  }
  if (tokenLimit !== undefined) throw new Error("--token-limit applies to the spawned fake only")
  return { plan, targets: { kind: "external", target: assertLocalUrl(values.target) } }
}

function integer(flag: string, text: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = Number(text)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${flag} must be an integer from ${min} to ${max}, got "${text}"`)
  }
  return value
}

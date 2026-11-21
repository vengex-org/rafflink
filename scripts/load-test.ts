import { formatReport } from "./load-test/format-report.ts"
import { NonLocalUrlError } from "./load-test/local-host.ts"
import { parseOptions, usage, type LoadTestOptions } from "./load-test/options.ts"
import { runLoad, type LoadReport } from "./load-test/run-load.ts"
import { spawnTargets } from "./load-test/spawn-targets.ts"
import { devFakeTwitchUsers } from "../packages/fake-twitch/src/index.ts"

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}

/** Exit code 0 for a passing run, 1 for a failed check, 2 for bad flags or a target that is not local. */
async function main(argv: readonly string[]): Promise<number> {
  let options: LoadTestOptions
  try {
    options = parseOptions(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error(usage)
    return 2
  }
  try {
    const report = await run(options)
    console.info(formatReport(report))
    return report.failures.length === 0 ? 0 : 1
  } catch (error) {
    if (!(error instanceof NonLocalUrlError)) throw error
    console.error(error.message)
    return 2
  }
}

async function run({ plan, tokenLimitPerSecond }: LoadTestOptions): Promise<LoadReport> {
  const streamer = devFakeTwitchUsers[0]
  if (streamer === undefined) throw new Error("the dev fake Twitch has no streamer user")
  const spawned = await spawnTargets(
    streamer.id,
    plan.rate * plan.durationSeconds,
    tokenLimitPerSecond,
  )
  try {
    return await runLoad(spawned.load, plan)
  } finally {
    await spawned.stop()
  }
}

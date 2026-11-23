/**
 * Runs package scripts at the same time: `bun scripts/run-parallel.ts lint typecheck test:core`. Each script's output is
 * held back and printed whole when it fails, so the logs do not interleave. The first failure stops the others and
 * exits 1.
 */
export async function runParallel(scripts: readonly string[], cwd: string): Promise<number> {
  const started = performance.now()
  const runs: Run[] = []
  for (const script of scripts) {
    try {
      runs.push(start(script, cwd))
    } catch (error) {
      for (const run of runs) stopTree(run.child)
      console.error(`FAIL  ${script} did not start\n`, error)
      return 1
    }
  }

  let pending = runs
  while (pending.length > 0) {
    const finished = await Promise.race(pending.map(async (run) => ({ run, ...(await run.done) })))
    pending = pending.filter((run) => run !== finished.run)
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    if (finished.code === 0) {
      console.info(`ok    ${finished.run.script} (${seconds} s)`)
      continue
    }
    for (const run of pending) stopTree(run.child)
    console.error(`FAIL  ${finished.run.script} (exit ${finished.code}, ${seconds} s)\n`)
    console.error(finished.output)
    if (pending.length > 0) console.error(`Stopped: ${pending.map((run) => run.script).join(", ")}`)
    return 1
  }
  return 0
}

interface Run {
  readonly script: string
  readonly child: Bun.Subprocess
  /** Never rejects: a failed pipe counts as a failed script, so the others are still stopped. */
  readonly done: Promise<{ readonly code: number; readonly output: string }>
}

function start(script: string, cwd: string): Run {
  const child = Bun.spawn([process.execPath, "run", script], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" },
  })
  const done = (async () => {
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      return { code, output: `${stdout}\n${stderr}` }
    } catch (error) {
      return { code: 1, output: `could not read the output: ${String(error)}` }
    }
  })()
  return { script, child, done }
}

// The test workers of `bun test --parallel` and Miniflare's workerd run below `bun run`; a stop ends the whole tree so
// none of them keeps its ports. By PID only: other checks may be running bun at the same time.
function stopTree(child: Bun.Subprocess): void {
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(child.pid)], {
      stdout: "ignore",
      stderr: "ignore",
    })
  } else {
    child.kill("SIGKILL")
  }
}

if (import.meta.main) {
  const scripts = process.argv.slice(2)
  if (scripts.length === 0) {
    console.error("Usage: bun scripts/run-parallel.ts <script> [script...]")
    process.exit(2)
  }
  process.exit(await runParallel(scripts, process.cwd()))
}

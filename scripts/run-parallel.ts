/**
 * Runs package scripts at the same time: `bun scripts/run-parallel.ts lint typecheck test:core`. Each script's output is
 * held back and printed whole when it fails, so the logs do not interleave. The first failure stops the others and
 * exits 1.
 */
export async function runParallel(scripts: readonly string[], cwd: string): Promise<number> {
  const started = performance.now()
  const runs = scripts.map((script) => {
    const child = Bun.spawn(["bun", "run", script], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" },
    })
    const output = Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return {
      script,
      child,
      done: child.exited.then(async (code) => ({ code, output: await output })),
    }
  })

  let pending = runs
  while (pending.length > 0) {
    const finished = await Promise.race(pending.map(async (run) => ({ run, ...(await run.done) })))
    pending = pending.filter((run) => run !== finished.run)
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    if (finished.code === 0) {
      console.info(`ok    ${finished.run.script} (${seconds} s)`)
      continue
    }
    for (const run of pending) run.child.kill()
    console.error(`FAIL  ${finished.run.script} (exit ${finished.code}, ${seconds} s)\n`)
    console.error(finished.output.join("\n"))
    if (pending.length > 0) console.error(`Stopped: ${pending.map((run) => run.script).join(", ")}`)
    return 1
  }
  return 0
}

if (import.meta.main) {
  const scripts = process.argv.slice(2)
  if (scripts.length === 0) {
    console.error("Usage: bun scripts/run-parallel.ts <script> [script...]")
    process.exit(2)
  }
  process.exit(await runParallel(scripts, process.cwd()))
}

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runParallel } from "./run-parallel.ts"

let dir: string
let printed: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rafflink-run-parallel-"))
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      scripts: {
        ok: `bun -e "console.log('fine')"`,
        bad: `bun -e "await Bun.sleep(300); console.log('the reason'); process.exit(3)"`,
        slow: `bun -e "await Bun.sleep(3000); await Bun.write('slow-finished.txt', '')"`,
      },
    }),
  )
  printed = []
  const keep = (...parts: unknown[]) => void printed.push(parts.join(" "))
  spyOn(console, "info").mockImplementation(keep)
  spyOn(console, "error").mockImplementation(keep)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("runParallel", () => {
  it("exits 0 when every script passes", async () => {
    expect(await runParallel(["ok", "ok"], dir)).toBe(0)
  })

  it("exits 1 on the first failure, prints its output and stops the scripts still running", async () => {
    const started = performance.now()

    expect(await runParallel(["ok", "slow", "bad"], dir)).toBe(1)

    expect(performance.now() - started).toBeLessThan(2500)
    expect(printed.join("\n")).toContain("the reason")
    expect(printed.join("\n")).toContain("Stopped: slow")
    await Bun.sleep(3500)
    expect(existsSync(join(dir, "slow-finished.txt"))).toBe(false)
  }, 10_000)
})

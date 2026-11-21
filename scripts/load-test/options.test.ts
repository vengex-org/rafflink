import { describe, expect, it } from "bun:test"
import { NonLocalUrlError } from "./local-host.ts"
import { parseOptions } from "./options.ts"

describe("parseOptions", () => {
  it("defaults to 500 viewers per second for 30 seconds against spawned targets", () => {
    expect(parseOptions([])).toEqual({
      plan: { rate: 500, durationSeconds: 30, duplicatePercent: 5 },
      targets: { kind: "spawn", tokenLimitPerSecond: null },
    })
  })

  it("reads the rate, duration, duplicates and token limit flags", () => {
    expect(
      parseOptions([
        "--rate",
        "800",
        "--duration",
        "10",
        "--duplicates",
        "0",
        "--token-limit",
        "50",
      ]),
    ).toEqual({
      plan: { rate: 800, durationSeconds: 10, duplicatePercent: 0 },
      targets: { kind: "spawn", tokenLimitPerSecond: 50 },
    })
  })

  it("accepts a local target", () => {
    expect(parseOptions(["--target", "http://localhost:8787"]).targets).toEqual({
      kind: "external",
      target: new URL("http://localhost:8787"),
    })
  })

  it("refuses a target that is not local before anything runs", () => {
    expect(() => parseOptions(["--target", "https://rafflink.app"])).toThrow(NonLocalUrlError)
  })

  it.each([
    [["--rate", "0"]],
    [["--rate", "-5"]],
    [["--rate", "1.5"]],
    [["--rate", "NaN"]],
    [["--rate", "Infinity"]],
    [["--rate", ""]],
    [["--duration", "0"]],
    [["--duplicates", "101"]],
    [["--duplicates", "-1"]],
    [["--token-limit", "0"]],
    [["--unknown", "1"]],
  ])("rejects %j", (argv) => {
    expect(() => parseOptions(argv)).toThrow()
  })

  it("rejects a token limit together with a target, which has its own fake Twitch", () => {
    expect(() =>
      parseOptions(["--target", "http://localhost:8787", "--token-limit", "10"]),
    ).toThrow("--token-limit applies to the spawned fake only")
  })
})

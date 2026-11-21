import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { quicknet } from "../lib/drand.ts"
import type { Random } from "../ports.ts"
import { DrandBeacon, type DrandConfig } from "./drand-beacon.ts"

// Round 1,000,000 of quicknet as api.drand.sh published it.
const published = {
  round: 1_000_000,
  randomness: "b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3",
  signature:
    "83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72",
}

const config: DrandConfig = {
  drandUrl: "https://drand.test",
  drandRetryDelaysMs: [0, 0, 0],
  drandRetryJitterPercent: 0,
  drandTimeoutMs: 1000,
}

const random: Random = { bytes: (length) => new Uint8Array(length) }

type Reply = Response | Error

// Answers each call with the next reply, and records the URLs asked for.
function script(...replies: Reply[]) {
  const urls: string[] = []
  const fetchImpl = async (input: string | URL): Promise<Response> => {
    urls.push(String(input))
    const reply = replies.shift()
    if (reply === undefined) throw new Error("the script ran out of replies")
    if (reply instanceof Error) throw reply
    return reply
  }
  return { urls, fetchImpl, left: () => replies.length }
}

const ok = () => Response.json(published)
const status = (code: number) => new Response("", { status: code })

const broken = () => {
  const body = new ReadableStream({
    pull: (controller) => controller.error(new DOMException("timed out", "TimeoutError")),
  })
  return new Response(body, { status: 200 })
}

beforeEach(() => {
  spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  spyOn(console, "warn").mockRestore()
})

describe("DrandBeacon", () => {
  it("asks the pinned chain for the round and returns what drand published", async () => {
    const { urls, fetchImpl } = script(ok())

    const answer = await new DrandBeacon(config, fetchImpl, random).fetchRound(
      quicknet.chainHash,
      1_000_000,
    )

    expect(urls).toEqual([`https://drand.test/${quicknet.chainHash}/public/1000000`])
    expect(answer.kind).toBe("round")
    expect(answer.kind === "round" ? answer.round.signature : "").toBe(published.signature)
  })

  it("tries a round that is not published yet again, and returns it once it is", async () => {
    const { urls, fetchImpl } = script(status(425), status(404), ok())

    const answer = await new DrandBeacon(config, fetchImpl, random).fetchRound(
      quicknet.chainHash,
      1_000_000,
    )

    expect(urls).toHaveLength(3)
    expect(answer.kind).toBe("round")
  })

  it("says not-yet after the last retry when the round is still missing", async () => {
    const { urls, fetchImpl } = script(status(425), status(425), status(425), status(425))

    const answer = await new DrandBeacon(config, fetchImpl, random).fetchRound(
      quicknet.chainHash,
      1_000_000,
    )

    expect(urls).toHaveLength(4)
    expect(answer).toEqual({ kind: "not-yet" })
  })

  it("retries a 5xx, a 429 and a failed connection, then says unavailable", async () => {
    const { urls, fetchImpl } = script(status(503), status(429), new TypeError("down"), status(500))

    const answer = await new DrandBeacon(config, fetchImpl, random).fetchRound(
      quicknet.chainHash,
      1_000_000,
    )

    expect(urls).toHaveLength(4)
    expect(answer).toEqual({ kind: "unavailable" })
  })

  it("retries a timeout", async () => {
    const timeout = new DOMException("timed out", "TimeoutError")
    const { fetchImpl } = script(timeout, ok())

    const answer = await new DrandBeacon(config, fetchImpl, random).fetchRound(
      quicknet.chainHash,
      1_000_000,
    )

    expect(answer.kind).toBe("round")
  })

  it("retries a body that times out or breaks off, and says unavailable after the last retry", async () => {
    const { urls, fetchImpl } = script(broken(), broken(), ok())
    const first = await new DrandBeacon(config, fetchImpl, random).fetchRound(
      quicknet.chainHash,
      1_000_000,
    )
    expect([urls.length, first.kind]).toEqual([3, "round"])

    const down = script(broken(), broken(), broken(), broken())
    const second = await new DrandBeacon(config, down.fetchImpl, random).fetchRound(
      quicknet.chainHash,
      1_000_000,
    )
    expect([down.urls.length, second.kind]).toEqual([4, "unavailable"])
  })

  it("does not retry another 4xx", async () => {
    const { urls, fetchImpl } = script(status(400))

    const answer = await new DrandBeacon(config, fetchImpl, random).fetchRound(
      quicknet.chainHash,
      1_000_000,
    )

    expect(urls).toHaveLength(1)
    expect(answer).toEqual({ kind: "unavailable" })
  })

  it("does not retry an answer that does not check out", async () => {
    const forged = Response.json({ ...published, randomness: "00".repeat(32) })
    const notJson = new Response("<html>", { status: 200 })
    const wrongRound = Response.json({ ...published, round: 7 })

    for (const reply of [forged, notJson, wrongRound]) {
      const { urls, fetchImpl } = script(reply)

      const answer = await new DrandBeacon(config, fetchImpl, random).fetchRound(
        quicknet.chainHash,
        1_000_000,
      )

      expect(urls).toHaveLength(1)
      expect(answer).toEqual({ kind: "unavailable" })
    }
  })

  it("does not swallow an error that is not a network failure", async () => {
    const { fetchImpl } = script(new RangeError("bug"))

    await expect(
      new DrandBeacon(config, fetchImpl, random).fetchRound(quicknet.chainHash, 1),
    ).rejects.toThrow(RangeError)
  })
})

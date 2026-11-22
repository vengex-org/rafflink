import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent } from "@testing-library/react"
import { giveaway } from "./fixtures.ts"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

// Leaves, root and picks of a three-entrant giveaway, worked out outside the page: leaf hashes and root
// with Python hashlib, picks with Python hmac over round 1,000,000 of drand quicknet as api.drand.sh published it.
const chainHash = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
const leaves = {
  hashes: [
    "b1806720b4ba44dec717ed035df2047d0e183f586a708afc990420d61a17a7a4",
    "d5193ab98c3a16aa81722e34b5bcfe2016646b741dcdcbaac9e93c97d0b29668",
    "c926aa1ecaad6c82e89f5477e2efd6cd6df3c7cc830833c0a5c1d424e1b3d21c",
  ],
  tickets: [3, 1, 7],
}
const drawn = {
  status: "drawn",
  entrantCount: 3,
  ticketTotal: 11,
  winnerCount: 3,
  commitment: {
    merkleRoot: "18be196b36601399c0b0bfe7ce7b4738634d2bc11a25da1f4b0610218cc3b0de",
    chainHash,
    genesisSeconds: 1_692_803_367,
    periodSeconds: 3,
    round: 1_000_000,
    // Round 1,000,000 is published 999,999 periods after genesis; the commit is 30 s before that.
    committedAt: (1_692_803_367 + 999_999 * 3) * 1000 - 30_000,
  },
  picks: [
    { n: 0, leafIndex: 0, rerolled: false },
    { n: 1, leafIndex: 2, rerolled: false },
    { n: 2, leafIndex: 1, rerolled: false },
  ],
}
const round = {
  round: 1_000_000,
  randomness: "b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3",
  signature:
    "83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72",
}
const mine = {
  platform: "twitch",
  platformUserId: "100",
  tickets: 3,
  salt: "000102030405060708090a0b0c0d0e0f",
}

const first = `GET https://api.drand.sh/${chainHash}/public/1000000`
const second = `GET https://drand.cloudflare.com/${chainHash}/public/1000000`
const signedOut: Reply = { status: 401, body: { error: "unauthorized" } }

function routes(overrides: Record<string, () => Reply | Promise<Reply>> = {}) {
  return {
    "GET /api/g/ABCDE/verify": () => ok(drawn),
    "GET /api/g/ABCDE/leaves": () => ok(leaves),
    "GET /api/g/ABCDE/my-leaf": () => signedOut,
    [first]: () => ok(round),
    ...overrides,
  }
}

async function verified(overrides: Record<string, () => Reply | Promise<Reply>> = {}) {
  mockFetch(routes(overrides))
  const view = renderApp("/g/ABCDE/verify")
  fireEvent.click(await view.findByRole("button", { name: "Verify" }))
  return view
}

describe("verify page", () => {
  it("invites a viewer to run their own giveaway", async () => {
    mockFetch(routes())

    const view = renderApp("/g/ABCDE/verify")

    const link = await view.findByRole("link", { name: "Run your own giveaway with Rafflink" })
    expect(link.getAttribute("href")).toBe("/?ref=giveaway")
  })

  it("shows the root, the round and the entry list link, and the pick of each winner", async () => {
    mockFetch(routes())

    const view = renderApp("/g/ABCDE/verify")

    expect(await view.findByRole("heading", { level: 1, name: "Verify this draw" })).toBeTruthy()
    expect(view.getByText(drawn.commitment.merkleRoot)).toBeTruthy()
    expect(view.getByText(chainHash)).toBeTruthy()
    expect(view.getByRole("link", { name: "1000000" }).getAttribute("href")).toBe(
      `https://api.drand.sh/${chainHash}/public/1000000`,
    )
    expect(view.getByRole("link", { name: "Open the entry list" }).getAttribute("href")).toBe(
      "/api/g/ABCDE/leaves",
    )
    expect(view.getByText("Pick 1 is entry 1 of the list.")).toBeTruthy()
    expect(view.getByText("Pick 2 is entry 3 of the list.")).toBeTruthy()
    expect(view.getByText("Pick 3 is entry 2 of the list.")).toBeTruthy()
  })

  it("recomputes the root and the winners from the list and the drand round and says they match", async () => {
    const view = await verified()

    expect(
      await view.findByText("The list has as many entries and tickets as announced."),
    ).toBeTruthy()
    expect(view.getByText("The Merkle root of the list is the published root.")).toBeTruthy()
    expect(
      view.getByText(
        "The winners follow from the list and the random number of drand round 1000000.",
      ),
    ).toBeTruthy()
  })

  it("checks the BLS signature of the round as its own line", async () => {
    const view = await verified()

    expect(await view.findByText("The signature of drand round 1000000 is valid.")).toBeTruthy()
  })

  it("fails the whole verification when the signature of the round is not valid", async () => {
    // A forged round that keeps drand's link of randomness to signature, so only the BLS check can catch it.
    const forgedSignature = `${round.signature.slice(0, -1)}3`
    const digest = await crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from(forgedSignature.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16)),
    )
    const randomness = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")

    const view = await verified({
      [first]: () => ok({ ...round, signature: forgedSignature, randomness }),
    })

    expect(
      await view.findByText(
        "The signature of drand round 1000000 is not valid, so nothing below can be trusted.",
      ),
    ).toBeTruthy()
    expect(
      view.getByText(
        "The winners do not follow from the list and the random number of drand round 1000000.",
      ),
    ).toBeTruthy()
  })

  it("says the root does not match when the published root is not the root of the list", async () => {
    const forged = { ...drawn, commitment: { ...drawn.commitment, merkleRoot: "00".repeat(32) } }

    const view = await verified({ "GET /api/g/ABCDE/verify": () => ok(forged) })

    expect(
      await view.findByText("The Merkle root of the list is not the published root."),
    ).toBeTruthy()
  })

  it("says the root does not match when tickets were moved between leaves after the commit", async () => {
    const view = await verified({
      "GET /api/g/ABCDE/leaves": () => ok({ ...leaves, tickets: [4, 0, 7] }),
    })

    expect(
      await view.findByText("The Merkle root of the list is not the published root."),
    ).toBeTruthy()
  })

  it("checks the round was published after the list was fixed", async () => {
    const view = await verified()

    expect(
      await view.findByText("The drand round was published after the list was fixed."),
    ).toBeTruthy()
  })

  it("says the draw cannot be trusted when the round was published before the list was fixed", async () => {
    const early = { ...drawn.commitment, committedAt: drawn.commitment.committedAt + 60_000 }

    const view = await verified({
      "GET /api/g/ABCDE/verify": () => ok({ ...drawn, commitment: early }),
    })

    expect(
      await view.findByText(
        "The drand round was published before the list was fixed, so the draw cannot be trusted.",
      ),
    ).toBeTruthy()
  })

  it.each([
    ["fewer picks than the planned count", { winnerCount: 5, picks: drawn.picks.slice(0, 2) }],
    ["more picks than the planned count", { winnerCount: 1, picks: drawn.picks }],
  ])("checks %s as the seeded order the picks must follow", async (_name, change) => {
    const view = await verified({
      "GET /api/g/ABCDE/verify": () => ok({ ...drawn, ...change }),
    })

    expect(
      await view.findByText(
        "The winners follow from the list and the random number of drand round 1000000.",
      ),
    ).toBeTruthy()
  })

  it("shows the winner count, when the list was fixed and that the streamer may reroll", async () => {
    mockFetch(routes())

    const view = renderApp("/g/ABCDE/verify")

    expect(await view.findByText("Planned winners")).toBeTruthy()
    expect(view.getByText("List fixed at")).toBeTruthy()
    expect(
      view.getByText(/The streamer may reroll a winner who did not meet the conditions/),
    ).toBeTruthy()
  })

  it("lists every rerolled pick and how many rerolled picks came before each standing winner", async () => {
    const rerolls = {
      ...drawn,
      winnerCount: 2,
      picks: [
        { n: 0, leafIndex: 0, rerolled: true },
        { n: 1, leafIndex: 2, rerolled: false },
        { n: 2, leafIndex: 1, rerolled: false },
      ],
    }
    mockFetch(routes({ "GET /api/g/ABCDE/verify": () => ok(rerolls) }))

    const view = renderApp("/g/ABCDE/verify")

    expect(await view.findByText("Rerolled picks: 1.")).toBeTruthy()
    expect(view.getByText("Pick 1 is entry 1 of the list. (rerolled)")).toBeTruthy()
    expect(
      view.getByText("Pick 2 is entry 3 of the list. 1 rerolled picks came before it."),
    ).toBeTruthy()
  })

  it("says the counts do not match when the announced tickets differ from the list", async () => {
    const view = await verified({
      "GET /api/g/ABCDE/verify": () => ok({ ...drawn, ticketTotal: 12 }),
    })

    expect(
      await view.findByText("The list does not have the announced number of entries and tickets."),
    ).toBeTruthy()
  })

  it("says the winners do not follow when a published pick is another entry", async () => {
    const swapped = {
      ...drawn,
      picks: [{ n: 0, leafIndex: 1, rerolled: false }, ...drawn.picks.slice(1)],
    }

    const view = await verified({ "GET /api/g/ABCDE/verify": () => ok(swapped) })

    expect(
      await view.findByText(
        "The winners do not follow from the list and the random number of drand round 1000000.",
      ),
    ).toBeTruthy()
  })

  it("reads the round from the second drand API when the first fails", async () => {
    const view = await verified({
      [first]: () => ({ status: 500, body: "" }),
      [second]: () => ok(round),
    })

    expect(
      await view.findByText(
        "The winners follow from the list and the random number of drand round 1000000.",
      ),
    ).toBeTruthy()
  })

  it("does not trust a round whose randomness is not the hash of its signature", async () => {
    const view = await verified({
      [first]: () => ok({ ...round, randomness: "00".repeat(32) }),
      [second]: () => ({ status: 404, body: "" }),
    })

    expect(
      await view.findByText("Could not read drand round 1000000. Try again later."),
    ).toBeTruthy()
    expect(
      view.getByText("The signature of drand round 1000000 could not be checked."),
    ).toBeTruthy()
  })

  it("has nothing to compare before any winner is drawn", async () => {
    const closed = { ...drawn, status: "closed", picks: [] }

    const view = await verified({ "GET /api/g/ABCDE/verify": () => ok(closed) })

    expect(
      await view.findByText("No winners are drawn yet, so there is nothing to compare."),
    ).toBeTruthy()
  })

  it("asks a signed-out visitor to sign in to check their own entry", async () => {
    mockFetch(routes())

    const view = renderApp("/g/ABCDE/verify")

    expect(
      await view.findByText(/Sign in on the giveaway page with the account you entered with/),
    ).toBeTruthy()
  })

  it("shows the entrant their own values and finds their entry in the list", async () => {
    const view = await verified({ "GET /api/g/ABCDE/my-leaf": () => ok(mine) })

    expect(
      await view.findByText("Your entry is entry 1 of the list, with 3 tickets. You are pick 1."),
    ).toBeTruthy()
    expect(view.getByText(mine.salt)).toBeTruthy()
    expect(view.getByText("Salt (private)")).toBeTruthy()
  })

  it("says an entry that is not in the list is not in the list", async () => {
    const view = await verified({
      "GET /api/g/ABCDE/my-leaf": () => ok({ ...mine, tickets: 4 }),
    })

    expect(await view.findByText("Your entry is not in the list.")).toBeTruthy()
  })

  it("says a visitor without a salt yet has none, and does not check them", async () => {
    const view = await verified({ "GET /api/g/ABCDE/my-leaf": () => ok({ ...mine, salt: null }) })

    expect(await view.findByText(/Your entry has no salt yet/)).toBeTruthy()
    expect(view.queryByText("Your entry is not in the list.")).toBeNull()
  })

  it("waits while entries are open, and while the list is being fixed", async () => {
    mockFetch({
      "GET /api/g/ABCDE/verify": () =>
        ok({ ...drawn, status: "open", commitment: null, picks: [] }),
      "GET /api/g/ABCDE/my-leaf": () => signedOut,
    })

    const open = renderApp("/g/ABCDE/verify")
    expect(await open.findByText(/Entries are still open/)).toBeTruthy()
    cleanup()

    mockFetch({
      "GET /api/g/ABCDE/verify": () =>
        ok({ ...drawn, status: "closed", commitment: null, picks: [] }),
      "GET /api/g/ABCDE/my-leaf": () => signedOut,
    })
    const closed = renderApp("/g/ABCDE/verify")
    expect(await closed.findByText(/the list is being fixed/)).toBeTruthy()
  })

  it("says a giveaway drawn before draws could be verified has nothing to check", async () => {
    mockFetch({
      "GET /api/g/ABCDE/verify": () => ok({ ...drawn, commitment: null }),
      "GET /api/g/ABCDE/my-leaf": () => signedOut,
    })

    const view = renderApp("/g/ABCDE/verify")

    expect(await view.findByText(/drawn before draws could be verified/)).toBeTruthy()
    expect(view.queryByRole("button", { name: "Verify" })).toBeNull()
  })

  it("waits when the list is not published yet although the root is", async () => {
    mockFetch(routes({ "GET /api/g/ABCDE/leaves": () => ({ status: 409, body: {} }) }))

    const view = renderApp("/g/ABCDE/verify")

    expect(await view.findByText(/the list is being fixed/)).toBeTruthy()
  })

  it.each([
    ["a list whose hashes and tickets differ in length", { hashes: leaves.hashes, tickets: [3] }],
    ["a hash that is not 64 hex characters", { hashes: ["abc", "def", "ghi"], tickets: [3, 1, 7] }],
    ["a ticket count that is not a whole number", { hashes: leaves.hashes, tickets: [3, 1.5, 7] }],
  ])("shows the failure page for %s", async (_name, body) => {
    mockFetch(routes({ "GET /api/g/ABCDE/leaves": () => ok(body) }))

    const view = renderApp("/g/ABCDE/verify")

    expect(await view.findByText("Something went wrong. Reload the page.")).toBeTruthy()
  })

  it("shows the failure page when the viewer's leaf cannot be read", async () => {
    mockFetch(routes({ "GET /api/g/ABCDE/my-leaf": () => ({ status: 500, body: {} }) }))

    const view = renderApp("/g/ABCDE/verify")

    expect(await view.findByText("Something went wrong. Reload the page.")).toBeTruthy()
  })

  it("answers not found for a giveaway that does not exist", async () => {
    mockFetch({
      "GET /api/g/NOPE0/verify": () => ({ status: 404, body: { error: "not-found" } }),
      "GET /api/g/NOPE0/my-leaf": () => signedOut,
    })

    const view = renderApp("/g/NOPE0/verify")

    expect(await view.findByRole("heading", { level: 1, name: "Giveaway not found" })).toBeTruthy()
  })

  it("links a drawn giveaway to its verify page", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok({ ...giveaway, status: "drawn" }) })

    const view = renderApp("/g/ABCDE")

    expect((await view.findByRole("link", { name: "Verify this draw" })).getAttribute("href")).toBe(
      "/g/ABCDE/verify",
    )
  })

  it("does not link an open giveaway to a verify page", async () => {
    mockFetch({ "GET /api/g/ABCDE": () => ok(giveaway) })

    const view = renderApp("/g/ABCDE")

    await view.findByRole("heading", { level: 1 })
    expect(view.queryByRole("link", { name: "Verify this draw" })).toBeNull()
  })
})

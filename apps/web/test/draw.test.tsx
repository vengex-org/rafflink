import { afterEach, describe, expect, it, jest, mock, spyOn } from "bun:test"
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { quicknet, roundTime } from "@rafflink/core/lib/drand"
import {
  commitHash,
  listFile,
  parseShareFragment,
  shareFragment,
  type ListCommit,
} from "../src/lib/list-draw.ts"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
  jest.useRealTimers()
})

// Round 1,000,000 of drand quicknet as api.drand.sh published it; the winners below are worked out with
// Python hmac over these names in code-unit order, the same way the giveaway draw picks.
const round = {
  round: 1_000_000,
  randomness: "b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3",
  signature:
    "83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72",
}
const first = `GET https://api.drand.sh/${quicknet.chainHash}/public/1000000`
const second = `GET https://drand.cloudflare.com/${quicknet.chainHash}/public/1000000`
const unavailable: Reply = { status: 503, body: "" }
const seenBefore =
  "You opened this list before drand round 1000000 was published, so it was fixed before anyone could know the winners."

const names = ["Alice", "Bob", "Carol", "Dave", "Eve", "Zoë", "alice"]
const shortList: ListCommit = {
  title: "Cup",
  winners: 3,
  round: 1_000_000,
  committedAt: roundTime(quicknet, 1_000_000) - 60_000,
  names,
}
const longList: ListCommit = {
  ...shortList,
  winners: 2,
  names: Array.from({ length: 400 }, (_, i) => `name${i}`).toSorted(),
}

async function linkTo(commit: ListCommit): Promise<string> {
  return `/draw#${shareFragment(commit, await commitHash(commit)).fragment}`
}

function winnersOf(view: ReturnType<typeof renderApp>): string[] {
  const list = view.container.querySelector(".draw-winners")
  return Array.from(list?.querySelectorAll("li") ?? [], (item) => item.textContent)
}

function shareLink(view: ReturnType<typeof renderApp>): string {
  return view.getByRole("textbox", { name: "Share link" }).getAttribute("value") ?? ""
}

describe("list draw form", () => {
  it("states what the draw proves and that a fixed time is not proven", () => {
    mockFetch({})

    const view = renderApp("/draw")

    expect(view.getByRole("heading", { level: 1, name: "Draw from a list" })).toBeTruthy()
    expect(view.getByRole("heading", { name: "What this proves" })).toBeTruthy()
    expect(view.getByText(/comes from the browser that fixed it, not from a server/)).toBeTruthy()
    expect(view.getByText(/The names stay in your browser/)).toBeTruthy()
  })

  it("counts the unique names while they are pasted", () => {
    mockFetch({})
    const view = renderApp("/draw")

    fireEvent.change(view.getByLabelText("Names"), { target: { value: "Bob\nAlice\n Bob \n\n" } })

    expect(view.getByText("Names: 2. Repeats left out: 1.")).toBeTruthy()
  })

  it("asks for a name before it fixes an empty list", () => {
    mockFetch({})
    const view = renderApp("/draw")

    fireEvent.click(view.getByRole("button", { name: "Fix the list" }))

    expect(view.getByText("Add at least one name.")).toBeTruthy()
    expect(view.getByLabelText("Names").getAttribute("aria-invalid")).toBe("true")
  })

  it("refuses more winners than names", () => {
    mockFetch({})
    const view = renderApp("/draw")
    fireEvent.change(view.getByLabelText("Names"), { target: { value: "Alice\nBob" } })

    fireEvent.change(view.getByLabelText("Winners"), { target: { value: "3" } })
    fireEvent.click(view.getByRole("button", { name: "Fix the list" }))

    expect(view.getByText("Choose from 1 to 2 winners.")).toBeTruthy()
  })

  it("fixes the list to the round a minute ahead, then draws the winners once that round is out", async () => {
    jest.useFakeTimers()
    jest.setSystemTime(roundTime(quicknet, 1_000_000) - 60_000)
    const requests = mockFetch({ [first]: () => ok(round) })
    const view = renderApp("/draw")
    fireEvent.change(view.getByLabelText("Title (optional)"), { target: { value: " Cup " } })
    fireEvent.change(view.getByLabelText("Names"), { target: { value: names.join("\n") } })
    fireEvent.change(view.getByLabelText("Winners"), { target: { value: "3" } })

    fireEvent.click(view.getByRole("button", { name: "Fix the list" }))

    expect(
      await view.findByText("The winners are drawn when drand round 1000000 is published."),
    ).toBeTruthy()
    expect(view.getByRole("heading", { name: "Cup" })).toBeTruthy()
    expect(view.getByText(await commitHash(shortList))).toBeTruthy()
    expect(parseShareFragment(new URL(shareLink(view)).hash)?.names).toEqual(names)
    expect(requests.some((request) => request.route === first)).toBe(false)

    await act(async () => {
      jest.advanceTimersByTime(60_000)
    })
    // waitFor does not see Bun's fake timers and would wait on the frozen clock.
    jest.useRealTimers()

    await waitFor(() => expect(winnersOf(view)).toEqual(["Alice", "Dave", "alice"]))
    expect(
      view.getByText(
        "The winners follow from the list and the random number of drand round 1000000.",
      ),
    ).toBeTruthy()
    expect(view.getByText(seenBefore)).toBeTruthy()
    // No session lookup or any other call to this app's server: only the drand round leaves the page.
    expect(
      requests.map(
        (request) => new URL(request.route.split(" ")[1] ?? "", window.location.origin).host,
      ),
    ).toEqual(["api.drand.sh"])
  })

  it("says the commit failed and lets the list be fixed again", async () => {
    mockFetch({})
    spyOn(crypto.subtle, "digest").mockRejectedValueOnce(new DOMException("no digest"))
    const view = renderApp("/draw")
    fireEvent.change(view.getByLabelText("Names"), { target: { value: "Alice" } })

    fireEvent.click(view.getByRole("button", { name: "Fix the list" }))

    expect(await view.findByText("Something went wrong. Try again.")).toBeTruthy()
    expect(view.getByRole("button", { name: "Fix the list" }).hasAttribute("disabled")).toBe(false)
  })

  it("keeps a list too long for the link in this tab and offers it as a file", async () => {
    mockFetch({})
    const view = renderApp("/draw")
    fireEvent.change(view.getByLabelText("Names"), { target: { value: longList.names.join("\n") } })

    fireEvent.click(view.getByRole("button", { name: "Fix the list" }))

    expect(
      await view.findByText(
        "The list is too long for a link. Share the link together with the list file.",
      ),
    ).toBeTruthy()
    expect(parseShareFragment(new URL(shareLink(view)).hash)?.names).toBeNull()
    expect(view.queryByLabelText("List file")).toBeNull()
    expect(view.getByRole("button", { name: "Download the list file" })).toBeTruthy()
  })
})

describe("shared list draw", () => {
  it("recomputes the winners from the names in the link and the drand round", async () => {
    mockFetch({ [first]: () => ok(round) })

    const view = renderApp(await linkTo(shortList))

    await waitFor(() => expect(winnersOf(view)).toEqual(["Alice", "Dave", "alice"]))
    expect(view.queryByText(seenBefore)).toBeNull()
  })

  it("treats a file the browser cannot read as no list file", async () => {
    mockFetch({})
    const view = renderApp(await linkTo(longList))
    const unreadable = new File(["{}"], "draw.json")
    spyOn(unreadable, "text").mockRejectedValue(new DOMException("gone", "NotReadableError"))

    fireEvent.change(view.getByLabelText("List file"), { target: { files: [unreadable] } })

    expect(await view.findByText("This is not a list file.")).toBeTruthy()
  })

  it("draws a long list from the file that came with the link", async () => {
    mockFetch({ [first]: () => ok(round) })
    const view = renderApp(await linkTo(longList))
    const file = new File([listFile(longList)], "draw.json", { type: "application/json" })

    fireEvent.change(view.getByLabelText("List file"), { target: { files: [file] } })

    await waitFor(() => expect(winnersOf(view)).toEqual(["name363", "name346"]))
  })

  it("refuses a file that is not a list file", async () => {
    mockFetch({})
    const view = renderApp(await linkTo(longList))

    fireEvent.change(view.getByLabelText("List file"), {
      target: { files: [new File(["names"], "names.txt")] },
    })

    expect(await view.findByText("This is not a list file.")).toBeTruthy()
  })

  it("draws nothing and reads no round when the names do not match the hash of the link", async () => {
    const requests = mockFetch({})
    const params = new URLSearchParams(
      shareFragment(shortList, await commitHash(shortList)).fragment,
    )
    params.set("n", ["Mallory", ...names].join("\n"))

    const view = renderApp(`/draw#${params.toString()}`)

    expect(
      await view.findByText(
        "The names do not match the list hash. The link or the file was changed, so nothing is drawn.",
      ),
    ).toBeTruthy()
    expect(requests.some((request) => request.route.includes("drand"))).toBe(false)
  })

  it("says so when the link is broken", () => {
    mockFetch({})

    const view = renderApp("/draw#v=1&h=abc")

    expect(view.getByText("This draw link is broken or incomplete.")).toBeTruthy()
  })

  it("warns when the list claims a time after its round was published", async () => {
    mockFetch({ [first]: () => ok(round) })
    const late = { ...shortList, committedAt: roundTime(quicknet, 1_000_000) }

    const view = renderApp(await linkTo(late))

    expect(
      await view.findByText(
        "This list says it was fixed after drand round 1000000 was published, so the draw cannot be trusted.",
      ),
    ).toBeTruthy()
  })

  it("shows no winners when the signature of the round is not valid", async () => {
    // A forged round that keeps drand's link of randomness to signature, so only the BLS check can catch it.
    const forged = {
      ...round,
      signature:
        "83ac29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72",
      randomness: "885a1fbdfed4a3721bdad92a3ede3ffc74fc597d4f3216083a03419a6ff52809",
    }
    mockFetch({ [first]: () => ok(forged) })

    const view = renderApp(await linkTo(shortList))

    expect(
      await view.findByText(
        "The signature of drand round 1000000 is not valid, so no winners are shown.",
      ),
    ).toBeTruthy()
    expect(winnersOf(view)).toEqual([])
  })

  it("gives up after a few tries when no drand source answers, and draws on a retry", async () => {
    jest.useFakeTimers()
    let answering = false
    mockFetch({
      [first]: () => (answering ? ok(round) : unavailable),
      [second]: () => unavailable,
    })
    const view = renderApp(await linkTo(shortList))

    const gaveUp = () => view.queryByText("Could not read drand round 1000000. Try again later.")
    // Each try awaits two answers before its pause; the loop lets them settle, then skips the pause. setImmediate is
    // not faked and waits a whole event loop turn, which a busy machine needs for the answers.
    for (let step = 0; step < 50 && gaveUp() === null; step++) {
      await act(async () => {
        await new Promise<void>((resolve) => setImmediate(resolve))
        jest.advanceTimersByTime(500)
      })
    }

    expect(gaveUp()).toBeTruthy()
    jest.useRealTimers()
    answering = true
    fireEvent.click(view.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(winnersOf(view)).toEqual(["Alice", "Dave", "alice"]))
  })
})

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router"
import type { PresenceKind } from "@rafflink/core/presence/site-presence"
import { SitePresence } from "../src/components/site-presence.tsx"
import {
  presenceHealthyMs,
  presenceKindOf,
  presenceRetryDelayMs,
} from "../src/lib/use-site-presence.ts"
import { maxViewerSocketFailures, minViewerSocketGiveUpMs } from "../src/lib/use-viewer-push.ts"
import { FakeSocket, installFakeSocket } from "./fake-socket.ts"

let restoreSocket = () => {}
beforeEach(() => {
  restoreSocket = installFakeSocket()
})
afterEach(() => {
  cleanup()
  mock.restore()
  restoreSocket()
})

describe("presenceKindOf", () => {
  it.each<[string, PresenceKind]>([
    ["/", "home"],
    ["/privacy", "legal"],
    ["/terms", "legal"],
    ["/dashboard", "dashboard"],
    ["/dashboard/new", "dashboard"],
    ["/admin", "dashboard"],
    ["/ABCDE", "giveaway"],
    ["/ABCDE/verify", "giveaway"],
    ["/g/abcde", "giveaway"],
    ["/verify", "other"],
    ["/draw", "other"],
    ["/mod", "other"],
    ["/s/twitch/someone", "other"],
    ["/no-such-page", "other"],
  ])("counts %s as %s", (path, kind) => {
    expect(presenceKindOf(path)).toBe(kind)
  })

  it.each(["/overlay/g1/token", "/live/g1", "/mod/g1"])(
    "counts no stream page such as %s",
    (path) => {
      expect(presenceKindOf(path)).toBeNull()
    },
  )
})

describe("presenceRetryDelayMs", () => {
  it("doubles the delay with each failure in a row, scaled by the random factor", () => {
    expect([1, 2, 3, 4].map((failures) => presenceRetryDelayMs(failures, 0, 0.5))).toEqual([
      500, 1000, 2000, 4000,
    ])
  })

  it("gives up only after enough failures over enough time", () => {
    const many = maxViewerSocketFailures
    expect(presenceRetryDelayMs(many, minViewerSocketGiveUpMs, 0.5)).toBeNull()
    expect(presenceRetryDelayMs(many, minViewerSocketGiveUpMs - 1, 0.5)).not.toBeNull()
    expect(presenceRetryDelayMs(many - 1, minViewerSocketGiveUpMs, 0.5)).not.toBeNull()
  })
})

function freezeClock(): { now: number } {
  const clock = { now: 1_000_000 }
  spyOn(Date, "now").mockImplementation(() => clock.now)
  return clock
}

function renderAt(path: string) {
  let navigate: NavigateFunction | null = null
  function Probe() {
    const navigation = useNavigate()
    useEffect(() => {
      navigate = navigation
    })
    return null
  }
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <SitePresence />
    </MemoryRouter>,
  )
  return {
    go: (to: string) =>
      act(() => {
        void navigate?.(to)
      }),
  }
}

function opened(count: number): Promise<FakeSocket> {
  return waitFor(() => {
    expect(FakeSocket.opened).toHaveLength(count)
    const socket = FakeSocket.opened[count - 1]
    if (socket === undefined) throw new Error("no socket")
    return socket
  })
}

// A reconnect with Math.random 0 is a timer of 0 ms; a few turns of the event loop let it run.
function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))
}

// happy-dom's PageTransitionEvent drops `persisted` from its init, so the event gets it as an own property.
function pageTransition(type: "pagehide" | "pageshow"): Event {
  const event = new Event(type)
  Object.defineProperty(event, "persisted", { value: true })
  return event
}

describe("SitePresence", () => {
  it("opens one socket with the kind of the page and sends nothing", async () => {
    renderAt("/privacy")

    const socket = await opened(1)
    act(() => socket.open())
    await settle()

    expect(FakeSocket.opened).toHaveLength(1)
    expect(socket.url).toEndWith("/api/presence?kind=legal")
    expect(socket.url).toStartWith("ws")
    expect(socket.sent).toEqual([])
  })

  it("opens no socket on the overlay", async () => {
    renderAt("/overlay/g1/token")
    await settle()

    expect(FakeSocket.opened).toHaveLength(0)
  })

  it("reconnects after a drop", async () => {
    spyOn(Math, "random").mockReturnValue(0)
    renderAt("/")

    act(() => FakeSocket.opened[0]?.drop())

    expect((await opened(2)).url).toEndWith("kind=home")
  })

  it("gives up after enough failures over enough time and opens no more sockets", async () => {
    spyOn(Math, "random").mockReturnValue(0)
    spyOn(console, "warn").mockImplementation(() => {})
    const clock = freezeClock()
    renderAt("/")

    for (let attempt = 1; attempt < maxViewerSocketFailures; attempt++) {
      const socket = await opened(attempt)
      act(() => socket.drop())
    }
    const last = await opened(maxViewerSocketFailures)
    clock.now += minViewerSocketGiveUpMs
    act(() => last.drop())
    await settle()

    expect(FakeSocket.opened).toHaveLength(maxViewerSocketFailures)
  })

  it("starts a new streak after a socket that stayed open, so it keeps reconnecting", async () => {
    spyOn(Math, "random").mockReturnValue(0)
    const clock = freezeClock()
    renderAt("/")

    for (let attempt = 1; attempt < maxViewerSocketFailures; attempt++) {
      const socket = await opened(attempt)
      act(() => socket.drop())
    }
    const healthy = await opened(maxViewerSocketFailures)
    act(() => healthy.open())
    clock.now += Math.max(presenceHealthyMs, minViewerSocketGiveUpMs)
    act(() => healthy.drop())

    await opened(maxViewerSocketFailures + 1)
  })

  it("closes the socket on pagehide without reconnecting, and opens it again when the page comes back from the cache", async () => {
    spyOn(Math, "random").mockReturnValue(0)
    renderAt("/")
    const socket = await opened(1)

    act(() => void window.dispatchEvent(pageTransition("pagehide")))
    act(() => socket.drop())
    await settle()
    const afterHide = FakeSocket.opened.length
    act(() => void window.dispatchEvent(pageTransition("pageshow")))

    expect(socket.closed).toBe(true)
    expect(afterHide).toBe(1)
    expect((await opened(2)).url).toEndWith("kind=home")
  })

  it("moves to a socket of the new kind when the page kind changes, and keeps it within one kind", async () => {
    const view = renderAt("/")
    const home = await opened(1)

    view.go("/terms")
    const legal = await opened(2)
    view.go("/privacy")
    await settle()

    expect(home.closed).toBe(true)
    expect(legal.url).toEndWith("kind=legal")
    expect(FakeSocket.opened).toHaveLength(2)
  })
})

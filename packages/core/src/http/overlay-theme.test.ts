import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import {
  Browser,
  createGiveaway,
  createHarness,
  InProcessRooms,
  users,
  type Harness,
} from "../../test/app-fixture.ts"
import { defaultOverlayTheme, type OverlayTheme } from "../domain/overlay-theme.ts"
import { RoomTransientError } from "../room/room-directory.ts"

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  mock.restore()
  await harness.stop()
})

const branded: OverlayTheme = {
  ...defaultOverlayTheme,
  accent: "#ff5500",
  font: "oswald",
  size: "large",
  position: "bottom-right",
}
const special: OverlayTheme = { ...defaultOverlayTheme, corners: "square", confetti: true }

async function signedIn(userId: string = users.streamerA.id): Promise<Browser> {
  const browser = new Browser(harness)
  await browser.signInAs(userId, "/auth/twitch/streamer/start")
  return browser
}

async function overlayTheme(id: string, token: string): Promise<Response> {
  return new Browser(harness).request(`/api/overlay/${id}/${token}/theme`)
}

describe("streamer overlay theme", () => {
  it("answers the default theme until the streamer saves one", async () => {
    const browser = await signedIn()

    const response = await browser.request("/api/dash/overlay-theme")

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ theme: defaultOverlayTheme })
  })

  it("saves a theme and answers it from then on", async () => {
    const browser = await signedIn()

    const saved = await browser.postJson("/api/dash/overlay-theme", branded)

    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ kind: "saved", theme: branded })
    expect(await (await browser.request("/api/dash/overlay-theme")).json()).toEqual({
      theme: branded,
    })
    const other = await signedIn(users.streamerB.id)
    expect(await (await other.request("/api/dash/overlay-theme")).json()).toEqual({
      theme: defaultOverlayTheme,
    })
  })

  it.each([
    [
      { ...branded, accent: "url(x)" },
      { field: "accent", code: "not-a-color" },
    ],
    [
      { ...branded, font: "papyrus" },
      { field: "font", code: "unknown-option" },
    ],
    [
      { ...branded, sound: "yes" },
      { field: "sound", code: "not-a-boolean" },
    ],
    [{ accent: "#ff5500" }, { field: "background", code: "missing" }],
    [[], { field: "theme", code: "not-an-object" }],
  ])("refuses %p and keeps the stored theme", async (body, issue) => {
    const browser = await signedIn()
    await browser.postJson("/api/dash/overlay-theme", branded)

    const response = await browser.postJson("/api/dash/overlay-theme", body)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid-input", ...issue })
    expect(await (await browser.request("/api/dash/overlay-theme")).json()).toEqual({
      theme: branded,
    })
  })

  it("refuses a body that is not JSON", async () => {
    const browser = await signedIn()

    const response = await browser.request("/api/dash/overlay-theme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })

    expect(response.status).toBe(400)
  })

  it("needs a session", async () => {
    const anonymous = new Browser(harness)

    expect((await anonymous.request("/api/dash/overlay-theme")).status).toBe(401)
    expect((await anonymous.postJson("/api/dash/overlay-theme", branded)).status).toBe(401)
  })
})

/** Replaces every room's theme push with `push`; the rest of each room stays real. */
function stubPush(push: (giveawayId: string, theme: OverlayTheme) => Promise<void>): void {
  const rooms = harness.rooms
  spyOn(rooms, "get").mockImplementation(function (this: typeof rooms, giveawayId: string) {
    const stub = InProcessRooms.prototype.get.call(this, giveawayId)
    return Object.assign(Object.create(stub), {
      pushOverlayTheme: (theme: OverlayTheme) => push(giveawayId, theme),
    })
  })
}

/** Records the theme pushes from here on. */
function pushes(): { giveawayId: string; theme: OverlayTheme }[] {
  const pushed: { giveawayId: string; theme: OverlayTheme }[] = []
  stubPush(async (giveawayId, theme) => {
    pushed.push({ giveawayId, theme })
  })
  return pushed
}

describe("overlay theme push on save", () => {
  it("pushes a streamer's theme to the overlays of the giveaways not drawn yet that show it", async () => {
    const first = await createGiveaway(harness)
    const own = await createGiveaway(harness)
    await own.browser.postJson(`/api/dash/giveaways/${own.id}/overlay-theme`, { theme: special })
    const other = await createGiveaway(harness, users.streamerB.id)
    const pushed = pushes()

    await first.browser.postJson("/api/dash/overlay-theme", branded)

    expect(pushed).toEqual([{ giveawayId: first.id, theme: branded }])
    expect(pushed.some((push) => push.giveawayId === other.id)).toBe(false)
  })

  it("pushes a giveaway's own theme, and the streamer's once it is reset", async () => {
    const { browser, id } = await createGiveaway(harness)
    await browser.postJson("/api/dash/overlay-theme", branded)
    const pushed = pushes()
    const path = `/api/dash/giveaways/${id}/overlay-theme`

    await browser.postJson(path, { theme: special })
    await browser.postJson(path, { theme: null })

    expect(pushed).toEqual([
      { giveawayId: id, theme: special },
      { giveawayId: id, theme: branded },
    ])
  })

  it("keeps a saved theme when a room cannot be reached", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const { browser, id } = await createGiveaway(harness)
    stubPush(async () => {
      throw new RoomTransientError("down")
    })

    const saved = await browser.postJson("/api/dash/overlay-theme", branded)

    expect(saved.status).toBe(200)
    expect(await (await browser.request("/api/dash/overlay-theme")).json()).toEqual({
      theme: branded,
    })
    expect(warn).toHaveBeenCalledWith("overlay theme push failed", {
      giveawayId: id,
      errorClass: "RoomTransientError",
    })
  })
})

describe("giveaway overlay theme", () => {
  it("follows the streamer's theme until the giveaway gets its own, and again after a reset", async () => {
    const { browser, id, overlayToken } = await createGiveaway(harness)
    await browser.postJson("/api/dash/overlay-theme", branded)
    const path = `/api/dash/giveaways/${id}/overlay-theme`

    expect(await (await browser.request(path)).json()).toEqual({ own: null, streamer: branded })
    expect(await (await overlayTheme(id, overlayToken)).json()).toEqual({ theme: branded })

    const set = await browser.postJson(path, { theme: special })
    expect(set.status).toBe(200)
    expect(await set.json()).toEqual({ kind: "saved", own: special })
    expect(await (await browser.request(path)).json()).toEqual({ own: special, streamer: branded })
    expect(await (await overlayTheme(id, overlayToken)).json()).toEqual({ theme: special })

    const reset = await browser.postJson(path, { theme: null })
    expect(await reset.json()).toEqual({ kind: "saved", own: null })
    expect(await (await overlayTheme(id, overlayToken)).json()).toEqual({ theme: branded })
  })

  it.each([[{}], [{ theme: { position: "middle" } }], [{ theme: "dark" }], [null]])(
    "refuses %p",
    async (body) => {
      const { browser, id } = await createGiveaway(harness)

      const response = await browser.postJson(`/api/dash/giveaways/${id}/overlay-theme`, body)

      expect(response.status).toBe(400)
      const answer: { error: string } = await response.json()
      expect(answer.error).toBe("invalid-input")
    },
  )

  it("treats another streamer's giveaway as missing", async () => {
    const { id, overlayToken } = await createGiveaway(harness)
    const other = await signedIn(users.streamerB.id)
    const path = `/api/dash/giveaways/${id}/overlay-theme`

    expect((await other.request(path)).status).toBe(404)
    expect((await other.postJson(path, { theme: special })).status).toBe(404)
    expect(await (await overlayTheme(id, overlayToken)).json()).toEqual({
      theme: defaultOverlayTheme,
    })
  })
})

describe("overlay theme for OBS", () => {
  it("answers the theme without a session and never from a cache", async () => {
    const { id, overlayToken } = await createGiveaway(harness)

    const response = await overlayTheme(id, overlayToken)

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ theme: defaultOverlayTheme })
  })

  it("answers a wrong token and an unknown giveaway like a missing one", async () => {
    const { id } = await createGiveaway(harness)

    expect((await overlayTheme(id, "wrong")).status).toBe(404)
    expect((await overlayTheme("missing", "wrong")).status).toBe(404)
  })
})

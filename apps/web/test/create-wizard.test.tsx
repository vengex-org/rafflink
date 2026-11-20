import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, type RenderResult } from "@testing-library/react"
import { stubClipboard } from "./clipboard.ts"
import { dashboardGiveaway } from "./fixtures.ts"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
import { inputOf } from "./queries.ts"
import { renderApp } from "./render-app.tsx"

afterEach(() => {
  cleanup()
  mock.restore()
})

const listed = { "GET /api/dash/giveaways": () => ok({ giveaways: [dashboardGiveaway] }) }
const createdReply: Reply = {
  status: 201,
  body: { giveaway: dashboardGiveaway, roomReady: true, warnings: [] },
}

function withCreate(reply: Reply) {
  return { ...listed, "POST /api/dash/giveaways": () => reply }
}

async function openWizard(): Promise<RenderResult> {
  const view = renderApp("/dashboard")
  fireEvent.click(await view.findByRole("button", { name: "New giveaway" }))
  await view.findByText("Step 1 of 4: What you give away")
  return view
}

function next(view: RenderResult) {
  fireEvent.click(view.getByRole("button", { name: "Next" }))
}

function fillGiveaway(view: RenderResult) {
  fireEvent.change(view.getByLabelText("Giveaway name (optional)"), { target: { value: "Cup" } })
  fireEvent.change(view.getByLabelText("What does the winner get? (optional)"), {
    target: { value: "A chair" },
  })
}

async function toReview(view: RenderResult) {
  fillGiveaway(view)
  next(view)
  await view.findByText("Step 2 of 4: Who can enter")
  next(view)
  await view.findByText("Step 3 of 4: When it ends")
  next(view)
  await view.findByText("Step 4 of 4: Review")
}

describe("create wizard", () => {
  it("starts at step 1 and cancels back to the list", async () => {
    mockFetch(listed)
    const view = await openWizard()

    expect(view.getByRole("heading", { name: "What are you giving away?" })).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Cancel" }))

    expect(await view.findByRole("heading", { name: "My giveaways" })).toBeTruthy()
  })

  it("lets the streamer go on without a name and a prize", async () => {
    mockFetch(listed)
    const view = await openWizard()

    next(view)

    expect(await view.findByText("Step 2 of 4: Who can enter")).toBeTruthy()
    expect(view.queryByRole("alert")).toBeNull()
  })

  it("offers Everyone, Followers only and Subscribers only with Everyone chosen", async () => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 4: Who can enter")

    const everyone = inputOf(view.getByRole("radio", { name: /Everyone/ }))
    expect(everyone.checked).toBe(true)
    expect(view.getByRole("radio", { name: /Followers only/ })).toBeTruthy()
    expect(view.getByRole("radio", { name: /Subscribers only/ })).toBeTruthy()
    expect(view.getByText("Extra tickets (optional)")).toBeTruthy()
  })

  it.each([
    ["Extra tickets: a negative number", "VIPs", "-1", "Enter a whole number, 0 or more."],
    ["Extra tickets: a fraction", "VIPs", "1.5", "Enter a whole number, 0 or more."],
    ["Extra tickets: empty", "Moderators", "", "Enter a whole number, 0 or more."],
    [
      "Account age: a fraction",
      "Minimum account age in days (optional)",
      "2.5",
      "Enter a whole number of days, or leave it empty.",
    ],
  ])("stays on step 2 for %s", async (_name, label, value, message) => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 4: Who can enter")

    fireEvent.change(view.getByLabelText(label), { target: { value } })
    next(view)

    expect(view.getByText(message)).toBeTruthy()
    expect(view.getByLabelText(label).getAttribute("aria-invalid")).toBe("true")
    expect(view.getByText("Step 2 of 4: Who can enter")).toBeTruthy()
  })

  it("asks for an end time when entries end at a set time, and not for one in the past", async () => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 4: Who can enter")
    next(view)
    await view.findByText("Step 3 of 4: When it ends")
    expect(view.queryByLabelText("Entries end at")).toBeNull()

    fireEvent.click(view.getByRole("radio", { name: /At a set time/ }))
    next(view)
    expect(view.getByText("Pick the date and time when entries end.")).toBeTruthy()

    fireEvent.change(view.getByLabelText("Entries end at"), {
      target: { value: "2000-01-01T10:00" },
    })
    next(view)
    expect(view.getByText("Pick a time in the future.")).toBeTruthy()

    fireEvent.change(view.getByLabelText("Entries end at"), {
      target: { value: "2099-01-01T10:00" },
    })
    next(view)
    expect(await view.findByText("Step 4 of 4: Review")).toBeTruthy()
  })

  it("goes back a step and keeps the answers", async () => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 4: Who can enter")

    fireEvent.click(view.getByRole("button", { name: "Back" }))

    expect(await view.findByText("Step 1 of 4: What you give away")).toBeTruthy()
    expect(inputOf(view.getByLabelText("Giveaway name (optional)")).value).toBe("Cup")
    expect(view.queryByRole("button", { name: "Back" })).toBeNull()
  })

  it("moves the keyboard focus to the new step heading", async () => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)

    next(view)

    expect(
      (await view.findByRole("heading", { name: "Who can enter?" })) === document.activeElement,
    ).toBe(true)
  })

  it("keeps the focus in a field while the streamer types into it", async () => {
    mockFetch(listed)
    const view = await openWizard()
    const title = inputOf(view.getByLabelText("Giveaway name (optional)"))
    title.focus()

    for (const typed of ["C", "Cu", "Cup", "Cup "]) {
      fireEvent.change(title, { target: { value: typed } })

      expect(inputOf(view.getByLabelText("Giveaway name (optional)")) === title).toBe(true)
      expect(title.value).toBe(typed)
      expect(document.activeElement === title).toBe(true)
    }
  })

  it("reviews the answers in plain sentences", async () => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 4: Who can enter")
    fireEvent.click(view.getByRole("radio", { name: /Subscribers only/ }))
    fireEvent.change(view.getByLabelText("Subscribers, tier 1"), { target: { value: "3" } })
    fireEvent.change(view.getByLabelText("Minimum account age in days (optional)"), {
      target: { value: "7" },
    })
    next(view)
    await view.findByText("Step 3 of 4: When it ends")
    fireEvent.click(view.getByRole("radio", { name: /10 minutes/ }))
    fireEvent.change(view.getByLabelText("Chat word (optional)"), { target: { value: "mine" } })
    next(view)
    await view.findByText("Step 4 of 4: Review")

    expect(view.getByText("Cup")).toBeTruthy()
    expect(view.getByText("A chair")).toBeTruthy()
    expect(view.getByText("Only subscribers can enter.")).toBeTruthy()
    expect(view.getByText("Subscribers, tier 1: 3 tickets")).toBeTruthy()
    expect(view.getByText("Accounts must be at least 7 days old.")).toBeTruthy()
    expect(view.getByText("When you close them.")).toBeTruthy()
    expect(view.getByText('10 minutes. The winner can also type "mine" in your chat.')).toBeTruthy()
    expect(view.getByRole("button", { name: "Start giveaway" })).toBeTruthy()
  })

  it("sends the answers as the API expects", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 4: Who can enter")
    fireEvent.click(view.getByRole("radio", { name: /Subscribers only/ }))
    fireEvent.change(view.getByLabelText("VIPs"), { target: { value: "5" } })
    fireEvent.change(view.getByLabelText("Minimum account age in days (optional)"), {
      target: { value: "7" },
    })
    next(view)
    await view.findByText("Step 3 of 4: When it ends")
    next(view)
    await view.findByText("Step 4 of 4: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    expect(requests.find((request) => request.route === "POST /api/dash/giveaways")?.body).toEqual({
      title: "Cup",
      prize: "A chair",
      rules: {
        tickets: { viewer: 1, follower: 1, sub_t1: 1, sub_t2: 1, sub_t3: 1, vip: 5, moderator: 1 },
        subsOnly: true,
        followersOnly: false,
        minAccountAgeDays: 7,
        claimKeyword: "",
      },
      claimSeconds: 300,
    })
  })

  it("sends a blank name and prize and reviews them as not set", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    next(view)
    await view.findByText("Step 2 of 4: Who can enter")
    next(view)
    await view.findByText("Step 3 of 4: When it ends")
    next(view)
    await view.findByText("Step 4 of 4: Review")

    expect(view.getAllByText("Not set")).toHaveLength(2)
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    const sent = requests.find((request) => request.route === "POST /api/dash/giveaways")
    expect(sent?.body).toMatchObject({ title: "", prize: "" })
  })

  it("sends the end time as an instant", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 4: Who can enter")
    next(view)
    await view.findByText("Step 3 of 4: When it ends")
    fireEvent.click(view.getByRole("radio", { name: /At a set time/ }))
    fireEvent.change(view.getByLabelText("Entries end at"), {
      target: { value: "2099-01-01T10:00" },
    })
    next(view)
    await view.findByText("Step 4 of 4: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    const sent = requests.find((request) => request.route === "POST /api/dash/giveaways")
    expect(sent?.body).toMatchObject({ closesAt: new Date("2099-01-01T10:00").toISOString() })
  })

  it("shows the success screen with the link, a chat message to copy and the OBS steps", async () => {
    const copied = stubClipboard(false)
    mockFetch(withCreate(createdReply))
    const view = await openWizard()
    await toReview(view)

    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

    expect(await view.findByRole("heading", { name: "Your giveaway is live!" })).toBeTruthy()
    expect(view.getByLabelText("Your link").getAttribute("value")).toBe(
      "http://rafflink.test/ABCDE",
    )
    expect(view.getByLabelText("Message for your chat").getAttribute("value")).toBe(
      "Enter the giveaway: http://rafflink.test/ABCDE",
    )
    expect(view.getByLabelText("Overlay link").getAttribute("value")).toBe(
      "http://rafflink.test/overlay/gid-1/tok-1",
    )
    expect(view.getByRole("heading", { name: "Add to OBS (optional)" })).toBeTruthy()
    expect(view.getByText("Choose Browser and press OK.")).toBeTruthy()
    expect(view.getByRole("link", { name: "Open live page" }).getAttribute("href")).toBe(
      "/live/gid-1",
    )
    expect(view.queryByRole("alert")).toBeNull()

    fireEvent.click(view.getByRole("button", { name: "Copy chat message" }))
    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["Enter the giveaway: http://rafflink.test/ABCDE"])

    fireEvent.click(view.getByRole("button", { name: "Back to my giveaways" }))
    expect(await view.findByRole("heading", { name: "My giveaways" })).toBeTruthy()
  })

  it("warns when the day's requests are nearly used up and when the room is not ready", async () => {
    mockFetch(
      withCreate({
        status: 201,
        body: {
          giveaway: dashboardGiveaway,
          roomReady: false,
          warnings: [{ kind: "worker-requests-low", remaining: 1200 }],
        },
      }),
    )
    const view = await openWizard()
    await toReview(view)

    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

    expect(await view.findByText(/only 1,200 requests left for today/)).toBeTruthy()
    expect(view.getByText(/not fully ready yet/)).toBeTruthy()
  })

  it.each([
    ["tickets.vip", "not-a-non-negative-integer", "Step 2 of 4: Who can enter", "VIPs"],
    ["claimKeyword", "too-long", "Step 3 of 4: When it ends", "Chat word (optional)"],
    ["title", "blank", "Step 1 of 4: What you give away", "Giveaway name (optional)"],
  ])(
    "sends the streamer back to the step of the field the server refused (%s)",
    async (field, code, step, label) => {
      mockFetch(withCreate({ status: 400, body: { error: "invalid-input", field, code } }))
      const view = await openWizard()
      await toReview(view)

      fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

      expect(await view.findByText(step)).toBeTruthy()
      expect(view.getByLabelText(label).getAttribute("aria-invalid")).toBe("true")
    },
  )

  it("shows the server's message on the review step for a field no step owns", async () => {
    mockFetch(
      withCreate({
        status: 400,
        body: { error: "invalid-input", field: "rules", code: "not-an-object" },
      }),
    )
    const view = await openWizard()
    await toReview(view)

    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

    expect(await view.findByText("Invalid request.")).toBeTruthy()
    expect(view.getByText("Step 4 of 4: Review")).toBeTruthy()
  })

  it("asks for a new sign-in when the session ended during create", async () => {
    mockFetch(withCreate({ status: 401, body: { error: "unauthorized" } }))
    const view = await openWizard()
    await toReview(view)

    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })
})

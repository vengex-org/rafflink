import { afterEach, describe, expect, it, mock } from "bun:test"
import { cleanup, fireEvent, waitFor, within, type RenderResult } from "@testing-library/react"
import { stubClipboard } from "./clipboard.ts"
import { dashboardGiveaway, supportedSession } from "./fixtures.ts"
import { mockFetch, ok, type Reply } from "./mock-fetch.ts"
import { inputOf } from "./queries.ts"
import { initialValues } from "../src/pages/create-values.ts"
import { markCreated, readDraft } from "../src/lib/wizard-draft.ts"
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

async function openWizard() {
  const view = renderApp("/dashboard/new")
  await view.findByText("Step 1 of 3: Basics")
  return view
}

function next(view: RenderResult) {
  fireEvent.click(view.getByRole("button", { name: "Next" }))
}

function fillGiveaway(view: RenderResult) {
  fireEvent.change(view.getByLabelText("Giveaway name optional"), { target: { value: "Cup" } })
  fireEvent.change(view.getByLabelText("What does the winner get? optional"), {
    target: { value: "A chair" },
  })
}

async function toReview(view: RenderResult) {
  fillGiveaway(view)
  next(view)
  await view.findByText("Step 2 of 3: Entry rules")
  next(view)
  await view.findByText("Step 3 of 3: Review")
}

// The session of a signed-in streamer whose token holds the scopes of these features.
function session(grantedFeatures: readonly string[]) {
  return () =>
    ok({ ...supportedSession, streamer: { ...supportedSession.streamer, grantedFeatures } })
}

const allFeatures = supportedSession.streamer.grantedFeatures

const rewards = {
  kind: "rewards",
  rewards: [
    { id: "reward-1", title: "Enter the giveaway" },
    { id: "reward-2", title: "Hydrate" },
  ],
}

async function toRules(view: RenderResult) {
  next(view)
  await view.findByText("Step 2 of 3: Entry rules")
}

// Bonus tickets start switched off; the ticket rows show once it is on.
function openBonusTickets(view: RenderResult) {
  fireEvent.click(view.getByRole("checkbox", { name: "Bonus tickets" }))
}

describe("create wizard", () => {
  it("starts at step 1 and cancels back to the list", async () => {
    mockFetch(listed)
    const view = await openWizard()

    expect(view.getByRole("heading", { name: "Start with the basics" })).toBeTruthy()
    fireEvent.click(view.getByRole("link", { name: "Cancel" }))

    expect(await view.findByRole("heading", { name: "My giveaways" })).toBeTruthy()
    expect(view.address()).toBe("/dashboard")
  })

  it("lists the three steps in the indicator", async () => {
    mockFetch(listed)
    const view = await openWizard()

    const steps = view.getByRole("list", { name: "Steps" })
    expect(Array.from(steps.querySelectorAll("li"), (item) => item.textContent)).toEqual([
      "1Basics",
      "2Entry rules",
      "3Review",
    ])
  })

  it("lets the streamer go on without a name and a prize", async () => {
    mockFetch(listed)
    const view = await openWizard()

    next(view)

    expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
    expect(view.queryByRole("alert")).toBeNull()
  })

  it("offers Everyone, Followers only and Subscribers only with Everyone chosen", async () => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")

    const everyone = inputOf(view.getByRole("radio", { name: /Everyone/ }))
    expect(everyone.checked).toBe(true)
    expect(view.getByRole("radio", { name: /Followers only/ })).toBeTruthy()
    expect(view.getByRole("radio", { name: /Subscribers only/ })).toBeTruthy()
    expect(inputOf(view.getByRole("checkbox", { name: "Bonus tickets" })).checked).toBe(false)
  })

  it("warns that a subscription is a purchase only while Subscribers only is chosen", async () => {
    mockFetch(listed)
    const view = await openWizard()
    await toRules(view)
    const warning = /Sub-only entry may count as a paid lottery/

    expect(view.queryByText(warning)).toBeNull()
    fireEvent.click(view.getByRole("radio", { name: /Subscribers only/ }))
    expect(view.getByRole("note").textContent).toMatch(warning)
    fireEvent.click(view.getByRole("radio", { name: /Followers only/ }))
    expect(view.queryByText(warning)).toBeNull()
  })

  it("tells how much better the odds are for the best group and follows the ticket counts", async () => {
    mockFetch(listed)
    const view = await openWizard()
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    openBonusTickets(view)
    expect(view.queryByText("Everyone has the same chance of winning.")).toBeNull()

    fireEvent.change(view.getByLabelText("Subscribers, tier 3"), { target: { value: "5" } })
    expect(view.getByText("A Tier 3 sub has 5x the chance of a viewer.")).toBeTruthy()

    fireEvent.change(view.getByLabelText("Viewers"), { target: { value: "2" } })
    expect(view.getByText("A Tier 3 sub has 2.5x the chance of a viewer.")).toBeTruthy()

    fireEvent.change(view.getByLabelText("Viewers"), { target: { value: "0" } })
    expect(view.getByText("Viewers get no tickets and cannot win.")).toBeTruthy()

    fireEvent.change(view.getByLabelText("Viewers"), { target: { value: "9" } })
    expect(view.getByText("No group has better odds than a viewer.")).toBeTruthy()

    fireEvent.change(view.getByLabelText("Viewers"), { target: { value: "" } })
    expect(view.queryByText(/chance|cannot win|better odds/)).toBeNull()
  })

  it("steps a ticket count with the minus and plus buttons and stops at 0", async () => {
    mockFetch(listed)
    const view = await openWizard()
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    openBonusTickets(view)
    const followers = inputOf(view.getByLabelText("Followers"))
    const fewer = view.getByRole("button", { name: "Fewer tickets for Followers" })
    const more = view.getByRole("button", { name: "More tickets for Followers" })

    fireEvent.click(more)
    fireEvent.click(more)
    expect(followers.value).toBe("3")
    expect(view.getByText("A follower has 3x the chance of a viewer.")).toBeTruthy()

    fireEvent.click(fewer)
    fireEvent.click(fewer)
    fireEvent.click(fewer)
    expect(followers.value).toBe("0")
    expect(fewer.hasAttribute("disabled")).toBe(true)
    expect(more.hasAttribute("disabled")).toBe(false)

    fireEvent.click(fewer)
    expect(followers.value).toBe("0")
  })

  it("moves focus to the ticket count when the minus button reaches 0 and disables itself", async () => {
    mockFetch(listed)
    const view = await openWizard()
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    openBonusTickets(view)
    const followers = inputOf(view.getByLabelText("Followers"))
    const fewer = view.getByRole("button", { name: "Fewer tickets for Followers" })

    fewer.focus()
    fireEvent.click(fewer)
    expect(followers.value).toBe("0")
    expect(fewer.hasAttribute("disabled")).toBe(true)
    expect(document.activeElement === followers).toBe(true)
  })

  it("steps a ticket count with the arrow keys and never below 0", async () => {
    mockFetch(listed)
    const view = await openWizard()
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    openBonusTickets(view)
    const vips = inputOf(view.getByLabelText("VIPs"))

    fireEvent.keyDown(vips, { key: "ArrowUp" })
    expect(vips.value).toBe("2")

    fireEvent.keyDown(vips, { key: "ArrowDown" })
    fireEvent.keyDown(vips, { key: "ArrowDown" })
    fireEvent.keyDown(vips, { key: "ArrowDown" })
    expect(vips.value).toBe("0")
    expect(
      view.getByRole("button", { name: "Fewer tickets for VIPs" }).hasAttribute("disabled"),
    ).toBe(true)
  })

  it.each([
    ["empty", "", "More tickets for Moderators", "1"],
    ["a fraction", "2.5", "More tickets for Moderators", "3"],
    ["a negative number", "-3", "More tickets for Moderators", "0"],
    ["a fraction", "2.5", "Fewer tickets for Moderators", "1"],
  ])(
    "steps a ticket count typed as %s (%s) to a whole number",
    async (_kind, typed, button, stepped) => {
      mockFetch(listed)
      const view = await openWizard()
      next(view)
      await view.findByText("Step 2 of 3: Entry rules")
      openBonusTickets(view)
      const moderators = inputOf(view.getByLabelText("Moderators"))

      fireEvent.change(moderators, { target: { value: typed } })
      fireEvent.click(view.getByRole("button", { name: button }))

      expect(moderators.value).toBe(stepped)
    },
  )

  it.each([
    ["Extra tickets: a negative number", "VIPs", "-1", "Enter a whole number, 0 or more."],
    ["Extra tickets: a fraction", "VIPs", "1.5", "Enter a whole number, 0 or more."],
    ["Extra tickets: empty", "Moderators", "", "Enter a whole number, 0 or more."],
    [
      "Account age: a fraction",
      "Minimum account age in days optional",
      "2.5",
      "Enter a whole number of days, or leave it empty.",
    ],
  ])("stays on step 2 for %s", async (_name, label, value, message) => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    openBonusTickets(view)

    fireEvent.change(view.getByLabelText(label), { target: { value } })
    next(view)

    expect(view.getByText(message)).toBeTruthy()
    expect(view.getByLabelText(label).getAttribute("aria-invalid")).toBe("true")
    expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
  })

  it("asks for an end time when entries end at a set time, and not for one in the past", async () => {
    mockFetch(listed)
    const view = await openWizard()
    expect(view.queryByLabelText("Entries end at")).toBeNull()

    fireEvent.click(view.getByRole("radio", { name: /At a set time/ }))
    next(view)
    expect(view.getByText("Pick the date and time when entries end.")).toBeTruthy()
    expect(view.getByText("Step 1 of 3: Basics")).toBeTruthy()

    fireEvent.change(view.getByLabelText("Entries end at"), {
      target: { value: "2000-01-01T10:00" },
    })
    next(view)
    expect(view.getByText("Pick a time in the future.")).toBeTruthy()

    fireEvent.change(view.getByLabelText("Entries end at"), {
      target: { value: "2099-01-01T10:00" },
    })
    next(view)
    expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
  })

  it("goes back a step and keeps the answers", async () => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")

    fireEvent.click(view.getByRole("button", { name: "Back" }))

    expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
    expect(inputOf(view.getByLabelText("Giveaway name optional")).value).toBe("Cup")
    expect(view.queryByRole("button", { name: "Back" })).toBeNull()
  })

  it("moves the keyboard focus to the new step heading", async () => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)

    next(view)

    expect(
      (await view.findByRole("heading", { name: "Set the entry rules" }))
        === document.activeElement,
    ).toBe(true)
  })

  it("keeps the focus in a field while the streamer types into it", async () => {
    mockFetch(listed)
    const view = await openWizard()
    const title = inputOf(view.getByLabelText("Giveaway name optional"))
    title.focus()

    for (const typed of ["C", "Cu", "Cup", "Cup "]) {
      fireEvent.change(title, { target: { value: typed } })

      expect(inputOf(view.getByLabelText("Giveaway name optional")) === title).toBe(true)
      expect(title.value).toBe(typed)
      expect(document.activeElement === title).toBe(true)
    }
  })

  it("reviews the answers in plain sentences", async () => {
    mockFetch(listed)
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    openBonusTickets(view)
    fireEvent.click(view.getByRole("radio", { name: /Subscribers only/ }))
    fireEvent.change(view.getByLabelText("Subscribers, tier 1"), { target: { value: "3" } })
    fireEvent.change(view.getByLabelText("Minimum account age in days optional"), {
      target: { value: "7" },
    })
    fireEvent.click(view.getByRole("radio", { name: /10 minutes/ }))
    fireEvent.change(view.getByLabelText("Claim word optional"), { target: { value: "mine" } })
    next(view)
    await view.findByText("Step 3 of 3: Review")

    expect(view.getByText("Cup")).toBeTruthy()
    expect(view.getByText("A chair")).toBeTruthy()
    expect(view.getByText("Only subscribers can enter.")).toBeTruthy()
    expect(view.getByText("Subscribers, tier 1: 3 tickets")).toBeTruthy()
    expect(view.getByText("Accounts must be at least 7 days old.")).toBeTruthy()
    expect(view.getByText("When you close them.")).toBeTruthy()
    expect(view.getByText('10 minutes. The winner can also type "mine" in your chat.')).toBeTruthy()
    expect(view.getByRole("button", { name: "Start giveaway" })).toBeTruthy()
  })

  it("puts every group back to the default tickets when Bonus tickets is switched off", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    await toRules(view)
    openBonusTickets(view)
    fireEvent.change(view.getByLabelText("VIPs"), { target: { value: "5" } })

    openBonusTickets(view)
    expect(view.queryByLabelText("VIPs")).toBeNull()
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    expect(
      requests.find((request) => request.route === "POST /api/dash/giveaways")?.body,
    ).toMatchObject({
      rules: {
        tickets: { viewer: 1, follower: 1, sub_t1: 1, sub_t2: 1, sub_t3: 1, vip: 1, moderator: 1 },
      },
    })
  })

  it("keeps Bonus tickets on across the steps while a group the entry ways hid still holds a bonus", async () => {
    const capabilities = {
      ...supportedSession.streamer.capabilities,
      moderatorRole: false,
      chatBadgeGroups: ["moderator"],
    }
    const requests = mockFetch({
      ...withCreate(createdReply),
      "GET /api/session": () =>
        ok({ ...supportedSession, streamer: { ...supportedSession.streamer, capabilities } }),
    })
    const view = await openWizard()
    await toRules(view)
    fireEvent.click(view.getByRole("radio", { name: /Chat only/ }))
    openBonusTickets(view)
    fireEvent.change(view.getByLabelText("Moderators"), { target: { value: "5" } })

    fireEvent.click(view.getByRole("radio", { name: /Giveaway page/ }))
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Back" }))
    await view.findByText("Step 2 of 3: Entry rules")
    fireEvent.click(view.getByRole("radio", { name: /Chat only/ }))
    const shown = inputOf(view.getByRole("checkbox", { name: "Bonus tickets" })).checked
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    const body = requests.find((request) => request.route === "POST /api/dash/giveaways")?.body
    expect({ shown, body }).toMatchObject({
      shown: true,
      body: { rules: { tickets: { moderator: 5 } } },
    })
  })

  it("sends the answers as the API expects", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    fillGiveaway(view)
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    openBonusTickets(view)
    fireEvent.click(view.getByRole("radio", { name: /Subscribers only/ }))
    fireEvent.change(view.getByLabelText("VIPs"), { target: { value: "5" } })
    fireEvent.change(view.getByLabelText("Minimum account age in days optional"), {
      target: { value: "7" },
    })
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    expect(requests.find((request) => request.route === "POST /api/dash/giveaways")?.body).toEqual({
      title: "Cup",
      prize: "A chair",
      rules: {
        tickets: {
          viewer: 1,
          follower: 1,
          sub_t1: 1,
          sub_t2: 1,
          sub_t3: 1,
          member: 0,
          vip: 5,
          moderator: 1,
        },
        subsOnly: true,
        followersOnly: false,
        minAccountAgeDays: 7,
        claimKeyword: "",
        excludeRecentWinners: null,
        chatKeyword: null,
        pageEntry: true,
        subEntry: false,
        pointsReward: null,
        minAge: null,
        excludedCountries: null,
        extraTerms: null,
        winnerForm: [],
      },
      claimSeconds: 300,
      winnerCount: 1,
    })
  })

  it("sends the official rules fields of the basics step and shows them on the review", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    fillGiveaway(view)
    fireEvent.change(view.getByLabelText("Minimum age to win, in years"), {
      target: { value: "18" },
    })
    fireEvent.change(view.getByLabelText("Places where people cannot win"), {
      target: { value: " Quebec " },
    })
    fireEvent.change(view.getByLabelText("Extra terms"), {
      target: { value: "Shipping in the EU only.\nOne prize per household." },
    })
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    next(view)
    await view.findByText("Step 3 of 3: Review")

    expect(view.getByText("18 years")).toBeTruthy()
    expect(view.getByText("Quebec")).toBeTruthy()
    expect(view.getByText(/Shipping in the EU only\./)).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    expect(
      requests.find((request) => request.route === "POST /api/dash/giveaways")?.body,
    ).toMatchObject({
      rules: {
        minAge: 18,
        excludedCountries: "Quebec",
        extraTerms: "Shipping in the EU only.\nOne prize per household.",
      },
    })
  })

  it.each(["0", "100", "17.5"])(
    "refuses %p as the minimum age to win on the basics step",
    async (age) => {
      mockFetch(listed)
      const view = await openWizard()
      fireEvent.change(view.getByLabelText("Minimum age to win, in years"), {
        target: { value: age },
      })
      next(view)

      expect(
        view.getByText("Enter a whole number of years from 1 to 99, or leave it empty."),
      ).toBeTruthy()
      expect(view.getByText("Step 1 of 3: Basics")).toBeTruthy()
    },
  )

  it("sends every answer in the request body", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    fillGiveaway(view)
    fireEvent.click(view.getByRole("radio", { name: /At a set time/ }))
    fireEvent.change(view.getByLabelText("Entries end at"), {
      target: { value: "2099-01-01T10:00" },
    })
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    openBonusTickets(view)
    fireEvent.click(view.getByRole("radio", { name: /Followers only/ }))
    fireEvent.change(view.getByLabelText("Minimum account age in days optional"), {
      target: { value: "30" },
    })
    const tickets = {
      Viewers: "1",
      Followers: "2",
      "Subscribers, tier 1": "3",
      "Subscribers, tier 2": "4",
      "Subscribers, tier 3": "5",
      VIPs: "6",
      Moderators: "0",
    }
    for (const [label, value] of Object.entries(tickets)) {
      fireEvent.change(view.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(view.getByRole("radio", { name: /10 minutes/ }))
    fireEvent.change(view.getByLabelText("Claim word optional"), { target: { value: "mine" } })
    expect(view.queryByLabelText("Entry keyword")).toBeNull()
    expect(view.queryByText(/Chat entries show up a few seconds late/)).toBeNull()
    fireEvent.click(view.getByRole("radio", { name: /Page and chat/ }))
    expect(inputOf(view.getByLabelText("Entry keyword")).value).toBe("!enter")
    expect(view.getByText(/Chat entries show up a few seconds late/)).toBeTruthy()
    fireEvent.change(view.getByLabelText("Entry keyword"), { target: { value: "!join" } })
    next(view)
    await view.findByText("Step 3 of 3: Review")
    expect(view.getByText('On the giveaway page or by typing "!join" in your chat.')).toBeDefined()
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    expect(requests.find((request) => request.route === "POST /api/dash/giveaways")?.body).toEqual({
      title: "Cup",
      prize: "A chair",
      rules: {
        tickets: {
          viewer: 1,
          follower: 2,
          sub_t1: 3,
          sub_t2: 4,
          sub_t3: 5,
          member: 0,
          vip: 6,
          moderator: 0,
        },
        subsOnly: false,
        followersOnly: true,
        minAccountAgeDays: 30,
        claimKeyword: "mine",
        excludeRecentWinners: null,
        chatKeyword: "!join",
        pageEntry: true,
        subEntry: false,
        pointsReward: null,
        minAge: null,
        excludedCountries: null,
        extraTerms: null,
        winnerForm: [],
      },
      closesAt: new Date("2099-01-01T10:00").toISOString(),
      claimSeconds: 600,
      winnerCount: 1,
    })
  })

  it.each([
    [
      "Last giveaways",
      "How many giveaways back",
      "giveaways",
      "Winners of your last 3 giveaways cannot enter.",
    ],
    [
      "Last days",
      "How many days back",
      "days",
      "Winners of your giveaways from the last 3 days cannot enter.",
    ],
  ] as const)(
    "keeps recent winners out by %s: reviews the rule and sends it",
    async (option, countLabel, kind, sentence) => {
      const requests = mockFetch(withCreate(createdReply))
      const view = await openWizard()
      await toRules(view)
      expect(view.queryByLabelText(countLabel)).toBeNull()

      fireEvent.click(view.getByRole("radio", { name: new RegExp(option) }))
      expect(inputOf(view.getByLabelText(countLabel)).value).toBe("3")
      next(view)
      await view.findByText("Step 3 of 3: Review")
      expect(view.getByText("Recent winners")).toBeTruthy()
      expect(view.getByText(sentence)).toBeTruthy()
      fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
      await view.findByRole("heading", { name: "Your giveaway is live!" })

      const body = requests.find((request) => request.route === "POST /api/dash/giveaways")?.body
      expect(body).toMatchObject({ rules: { excludeRecentWinners: { kind, count: 3 } } })
    },
  )

  it("sends no recent-winners rule after the streamer switches it off again", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    await toRules(view)
    fireEvent.click(view.getByRole("radio", { name: /Last days/ }))
    fireEvent.click(view.getByRole("radio", { name: /Off/ }))
    expect(view.queryByLabelText("How many days back")).toBeNull()
    next(view)
    await view.findByText("Step 3 of 3: Review")
    expect(view.queryByText("Recent winners")).toBeNull()
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    const body = requests.find((request) => request.route === "POST /api/dash/giveaways")?.body
    expect(body).toMatchObject({ rules: { excludeRecentWinners: null } })
  })

  it.each(["", "0", "2.5", "-1"])(
    "stops on the rules step when the recent-winners count is %j",
    async (typed) => {
      mockFetch(withCreate(createdReply))
      const view = await openWizard()
      await toRules(view)
      fireEvent.click(view.getByRole("radio", { name: /Last giveaways/ }))
      fireEvent.change(view.getByLabelText("How many giveaways back"), { target: { value: typed } })

      next(view)

      expect(await view.findByText("Enter a whole number, 1 or more.")).toBeTruthy()
      expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
      expect(view.getByLabelText("How many giveaways back").getAttribute("aria-invalid")).toBe(
        "true",
      )
    },
  )

  it("sends the streamer back to the recent-winners count the server refused", async () => {
    mockFetch(
      withCreate({
        status: 400,
        body: {
          error: "invalid-input",
          field: "excludeRecentWinners.count",
          code: "too-large",
        },
      }),
    )
    const view = await openWizard()
    await toRules(view)
    fireEvent.click(view.getByRole("radio", { name: /Last giveaways/ }))
    fireEvent.change(view.getByLabelText("How many giveaways back"), { target: { value: "99" } })
    next(view)
    await view.findByText("Step 3 of 3: Review")

    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

    expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
    expect(await view.findByText("This number is too large. Enter a smaller one.")).toBeTruthy()
    expect(view.getByLabelText("How many giveaways back").getAttribute("aria-invalid")).toBe("true")
  })

  it("sends the winner form fields in the form's order and reviews them", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    await toRules(view)
    fireEvent.click(view.getByRole("checkbox", { name: "Shipping address" }))
    fireEvent.click(view.getByRole("checkbox", { name: "Name" }))
    next(view)
    await view.findByText("Step 3 of 3: Review")
    expect(view.getByText("Name, Shipping address")).toBeDefined()
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    expect(
      requests.find((request) => request.route === "POST /api/dash/giveaways")?.body,
    ).toMatchObject({ rules: { winnerForm: ["name", "address"] } })
  })

  it("sends a chat-only giveaway with page entry off", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    await toRules(view)
    fireEvent.click(view.getByRole("radio", { name: /Chat only/ }))
    next(view)
    await view.findByText("Step 3 of 3: Review")
    expect(view.getByText('Only by typing "!enter" in your chat.')).toBeDefined()
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    expect(
      requests.find((request) => request.route === "POST /api/dash/giveaways")?.body,
    ).toMatchObject({ rules: { chatKeyword: "!enter", pageEntry: false } })
  })

  it("asks to reconnect for the VIP permission once VIP tickets differ, and never for chat entry alone", async () => {
    mockFetch({ ...listed, "GET /api/session": session([]) })
    const view = await openWizard()
    await toRules(view)
    fireEvent.click(view.getByRole("radio", { name: /Page and chat/ }))
    expect(view.queryByRole("link", { name: "Reconnect Twitch" })).toBeNull()

    openBonusTickets(view)
    fireEvent.click(view.getByRole("button", { name: "More tickets for VIPs" }))

    const reconnect = await view.findByRole("link", { name: "Reconnect Twitch" })
    expect(reconnect.getAttribute("href")).toBe(
      "/auth/twitch/streamer/start?features=roles&return=%2Fdashboard%2Fnew%3Fstep%3D2",
    )
    fireEvent.click(view.getByRole("button", { name: "About Reconnect Twitch" }))
    expect(view.getByText(/read your VIPs and moderators/)).toBeTruthy()
    next(view)
    expect(await view.findByText(/Reconnect Twitch first/)).toBeTruthy()
  })

  it("keeps the answers across Reconnect Twitch and comes back to the rules step", async () => {
    mockFetch({ ...listed, "GET /api/session": session([]) })
    const view = await openWizard()
    fillGiveaway(view)
    await toRules(view)
    fireEvent.click(view.getByRole("radio", { name: /Page and chat/ }))
    fireEvent.change(view.getByLabelText("Entry keyword"), { target: { value: "!join" } })
    fireEvent.click(view.getByRole("radio", { name: /Followers only/ }))
    fireEvent.click(await view.findByRole("link", { name: "Reconnect Twitch" }))
    cleanup()

    mockFetch({ ...listed, "GET /api/session": session(["followers"]) })
    const back = renderApp("/dashboard/new?step=2")

    expect(await back.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
    expect(inputOf(back.getByLabelText("Entry keyword")).value).toBe("!join")
    next(back)
    await back.findByText("Step 3 of 3: Review")
    expect(back.getByText("Cup")).toBeTruthy()
  })

  it("asks to reconnect for sub entry and does not go on until the token holds the sub scope", async () => {
    mockFetch({
      ...listed,
      "GET /api/session": session(["followers", "redemptions"]),
      "GET /api/dash/rewards": () => ok(rewards),
    })
    const view = await openWizard()
    await toRules(view)
    fireEvent.click(await view.findByRole("button", { name: "About Enter new subscribers" }))
    expect(view.getByText(/A silent auto renewal does not enter/)).toBeTruthy()

    fireEvent.click(await view.findByRole("checkbox", { name: "Enter new subscribers" }))
    const reconnect = await view.findByRole("link", { name: "Reconnect Twitch" })
    expect(reconnect.getAttribute("href")).toBe(
      "/auth/twitch/streamer/start?features=subs&return=%2Fdashboard%2Fnew%3Fstep%3D2",
    )
    next(view)

    expect(await view.findByText(/Reconnect Twitch first/)).toBeTruthy()
    expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
  })

  it("enters new subscribers on top of page entry once the token holds the sub scope", async () => {
    const requests = mockFetch({
      ...withCreate(createdReply),
      "GET /api/session": session(allFeatures),
      "GET /api/dash/rewards": () => ok(rewards),
    })
    const view = await openWizard()
    await toRules(view)
    fireEvent.click(await view.findByRole("checkbox", { name: "Enter new subscribers" }))
    next(view)
    await view.findByText("Step 3 of 3: Review")
    expect(view.getByText("New subscribers enter by themselves.")).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    expect(
      requests.find((request) => request.route === "POST /api/dash/giveaways")?.body,
    ).toMatchObject({ rules: { subEntry: true, pageEntry: true, chatKeyword: null } })
  })

  it("sends a Kick streamer to reconnect Kick for the reward list", async () => {
    mockFetch({
      ...listed,
      "GET /api/session": () =>
        ok({
          ...supportedSession,
          streamer: { ...supportedSession.streamer, platform: "kick" },
        }),
      "GET /api/dash/rewards": () => ok({ kind: "reconnect" }),
    })
    const view = await openWizard()
    await toRules(view)

    const reconnect = await view.findByRole("link", { name: "Reconnect Kick" })
    expect(reconnect.getAttribute("href")).toBe(
      "/auth/kick/streamer/start?features=redemptions&return=%2Fdashboard%2Fnew%3Fstep%3D2",
    )
    fireEvent.click(view.getByRole("button", { name: "About Reconnect Kick" }))
    expect(view.getByText(/To list your channel point rewards/)).toBeTruthy()
  })

  it("tells a Kick streamer without rewards to create one, and describes Kick renewals", async () => {
    mockFetch({
      ...listed,
      "GET /api/session": () =>
        ok({
          ...supportedSession,
          streamer: { ...supportedSession.streamer, platform: "kick" },
        }),
      "GET /api/dash/rewards": () => ok({ kind: "rewards", rewards: [] }),
    })
    const view = await openWizard()
    await toRules(view)

    expect(await view.findByText(/has no channel point rewards yet/)).toBeTruthy()
    fireEvent.click(view.getByRole("button", { name: "About Enter new subscribers" }))
    expect(view.getByText(/Kick has one subscription level/)).toBeTruthy()
    expect(view.queryByRole("group", { name: "Channel point reward" })).toBeNull()
  })

  it("goes back to the rules step when the server answers that the token needs a reconnect", async () => {
    mockFetch({
      ...withCreate({ status: 422, body: { error: "reconnect" } }),
      "GET /api/session": session(allFeatures),
      "GET /api/dash/rewards": () => ok(rewards),
    })
    const view = await openWizard()
    await toRules(view)
    fireEvent.click(await view.findByRole("checkbox", { name: "Enter new subscribers" }))
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

    expect(await view.findByText(/Reconnect Twitch first/)).toBeTruthy()
    expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
  })

  it("hides sub entry for a channel without channel points, which has no subs either", async () => {
    const requests = mockFetch(listed)
    const view = await openWizard()
    await toRules(view)
    await waitFor(() =>
      expect(requests.some((request) => request.route === "GET /api/dash/rewards")).toBe(true),
    )
    // The answer renders a tick after the request.
    await Bun.sleep(10)

    expect(view.queryByRole("checkbox", { name: "Enter new subscribers" })).toBeNull()
  })

  it("never lets sub or points entry stand alone: every entry way the wizard offers keeps page or chat entry", async () => {
    const requests = mockFetch({
      ...withCreate(createdReply),
      "GET /api/session": session(allFeatures),
      "GET /api/dash/rewards": () => ok(rewards),
    })
    const view = await openWizard()
    await toRules(view)
    fireEvent.click(view.getByRole("checkbox", { name: "Enter new subscribers" }))
    fireEvent.click(await view.findByRole("radio", { name: "Enter the giveaway" }))

    const entryWays = within(view.getByRole("group", { name: "How viewers enter" }))
    expect(entryWays.getAllByRole("radio")).toHaveLength(3)
    for (const name of [/Giveaway page/, /Page and chat/, /Chat only/]) {
      expect(entryWays.getByRole("radio", { name })).toBeTruthy()
    }
    fireEvent.click(view.getByRole("radio", { name: /Chat only/ }))
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })
    expect(
      requests.find((request) => request.route === "POST /api/dash/giveaways")?.body,
    ).toMatchObject({
      rules: {
        pageEntry: false,
        chatKeyword: "!enter",
        subEntry: true,
        pointsReward: { id: "reward-1", title: "Enter the giveaway" },
      },
    })
  })

  it("picks a channel point reward from the streamer's rewards, with help that promises no odds", async () => {
    mockFetch({
      ...listed,
      "GET /api/session": session(allFeatures),
      "GET /api/dash/rewards": () => ok(rewards),
    })
    const view = await openWizard()
    await toRules(view)

    const group = await view.findByRole("group", { name: "Channel point reward" })
    expect(inputOf(view.getByRole("radio", { name: "No reward" })).checked).toBe(true)
    expect(group.textContent).toContain(
      "Redeeming gives no extra tickets and no better chance to win.",
    )
    expect(group.textContent).not.toMatch(/more likely|higher chance|better odds|increase/i)
    fireEvent.click(view.getByRole("radio", { name: "Hydrate" }))
    next(view)
    await view.findByText("Step 3 of 3: Review")
    expect(view.getByText('Redeeming "Hydrate" enters a viewer.')).toBeTruthy()
  })

  it("asks to reconnect for points entry when the token cannot read rewards, and hides it without channel points", async () => {
    mockFetch({ ...listed, "GET /api/dash/rewards": () => ok({ kind: "reconnect" }) })
    const view = await openWizard()
    await toRules(view)

    const reconnect = await view.findByRole("link", { name: "Reconnect Twitch" })
    expect(reconnect.getAttribute("href")).toBe(
      "/auth/twitch/streamer/start?features=redemptions&return=%2Fdashboard%2Fnew%3Fstep%3D2",
    )
    cleanup()
    mockFetch(listed)
    const plain = await openWizard()
    await toRules(plain)
    expect(plain.queryByRole("group", { name: "Channel point reward" })).toBeNull()
    expect(plain.queryByRole("link", { name: "Reconnect Twitch" })).toBeNull()
  })

  it("offers only the rules a platform without follower lookup, VIP, account age and chat entry can check", async () => {
    const capabilities = {
      ...supportedSession.streamer.capabilities,
      followerCheck: false,
      vip: false,
      accountAge: false,
      chatEntry: false,
    }
    const requests = mockFetch({
      ...withCreate(createdReply),
      "GET /api/session": () =>
        ok({ ...supportedSession, streamer: { ...supportedSession.streamer, capabilities } }),
    })
    const view = await openWizard()
    fillGiveaway(view)
    await toRules(view)
    openBonusTickets(view)

    expect(view.queryByRole("radio", { name: /Followers only/ })).toBeNull()
    expect(view.getByRole("radio", { name: /Subscribers only/ })).toBeTruthy()
    expect(view.queryByLabelText("Minimum account age in days optional")).toBeNull()
    expect(view.queryByLabelText("Followers")).toBeNull()
    expect(view.queryByLabelText("VIPs")).toBeNull()
    expect(view.getByLabelText("Subscribers, tier 1")).toBeTruthy()
    expect(view.queryByRole("radio", { name: /Page and chat/ })).toBeNull()
    fireEvent.change(view.getByLabelText("Moderators"), { target: { value: "2" } })
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    const body = requests.find((request) => request.route === "POST /api/dash/giveaways")?.body
    expect(body).toMatchObject({
      rules: {
        tickets: {
          viewer: 1,
          follower: 0,
          sub_t1: 1,
          sub_t2: 1,
          sub_t3: 1,
          member: 0,
          vip: 0,
          moderator: 2,
        },
        followersOnly: false,
        chatKeyword: null,
        pageEntry: true,
        subEntry: false,
        pointsReward: null,
      },
    })
    expect(body).not.toHaveProperty("rules.minAccountAgeDays")
  })

  it("offers no subscriber filter, tier tickets or purchase warning without sub tiers", async () => {
    const capabilities = { ...supportedSession.streamer.capabilities, subTiers: false }
    const requests = mockFetch({
      ...withCreate(createdReply),
      "GET /api/session": () =>
        ok({ ...supportedSession, streamer: { ...supportedSession.streamer, capabilities } }),
    })
    const view = await openWizard()
    await toRules(view)

    expect(view.queryByRole("radio", { name: /Subscribers only/ })).toBeNull()
    expect(view.getByRole("radio", { name: /Followers only/ })).toBeTruthy()
    expect(view.queryByLabelText("Subscribers, tier 1")).toBeNull()
    expect(view.queryByText(/Sub-only entry may count as a paid lottery/)).toBeNull()
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    const body = requests.find((request) => request.route === "POST /api/dash/giveaways")?.body
    expect(body).toMatchObject({
      rules: { tickets: { sub_t1: 0, sub_t2: 0, sub_t3: 0 }, subsOnly: false },
    })
  })

  it("shows a YouTube streamer what reading the chat costs and goes back to the rules when today's units are short", async () => {
    const capabilities = {
      ...supportedSession.streamer.capabilities,
      followerCheck: false,
      subTiers: false,
      vip: false,
      accountAge: false,
      moderatorRole: false,
      pageEntry: false,
      subEntry: false,
      pointsEntry: false,
      chatBadgeGroups: ["member", "moderator"],
    }
    mockFetch({
      ...withCreate({ status: 409, body: { error: "youtube-quota", needed: 600, remaining: 100 } }),
      "GET /api/session": () =>
        ok({
          ...supportedSession,
          streamer: { ...supportedSession.streamer, platform: "youtube", capabilities },
        }),
      "GET /api/dash/youtube-budget": () =>
        ok({ limit: 10_000, remaining: 4_000, unitsPerMinute: 60, winnerUnitsPerMinute: 10 }),
    })
    const view = await openWizard()
    fillGiveaway(view)
    await toRules(view)
    const note = await view.findByText(/4,000 left today/)
    fireEvent.click(view.getByRole("button", { name: "About the chat reading cost" }))
    openBonusTickets(view)
    const memberTickets = view.getByLabelText("Channel members")
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

    expect(await view.findByText(/Today's YouTube units are not enough/)).toBeTruthy()
    expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
    expect(note.textContent).toContain("about 60 units a minute")
    expect(note.textContent).toContain("10,000 units a day")
    expect(note.textContent).toContain("about 10 a minute")
    expect(note.textContent).toContain("about 66 minutes of entries")
    expect(memberTickets).toBeTruthy()
    expect(view.queryByLabelText("Subscribers, tier 1")).toBeNull()
    expect(view.queryByRole("radio", { name: /Giveaway page/ })).toBeNull()
    expect(view.getByRole("radio", { name: /Chat only/ })).toBeTruthy()
  })

  it("offers Kick subscriber and moderator tickets only for chat only entry, with the chat cost and today's budget", async () => {
    const capabilities = {
      ...supportedSession.streamer.capabilities,
      followerCheck: false,
      subTiers: false,
      vip: false,
      accountAge: false,
      moderatorRole: false,
      chatBadgeGroups: ["sub_t1", "moderator"],
    }
    const requests = mockFetch({
      ...withCreate(createdReply),
      "GET /api/session": () =>
        ok({
          ...supportedSession,
          streamer: { ...supportedSession.streamer, platform: "kick", capabilities },
        }),
      "GET /api/dash/request-budget": () => ok({ budget: { limit: 100_000, remaining: 42_000 } }),
    })
    const view = await openWizard()
    fillGiveaway(view)
    await toRules(view)
    openBonusTickets(view)
    const pageOnly = {
      subscribers: view.queryByLabelText("Subscribers, tier 1"),
      cost: view.queryByText(/left today/),
    }

    fireEvent.click(view.getByRole("radio", { name: /Chat only/ }))
    fireEvent.change(await view.findByLabelText("Subscribers, tier 1"), { target: { value: "3" } })
    fireEvent.change(view.getByLabelText("Moderators"), { target: { value: "5" } })
    const cost = await view.findByText(/42,000 left today/)
    fireEvent.click(view.getByRole("button", { name: "About the chat reading cost" }))
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    expect(pageOnly).toEqual({ subscribers: null, cost: null })
    expect(cost.textContent).toContain("allows 100,000 requests a day")
    expect(view.queryByLabelText("Subscribers, tier 2")).toBeNull()
    const body = requests.find((request) => request.route === "POST /api/dash/giveaways")?.body
    expect(body).toMatchObject({
      rules: {
        tickets: {
          viewer: 1,
          follower: 0,
          sub_t1: 3,
          sub_t2: 0,
          sub_t3: 0,
          member: 0,
          vip: 0,
          moderator: 5,
        },
        pageEntry: false,
      },
    })
  })

  it("hides the audience choice and its warning when the platform offers only Everyone", async () => {
    const capabilities = {
      ...supportedSession.streamer.capabilities,
      followerCheck: false,
      subTiers: false,
    }
    mockFetch({
      ...listed,
      "GET /api/session": () =>
        ok({ ...supportedSession, streamer: { ...supportedSession.streamer, capabilities } }),
    })
    const view = await openWizard()
    await toRules(view)

    expect(view.queryByRole("radio", { name: /Everyone/ })).toBeNull()
    expect(view.queryByRole("note")).toBeNull()
  })

  it("enters by chat only on a platform without page entry", async () => {
    const capabilities = { ...supportedSession.streamer.capabilities, pageEntry: false }
    const requests = mockFetch({
      ...withCreate(createdReply),
      "GET /api/session": () =>
        ok({ ...supportedSession, streamer: { ...supportedSession.streamer, capabilities } }),
    })
    const view = await openWizard()
    await toRules(view)

    expect(view.queryByRole("radio", { name: /Giveaway page/ })).toBeNull()
    expect(view.queryByRole("radio", { name: /Page and chat/ })).toBeNull()
    expect(inputOf(view.getByRole("radio", { name: /Chat only/ })).checked).toBe(true)
    expect(inputOf(view.getByLabelText("Entry keyword")).value).toBe("!enter")
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    const body = requests.find((request) => request.route === "POST /api/dash/giveaways")?.body
    expect(body).toMatchObject({ rules: { chatKeyword: "!enter", pageEntry: false } })
  })

  it("sends a blank name and prize and reviews them as not set", async () => {
    const requests = mockFetch(withCreate(createdReply))
    const view = await openWizard()
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    next(view)
    await view.findByText("Step 3 of 3: Review")

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
    fireEvent.click(view.getByRole("radio", { name: /At a set time/ }))
    fireEvent.change(view.getByLabelText("Entries end at"), {
      target: { value: "2099-01-01T10:00" },
    })
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    next(view)
    await view.findByText("Step 3 of 3: Review")
    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
    await view.findByRole("heading", { name: "Your giveaway is live!" })

    const sent = requests.find((request) => request.route === "POST /api/dash/giveaways")
    expect(sent?.body).toMatchObject({ closesAt: new Date("2099-01-01T10:00").toISOString() })
  })

  it("shows the success screen with the link and the OBS steps", async () => {
    const copied = stubClipboard(false)
    mockFetch(withCreate(createdReply))
    const view = await openWizard()
    await toReview(view)

    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

    expect(await view.findByRole("heading", { name: "Your giveaway is live!" })).toBeTruthy()
    expect(view.getByRole("textbox", { name: "Your link" }).getAttribute("value")).toBe(
      "http://rafflink.test/ABCDE",
    )
    expect(view.getByRole("textbox", { name: "Overlay link" }).getAttribute("value")).toBe(
      "http://rafflink.test/overlay/gid-1/tok-1",
    )
    expect(view.getByRole("heading", { name: "Add to OBS (optional)" })).toBeTruthy()
    expect(view.getByText("Choose Browser and press OK.")).toBeTruthy()
    expect(view.getByRole("link", { name: "Open live page" }).getAttribute("href")).toBe(
      "/live/gid-1",
    )
    expect(view.queryByRole("alert")).toBeNull()

    fireEvent.click(view.getByRole("button", { name: "Copy link" }))
    expect(await view.findByText("Copied!")).toBeTruthy()
    expect(copied).toEqual(["http://rafflink.test/ABCDE"])

    fireEvent.click(view.getByRole("link", { name: "Back to my giveaways" }))
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
    ["tickets.vip", "not-a-non-negative-integer", "Step 2 of 3: Entry rules", "VIPs"],
    [
      "minAccountAgeDays",
      "unsupported",
      "Step 2 of 3: Entry rules",
      "Minimum account age in days optional",
    ],
    ["claimKeyword", "too-long", "Step 2 of 3: Entry rules", "Claim word optional"],
    ["title", "blank", "Step 1 of 3: Basics", "Giveaway name optional"],
    ["extraTerms", "too-long", "Step 1 of 3: Basics", "Extra terms"],
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

  it("sends the streamer back to Basics when the server refuses the end time", async () => {
    mockFetch(
      withCreate({
        status: 400,
        body: { error: "invalid-input", field: "closesAt", code: "in-the-past" },
      }),
    )
    const view = await openWizard()
    fillGiveaway(view)
    fireEvent.click(view.getByRole("radio", { name: /At a set time/ }))
    fireEvent.change(view.getByLabelText("Entries end at"), {
      target: { value: "2099-01-01T10:00" },
    })
    next(view)
    await view.findByText("Step 2 of 3: Entry rules")
    next(view)
    await view.findByText("Step 3 of 3: Review")

    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

    expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
    expect(view.getByLabelText("Entries end at").getAttribute("aria-invalid")).toBe("true")
  })

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
    expect(view.getByText("Step 3 of 3: Review")).toBeTruthy()
  })

  it("asks for a new sign-in when the session ended during create", async () => {
    mockFetch(withCreate({ status: 401, body: { error: "unauthorized" } }))
    const view = await openWizard()
    await toReview(view)

    fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

    expect(await view.findByRole("link", { name: "Sign in with Twitch" })).toBeTruthy()
  })

  describe("address", () => {
    it("puts each step in the address, and the back button walks the steps and keeps the answers", async () => {
      mockFetch(listed)
      const view = await openWizard()
      expect(view.address()).toBe("/dashboard/new")
      fillGiveaway(view)

      await toRules(view)
      expect(view.address()).toBe("/dashboard/new?step=2")
      next(view)
      await view.findByText("Step 3 of 3: Review")
      expect(view.address()).toBe("/dashboard/new?step=3")

      view.back()
      expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
      view.back()
      expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
      expect(view.address()).toBe("/dashboard/new")
      expect(inputOf(view.getByLabelText("Giveaway name optional")).value).toBe("Cup")
    })

    it("pushes the earlier step when the streamer goes back with the Back button", async () => {
      mockFetch(listed)
      const view = await openWizard()
      await toRules(view)

      fireEvent.click(view.getByRole("button", { name: "Back" }))

      expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
      expect(view.address()).toBe("/dashboard/new")
      view.back()
      expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
    })

    it.each(["/dashboard/new?step=3", "/dashboard/new?step=2&from=gid-1"])(
      "opens the first step and corrects the address when a reload asks for %s, whose answers are gone",
      async (path) => {
        mockFetch(listed)
        const view = renderApp(path)

        expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
        const corrected = path.endsWith("from=gid-1")
          ? "/dashboard/new?from=gid-1"
          : "/dashboard/new"
        await waitFor(() => expect(view.address()).toBe(corrected))
      },
    )

    it.each(["0", "4", "x", ""])("opens the first step for ?step=%s", async (step) => {
      mockFetch(listed)
      const view = renderApp(`/dashboard/new?step=${step}`)

      expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
      await waitFor(() => expect(view.address()).toBe("/dashboard/new"))
    })

    it("replaces the review step with the created page, so back from it never shows the review again", async () => {
      mockFetch(withCreate(createdReply))
      const view = renderApp("/dashboard")
      fireEvent.click(await view.findByRole("link", { name: "New giveaway" }))
      await view.findByText("Step 1 of 3: Basics")
      await toReview(view)

      fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

      expect(await view.findByRole("heading", { name: "Your giveaway is live!" })).toBeTruthy()
      expect(view.address()).toBe("/dashboard/created/gid-1")
      view.back()
      expect(await view.findByRole("heading", { name: "My giveaways" })).toBeTruthy()
      expect(view.address()).toBe("/dashboard")
      expect(view.queryByText(/Step \d of 3/)).toBeNull()
    })

    it("restores the answers and the step from the history entry after a reload", async () => {
      mockFetch(listed)
      const draft = { id: "run-1", furthest: 3, values: { ...initialValues, title: "Cup" } }

      const view = renderApp("/dashboard/new?step=3", { draft })

      expect(await view.findByText("Step 3 of 3: Review")).toBeTruthy()
      expect(view.getByText("Cup")).toBeTruthy()
      expect(view.address()).toBe("/dashboard/new?step=3")
    })

    it("keeps the answers typed on a step in the history entry once typing pauses", async () => {
      mockFetch(listed)
      const view = await openWizard()

      fillGiveaway(view)

      await waitFor(() => expect(readDraft(view.state())?.values.title).toBe("Cup"))
      expect(readDraft(view.state())?.furthest).toBe(1)
      expect(view.address()).toBe("/dashboard/new")
    })

    it("leaves the answers of a step in its entry when going on, so back finds them after a reload", async () => {
      mockFetch(listed)
      const view = await openWizard()
      fillGiveaway(view)
      await toRules(view)

      view.back()

      await view.findByText("Step 1 of 3: Basics")
      expect(readDraft(view.state())?.values.title).toBe("Cup")
      expect(readDraft(view.state())?.furthest).toBe(1)
    })

    it("does not offer a form for a run whose giveaway was already created", async () => {
      mockFetch(listed)
      markCreated("run-2")
      const draft = { id: "run-2", furthest: 2, values: initialValues }

      const view = renderApp("/dashboard/new?step=2", { draft })

      expect(await view.findByRole("heading", { name: "My giveaways" })).toBeTruthy()
      expect(view.address()).toBe("/dashboard")
      expect(view.queryByRole("button", { name: "Start giveaway" })).toBeNull()
    })

    it("opens a fresh form for a run that was not created", async () => {
      mockFetch(listed)
      const draft = { id: "run-3", furthest: 1, values: initialValues }

      const view = renderApp("/dashboard/new", { draft })

      expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
    })

    it("ignores a history state that is not a draft", async () => {
      mockFetch(listed)

      const view = renderApp("/dashboard/new?step=2", { draft: { id: 7, furthest: 2 } })

      expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
    })

    it("opens a created page by its address with the giveaway from the list and no warnings", async () => {
      mockFetch(listed)

      const view = renderApp("/dashboard/created/gid-1")

      expect(await view.findByRole("heading", { name: "Your giveaway is live!" })).toBeTruthy()
      expect(view.queryByRole("alert")).toBeNull()
    })

    it("shows the warnings of the creation again after a reload of the created page", async () => {
      mockFetch(listed)

      const view = renderApp("/dashboard/created/gid-1", {
        kind: "created",
        roomReady: false,
        usageLow: 1200,
      })

      expect(await view.findByText(/only 1,200 requests left for today/)).toBeTruthy()
      expect(view.getByText(/not fully ready yet/)).toBeTruthy()
    })

    it("answers not found for a created page of a giveaway the streamer does not have", async () => {
      mockFetch(listed)

      const view = renderApp("/dashboard/created/other")

      expect(await view.findByRole("heading", { name: "Giveaway not found" })).toBeTruthy()
    })

    it("replaces the step with the one of a field the server refused", async () => {
      mockFetch(
        withCreate({
          status: 400,
          body: { error: "invalid-input", field: "title", code: "blank" },
        }),
      )
      const view = await openWizard()
      await toReview(view)

      fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
      await view.findByText("Step 1 of 3: Basics")

      expect(view.address()).toBe("/dashboard/new")
      view.back()
      expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
    })
  })

  describe("step indicator", () => {
    it("goes back to an earlier step and keeps every answer", async () => {
      mockFetch(listed)
      const view = await openWizard()
      fillGiveaway(view)
      next(view)
      await view.findByText("Step 2 of 3: Entry rules")
      fireEvent.change(view.getByLabelText("Minimum account age in days optional"), {
        target: { value: "7" },
      })

      fireEvent.click(view.getByRole("button", { name: "Step 1: Basics" }))

      expect(await view.findByText("Step 1 of 3: Basics")).toBeTruthy()
      expect(inputOf(view.getByLabelText("Giveaway name optional")).value).toBe("Cup")
      expect(inputOf(view.getByLabelText("What does the winner get? optional")).value).toBe(
        "A chair",
      )
      next(view)
      await view.findByText("Step 2 of 3: Entry rules")
      expect(inputOf(view.getByLabelText("Minimum account age in days optional")).value).toBe("7")
    })

    it("moves the keyboard focus to the step heading after going back with a step button", async () => {
      mockFetch(listed)
      const view = await openWizard()
      next(view)
      await view.findByText("Step 2 of 3: Entry rules")
      const stepOne = view.getByRole("button", { name: "Step 1: Basics" })
      stepOne.focus()

      fireEvent.click(stepOne)

      expect(
        (await view.findByRole("heading", { name: "Start with the basics" }))
          === document.activeElement,
      ).toBe(true)
      expect(document.activeElement === document.body).toBe(false)
    })

    it("offers only the done steps as buttons", async () => {
      mockFetch(listed)
      const view = await openWizard()
      const stepButtons = () =>
        Array.from(view.getByRole("list", { name: "Steps" }).querySelectorAll("button"), (button) =>
          button.getAttribute("aria-label"),
        )
      expect(stepButtons()).toEqual([])

      next(view)
      await view.findByText("Step 2 of 3: Entry rules")
      expect(stepButtons()).toEqual(["Step 1: Basics"])

      next(view)
      await view.findByText("Step 3 of 3: Review")
      expect(stepButtons()).toEqual(["Step 1: Basics", "Step 2: Entry rules"])
    })

    it("marks the current step with aria-current", async () => {
      mockFetch(listed)
      const view = await openWizard()
      next(view)
      await view.findByText("Step 2 of 3: Entry rules")

      const items = view.getByRole("list", { name: "Steps" }).querySelectorAll("li")
      expect(Array.from(items, (item) => item.getAttribute("aria-current"))).toEqual([
        null,
        "step",
        null,
      ])
    })

    it("checks the step again on Next after going back to it", async () => {
      mockFetch(listed)
      const view = await openWizard()
      next(view)
      await view.findByText("Step 2 of 3: Entry rules")
      fireEvent.click(view.getByRole("button", { name: "Step 1: Basics" }))
      await view.findByText("Step 1 of 3: Basics")

      fireEvent.click(view.getByRole("radio", { name: /At a set time/ }))
      next(view)

      expect(view.getByText("Pick the date and time when entries end.")).toBeTruthy()
      expect(view.getByText("Step 1 of 3: Basics")).toBeTruthy()
    })
  })

  describe("number steppers", () => {
    it("steps the winner count with the buttons, never below 1, and then focuses the count", async () => {
      mockFetch(listed)
      const view = await openWizard()
      next(view)
      await view.findByText("Step 2 of 3: Entry rules")
      const winners = inputOf(view.getByLabelText("Number of winners"))
      const fewer = view.getByRole("button", { name: "Fewer winners" })
      expect(fewer.hasAttribute("disabled")).toBe(true)

      fireEvent.click(view.getByRole("button", { name: "More winners" }))
      expect(winners.value).toBe("2")
      fewer.focus()
      fireEvent.click(fewer)

      expect(winners.value).toBe("1")
      expect(fewer.hasAttribute("disabled")).toBe(true)
      expect(document.activeElement === winners).toBe(true)
    })

    it("takes a typed account age and steps it by one day", async () => {
      mockFetch(listed)
      const view = await openWizard()
      next(view)
      await view.findByText("Step 2 of 3: Entry rules")
      const age = inputOf(view.getByLabelText("Minimum account age in days optional"))
      expect(age.value).toBe("")
      expect(view.getByRole("button", { name: "Fewer days" }).hasAttribute("disabled")).toBe(true)

      fireEvent.change(age, { target: { value: "30" } })
      fireEvent.click(view.getByRole("button", { name: "More days" }))
      expect(age.value).toBe("31")
      fireEvent.click(view.getByRole("button", { name: "Fewer days" }))
      fireEvent.click(view.getByRole("button", { name: "Fewer days" }))
      expect(age.value).toBe("29")
    })
  })

  describe("claim time", () => {
    it("has no help line and shows the minutes stepper only for Custom, starting at the preset", async () => {
      mockFetch(listed)
      const view = await openWizard()
      await toRules(view)
      expect(view.queryByText("Most streams use 5 minutes.")).toBeNull()
      expect(view.queryByLabelText("Minutes")).toBeNull()

      fireEvent.click(view.getByRole("radio", { name: "Custom" }))

      expect(inputOf(view.getByLabelText("Minutes")).value).toBe("5")
      expect(view.getByRole("button", { name: "More minutes" })).toBeTruthy()
    })

    it("hides the minutes stepper again when a preset is picked", async () => {
      mockFetch(listed)
      const view = await openWizard()
      await toRules(view)
      fireEvent.click(view.getByRole("radio", { name: "Custom" }))

      fireEvent.click(view.getByRole("radio", { name: "10 minutes" }))

      expect(view.queryByLabelText("Minutes")).toBeNull()
    })

    it("reviews the custom minutes and sends them in seconds", async () => {
      const requests = mockFetch(withCreate(createdReply))
      const view = await openWizard()
      await toRules(view)
      fireEvent.click(view.getByRole("radio", { name: "Custom" }))
      fireEvent.change(view.getByLabelText("Minutes"), { target: { value: "45" } })
      next(view)
      await view.findByText("Step 3 of 3: Review")

      expect(view.getByText(/^45 minutes\./)).toBeTruthy()
      fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))
      await view.findByRole("heading", { name: "Your giveaway is live!" })

      const sent = requests.find((request) => request.route === "POST /api/dash/giveaways")
      expect(sent?.body).toMatchObject({ claimSeconds: 2700 })
    })

    it("keeps Custom and its minutes when the streamer goes back from the review", async () => {
      mockFetch(listed)
      const view = await openWizard()
      await toRules(view)
      fireEvent.click(view.getByRole("radio", { name: "Custom" }))
      fireEvent.change(view.getByLabelText("Minutes"), { target: { value: "45" } })
      next(view)
      await view.findByText("Step 3 of 3: Review")

      fireEvent.click(view.getByRole("button", { name: "Step 2: Entry rules" }))

      await view.findByText("Step 2 of 3: Entry rules")
      expect(inputOf(view.getByRole("radio", { name: "Custom" })).checked).toBe(true)
      expect(inputOf(view.getByLabelText("Minutes")).value).toBe("45")
    })

    it.each([
      ["0", "0"],
      ["a fraction", "1.5"],
      ["empty", ""],
    ])("stays on step 2 for custom minutes of %s", async (_name, value) => {
      mockFetch(listed)
      const view = await openWizard()
      await toRules(view)
      fireEvent.click(view.getByRole("radio", { name: "Custom" }))
      fireEvent.change(view.getByLabelText("Minutes"), { target: { value } })

      next(view)

      expect(view.getByText("Enter a whole number of minutes, 1 or more.")).toBeTruthy()
      expect(view.getByLabelText("Minutes").getAttribute("aria-invalid")).toBe("true")
      expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
    })

    it("shows the server's refusal of the custom time under the minutes", async () => {
      mockFetch(
        withCreate({
          status: 400,
          body: { error: "invalid-input", field: "claimSeconds", code: "too-large" },
        }),
      )
      const view = await openWizard()
      await toRules(view)
      fireEvent.click(view.getByRole("radio", { name: "Custom" }))
      fireEvent.change(view.getByLabelText("Minutes"), { target: { value: "2000" } })
      next(view)
      await view.findByText("Step 3 of 3: Review")

      fireEvent.click(view.getByRole("button", { name: "Start giveaway" }))

      expect(await view.findByText("Step 2 of 3: Entry rules")).toBeTruthy()
      expect(view.getByLabelText("Minutes").getAttribute("aria-invalid")).toBe("true")
      expect(view.getByText("This number is too large. Enter a smaller one.")).toBeTruthy()
    })
  })
})

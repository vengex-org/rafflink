import { describe, expect, it } from "bun:test"
import { defaultOverlayTheme, parseOverlayTheme, type OverlayTheme } from "./overlay-theme.ts"

const custom: OverlayTheme = {
  accent: "#ff5500",
  background: "#ffffff",
  text: "#101010",
  font: "oswald",
  size: "large",
  position: "bottom-right",
  corners: "square",
  sound: true,
  confetti: true,
}

describe("parseOverlayTheme", () => {
  it("accepts a full theme", () => {
    expect(parseOverlayTheme(custom)).toEqual({ ok: true, value: custom })
  })

  it("keeps sound and confetti off by default", () => {
    expect(defaultOverlayTheme.sound).toBe(false)
    expect(defaultOverlayTheme.confetti).toBe(false)
  })

  it("lowercases a color", () => {
    expect(parseOverlayTheme({ ...custom, accent: "#AbCdEf" })).toEqual({
      ok: true,
      value: { ...custom, accent: "#abcdef" },
    })
  })

  it.each([[null], ["theme"], [3], [[]], [undefined]])("refuses %p as the theme", (input) => {
    expect(parseOverlayTheme(input)).toEqual({
      ok: false,
      issue: { field: "theme", code: "not-an-object" },
    })
  })

  it.each(Object.keys(custom))("refuses a theme without %s", (field) => {
    const rest = Object.fromEntries(Object.entries(custom).filter(([key]) => key !== field))
    expect(parseOverlayTheme(rest)).toEqual({ ok: false, issue: { field, code: "missing" } })
  })

  it("refuses an empty object at its first field", () => {
    expect(parseOverlayTheme({})).toEqual({
      ok: false,
      issue: { field: "accent", code: "missing" },
    })
  })

  it.each([
    "",
    " ",
    "#fff",
    "#ff550",
    "#ff55000",
    "ff5500",
    "#gg5500",
    "red",
    "rgb(1 2 3)",
    "#ff5500;background:url(x)",
    "#ff5500 ",
    3,
    null,
  ])("refuses %p as a color", (accent) => {
    expect(parseOverlayTheme({ ...custom, accent })).toEqual({
      ok: false,
      issue: { field: "accent", code: "not-a-color" },
    })
  })

  it.each([
    ["font", "comic-sans"],
    ["font", "Geist"],
    ["font", "constructor"],
    ["size", "huge"],
    ["size", 2],
    ["position", "center"],
    ["position", "__proto__"],
    ["corners", "round"],
    ["corners", null],
  ])("refuses %p %p as an unknown option", (field, value) => {
    expect(parseOverlayTheme({ ...custom, [field]: value })).toEqual({
      ok: false,
      issue: { field, code: "unknown-option" },
    })
  })

  it.each([
    ["sound", "true"],
    ["sound", 1],
    ["confetti", null],
  ])("refuses %p %p as a switch", (field, value) => {
    expect(parseOverlayTheme({ ...custom, [field]: value })).toEqual({
      ok: false,
      issue: { field, code: "not-a-boolean" },
    })
  })

  it("reads own fields only, never the prototype's", () => {
    expect(parseOverlayTheme(Object.create(custom))).toEqual({
      ok: false,
      issue: { field: "accent", code: "missing" },
    })
  })

  it("drops fields it does not know", () => {
    expect(parseOverlayTheme({ ...custom, css: "body{}" })).toEqual({ ok: true, value: custom })
  })
})

import { describe, expect, it } from "bun:test"
import { assertLocalUrl, NonLocalUrlError } from "./local-host.ts"

describe("assertLocalUrl", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:8787/auth/twitch/viewer",
    "http://[::1]:3000/",
    "https://LOCALHOST/",
  ])("accepts %s", (text) => {
    expect(assertLocalUrl(text).href).toBe(new URL(text).href)
  })

  it.each([
    "https://rafflink.app",
    "https://rafflink.app/g/ABCDE",
    "http://example.com:3000",
    "http://localhost.evil.example",
    "http://evil.example/localhost",
    "http://localhost@evil.example/",
    "http://127.0.0.1.evil.example",
    "http://127.0.0.2:3000",
    "http://192.168.1.10:3000",
    "http://0.0.0.0:3000",
    "http://[::2]/",
    "ftp://localhost/file",
    "ws://localhost:3000/live",
  ])("refuses %s", (text) => {
    expect(() => assertLocalUrl(text)).toThrow(NonLocalUrlError)
  })

  it("names the refused host in the error", () => {
    expect(() => assertLocalUrl("https://rafflink.app/g/ABCDE")).toThrow(
      "refusing rafflink.app: the load test only talks to localhost",
    )
  })

  it("rejects text that is not a URL", () => {
    expect(() => assertLocalUrl("")).toThrow(TypeError)
  })
})

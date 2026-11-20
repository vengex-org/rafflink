import { describe, expect, it } from "bun:test"
import { renderEnvExample } from "./env-example.ts"

describe("renderEnvExample", () => {
  it("equals the committed .env.example", async () => {
    const committed = await Bun.file(new URL("../.env.example", import.meta.url)).text()
    expect(committed).toBe(renderEnvExample())
  })

  it("lists a required key empty and a defaulted key with its default", () => {
    const lines = renderEnvExample().split("\n")
    expect(lines).toContain("TWITCH_CLIENT_ID=")
    expect(lines).toContain("DEV_FAKE_TWITCH=false")
  })
})

import { describe, expect, it, spyOn } from "bun:test"
import { RateLimitBindingLimiter, connectingAddress } from "./rate-limit-binding.ts"

function binding(limit: RateLimit["limit"]): RateLimit {
  return { limit }
}

describe("RateLimitBindingLimiter", () => {
  it("passes the key to the binding and returns its verdict", async () => {
    const keys: string[] = []
    const limiter = new RateLimitBindingLimiter(
      binding(async ({ key }) => {
        keys.push(key)
        return { success: key !== "blocked" }
      }),
    )

    expect(await limiter.allow("fine")).toBe(true)
    expect(await limiter.allow("blocked")).toBe(false)
    expect(keys).toEqual(["fine", "blocked"])
  })

  it("lets the call through and logs the error class when the binding fails", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    const limiter = new RateLimitBindingLimiter(
      binding(async () => {
        throw new RangeError("unavailable")
      }),
    )

    expect(await limiter.allow("a")).toBe(true)
    expect(warn).toHaveBeenCalledWith("rate limit binding failed", { errorClass: "RangeError" })
    warn.mockRestore()
  })
})

describe("connectingAddress", () => {
  it("reads cf-connecting-ip and returns null without it", () => {
    const withAddress = new Request("http://localhost/", {
      headers: { "cf-connecting-ip": "203.0.113.7" },
    })

    expect(connectingAddress(withAddress)).toBe("203.0.113.7")
    expect(connectingAddress(new Request("http://localhost/"))).toBeNull()
  })
})

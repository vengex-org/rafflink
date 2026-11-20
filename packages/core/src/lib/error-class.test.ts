import { describe, expect, it } from "bun:test"
import { errorClass } from "./error-class.ts"

describe("errorClass", () => {
  it("names the class of an error, subclasses included", () => {
    class CustomFailure extends Error {}

    expect(errorClass(new RangeError("x"))).toBe("RangeError")
    expect(errorClass(new CustomFailure("x"))).toBe("CustomFailure")
  })

  it("names the type of a thrown value that is not an error", () => {
    expect(errorClass("text")).toBe("string")
    expect(errorClass(undefined)).toBe("undefined")
    expect(errorClass(null)).toBe("object")
  })
})

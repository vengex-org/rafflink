import { afterEach, describe, expect, it } from "bun:test"
import { cleanup, render } from "@testing-library/react"
import { ExternalLink } from "../src/components/external-link.tsx"
import { I18nProvider } from "../src/i18n/i18n.tsx"

afterEach(cleanup)

describe("ExternalLink", () => {
  it("gives each link its own hint that says it opens in a new tab", () => {
    const view = render(
      <I18nProvider>
        <ExternalLink kind="own" href="https://example.com/a">
          First
        </ExternalLink>
        <ExternalLink kind="own" href="https://example.com/b">
          Second
        </ExternalLink>
      </I18nProvider>,
    )

    const first = view.getByRole("link", { name: "First" })
    const second = view.getByRole("link", { name: "Second" })
    const firstId = first.getAttribute("aria-describedby") ?? ""
    const secondId = second.getAttribute("aria-describedby") ?? ""

    expect(firstId).not.toBe("")
    expect(firstId).not.toBe(secondId)
    expect(document.getElementById(firstId)?.textContent).toBe("Opens in a new tab")
    expect(document.getElementById(secondId)?.textContent).toBe("Opens in a new tab")
    expect(first.getAttribute("target")).toBe("_blank")
  })

  it.each([
    ["own", "noopener"],
    ["donate", "noopener nofollow"],
    ["reference", "noopener noreferrer"],
  ] as const)("sets rel for the %s kind", (kind, rel) => {
    const view = render(
      <I18nProvider>
        <ExternalLink kind={kind} href="https://example.com">
          Link
        </ExternalLink>
      </I18nProvider>,
    )

    expect(view.getByRole("link", { name: "Link" }).getAttribute("rel")).toBe(rel)
  })
})

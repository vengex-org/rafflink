import type { ReactNode } from "react"
import { Navigate, useLocation, useParams } from "react-router"
import { parseGiveawayCode } from "../lib/giveaway-code.ts"
import { giveawayPath, verifyPath } from "../lib/routes.ts"
import { NotFound } from "./notice.tsx"

/**
 * Hands `children` the code in the address once it can be a giveaway code. A code typed in another case is
 * replaced by the canonical one in the address; a text that cannot be a code is a 404 without a request.
 */
export function GiveawayCode({
  page,
  children,
}: {
  readonly page: "giveaway" | "verify"
  readonly children: (code: string) => ReactNode
}) {
  const { code: typed = "" } = useParams()
  const { search, hash } = useLocation()
  const code = parseGiveawayCode(typed)
  if (code === null) return <NotFound title="notFound.page" />
  if (code !== typed) {
    const pathname = page === "verify" ? verifyPath(code) : giveawayPath(code)
    return <Navigate replace to={{ pathname, search, hash }} />
  }
  return children(code)
}

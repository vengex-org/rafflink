/**
 * Who runs this installation, named on the privacy policy and the terms; every language reads them
 * from here. `id` is the Czech business ID (IČO) of the sole trader.
 */
export const operator = {
  name: "Roman Vašek",
  address: "Michelská 966/74, 141 00 Praha 4 - Michle, Czech Republic",
  id: "29982901",
  contactEmail: "info@vengex.com",
} as const

/** The day the legal texts last changed, as an ISO date. Update it with every edit of the texts. */
export const legalUpdated = "2026-11-21"

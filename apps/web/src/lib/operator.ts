/**
 * Who runs this installation, named on the privacy policy and the terms. The owner replaces the three
 * placeholders before the public launch; every language reads them from here.
 */
export const operator = {
  name: "[OPERATOR NAME]",
  address: "[OPERATOR ADDRESS]",
  contactEmail: "[CONTACT EMAIL]",
} as const

/** The day the legal texts last changed, as an ISO date. Update it with every edit of the texts. */
export const legalUpdated = "2026-11-21"

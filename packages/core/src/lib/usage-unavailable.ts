const maxReasonLength = 300

/** The usage source did not answer with the day's numbers. `reason` is the failure text the source built, cut to 300 characters; the source removes any credential or account id before it builds it. */
export class UsageUnavailable extends Error {
  readonly reason: string

  constructor(reason: string, options?: ErrorOptions) {
    const truncated = reason.slice(0, maxReasonLength)
    super(truncated, options)
    this.reason = truncated
  }
}

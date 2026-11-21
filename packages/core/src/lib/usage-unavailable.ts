const maxReasonLength = 300

/** The usage source did not answer with the day's numbers. `reason` is safe to log: it never holds a credential or an account id. */
export class UsageUnavailable extends Error {
  readonly reason: string

  constructor(reason: string, options?: ErrorOptions) {
    const truncated = reason.slice(0, maxReasonLength)
    super(truncated, options)
    this.reason = truncated
  }
}

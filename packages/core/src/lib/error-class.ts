/** The name of an error's class, or of the thrown value's type; logs carry it because a message can hold a token, a code or a name. */
export function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error
}

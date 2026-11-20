/** The element as an input; fails the test when the query found something else. */
export function inputOf(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) throw new Error("expected an input element")
  return element
}

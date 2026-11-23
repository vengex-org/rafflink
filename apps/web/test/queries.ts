/** The element as an input; fails the test when the query found something else. */
export function inputOf(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) throw new Error("expected an input element")
  return element
}

/** Matches the innermost element whose text is `text`, also when inline markup (a `<code>`) splits it. */
export function wholeText(text: string): (content: string, element: Element | null) => boolean {
  return (_content, element) =>
    element !== null
    && element.textContent === text
    && Array.from(element.children).every((child) => child.textContent !== text)
}

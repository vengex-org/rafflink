import { fireEvent, within } from "@testing-library/react"

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

/** Picks a language in the dropdown inside `scope` by its own name ("Čeština"), as a person does. */
export function chooseLanguage(scope: HTMLElement, name: string): void {
  const option = within(scope).getByRole("option", { name })
  if (!(option instanceof HTMLOptionElement) || option.parentElement === null) {
    throw new Error("expected an option of a select")
  }
  fireEvent.change(option.parentElement, { target: { value: option.value } })
}

/** Two capitals for an avatar: the first letters of the first two words of a login, or the first two letters of a single word. Words without a letter ("77") count only when nothing else is there. */
export function initialsOf(name: string): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter((part) => part !== "")
  const lettered = parts.filter((part) => /\p{L}/u.test(part))
  const [first, second] = lettered.length > 0 ? lettered : parts
  if (first === undefined) return "?"
  const letters =
    second === undefined ? Array.from(first).slice(0, 2) : [first, second].map(firstLetter)
  return letters.join("").toUpperCase()
}

function firstLetter(word: string): string {
  return Array.from(word)[0] ?? ""
}

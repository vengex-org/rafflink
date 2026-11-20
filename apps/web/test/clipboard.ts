/** Replaces the browser clipboard; the texts written to it are collected, or the write is refused. */
export function stubClipboard(refuse: boolean): string[] {
  const copied: string[] = []
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (refuse) throw new Error("clipboard refused")
        copied.push(text)
      },
    },
  })
  return copied
}

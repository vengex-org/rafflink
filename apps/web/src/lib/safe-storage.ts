import { errorClass } from "@rafflink/core/lib/error-class"

// Storage is missing or refused in private mode and some embedded browsers; the app works without it, so a failure is logged once per call and absorbed.

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch (error) {
    console.warn("storage read failed", { key, errorClass: errorClass(error) })
    return null
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch (error) {
    console.warn("storage write failed", { key, errorClass: errorClass(error) })
  }
}

import { errorClass } from "@rafflink/core/lib/error-class"

// Storage is missing or refused in private mode and some embedded browsers; the app works without it, so a failure is logged once per call and absorbed.

type Area = "localStorage" | "sessionStorage"

export function readStored(key: string): string | null {
  return read("localStorage", key)
}

export function writeStored(key: string, value: string): void {
  write("localStorage", key, value)
}

/** Like {@link readStored}, for what must not outlive the browser tab. */
export function readSessionStored(key: string): string | null {
  return read("sessionStorage", key)
}

export function writeSessionStored(key: string, value: string): void {
  write("sessionStorage", key, value)
}

export function removeSessionStored(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch (error) {
    console.warn("storage remove failed", { key, errorClass: errorClass(error) })
  }
}

function read(area: Area, key: string): string | null {
  try {
    return window[area].getItem(key)
  } catch (error) {
    console.warn("storage read failed", { key, errorClass: errorClass(error) })
    return null
  }
}

function write(area: Area, key: string, value: string): void {
  try {
    window[area].setItem(key, value)
  } catch (error) {
    console.warn("storage write failed", { key, errorClass: errorClass(error) })
  }
}

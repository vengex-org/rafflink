/** The response does not have the shape the client was written for. `path` names the field, never its value. */
export class ApiShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected response at ${path}`)
  }
}

export type Json = Readonly<Record<string, unknown>>

export function record(value: unknown, path: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiShapeError(path)
  }
  return Object.fromEntries(Object.entries(value))
}

function field(source: Json, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined
}

export function text(source: Json, key: string): string {
  const value = field(source, key)
  if (typeof value !== "string") throw new ApiShapeError(key)
  return value
}

export function nullableText(source: Json, key: string): string | null {
  return field(source, key) === null ? null : text(source, key)
}

export function num(source: Json, key: string): number {
  const value = field(source, key)
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiShapeError(key)
  return value
}

export function nullableNum(source: Json, key: string): number | null {
  return field(source, key) === null ? null : num(source, key)
}

export function bool(source: Json, key: string): boolean {
  const value = field(source, key)
  if (typeof value !== "boolean") throw new ApiShapeError(key)
  return value
}

export function oneOf<T extends string>(source: Json, key: string, options: readonly T[]): T {
  const value = field(source, key)
  const match = options.find((option) => option === value)
  if (match === undefined) throw new ApiShapeError(key)
  return match
}

export function child(source: Json, key: string): Json {
  return record(field(source, key), key)
}

export function list<T>(source: Json, key: string, item: (entry: Json) => T): T[] {
  const value = field(source, key)
  if (!Array.isArray(value)) throw new ApiShapeError(key)
  return value.map((entry) => item(record(entry, key)))
}

export function textList(source: Json, key: string): string[] {
  const value = field(source, key)
  if (!Array.isArray(value)) throw new ApiShapeError(key)
  return value.map((entry) => {
    if (typeof entry !== "string") throw new ApiShapeError(key)
    return entry
  })
}

/** A list of finite numbers; an entry that is not one fails the whole read. */
export function numList(source: Json, key: string): number[] {
  const value = field(source, key)
  if (!Array.isArray(value)) throw new ApiShapeError(key)
  return value.map((entry) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) throw new ApiShapeError(key)
    return entry
  })
}

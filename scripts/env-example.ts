import { configSchema } from "../packages/core/src/config.ts"

const envExampleUrl = new URL("../.env.example", import.meta.url)

export function renderEnvExample(): string {
  const entries = Object.values(configSchema).map((field) => {
    const requirement = field.default === null ? " (required)" : ""
    return `# ${field.origin}${requirement}\n${field.env}=${field.default ?? ""}\n`
  })
  return entries.join("\n")
}

if (import.meta.main) {
  await Bun.write(envExampleUrl, renderEnvExample())
}

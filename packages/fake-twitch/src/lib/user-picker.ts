import type { FakeUser } from "../state.ts"

/** A page with one button per user; each continues the authorize request with `login_hint` set. */
export function userPickerPage(users: Iterable<FakeUser>, authorizeUrl: URL): string {
  const buttons = Array.from(users, (user) => {
    const next = new URL(authorizeUrl)
    next.searchParams.set("login_hint", user.id)
    const href = `${next.pathname}${next.search}`
    return `<a class="user" href="${escapeHtml(href)}">${escapeHtml(user.displayName)}<small>${escapeHtml(user.login)}</small></a>`
  })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pick a test user</title>
<style>
body{font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem;line-height:1.4}
.user{display:block;margin:.75rem 0;padding:.9rem 1rem;border:2px solid #444;border-radius:.75rem;color:inherit;text-decoration:none;font-weight:700}
.user small{display:block;font-weight:400;opacity:.7}
</style>
</head>
<body>
<h1>Pick a test user</h1>
<p>This is the fake Twitch for local development. Choose who signs in.</p>
${buttons.join("\n")}
</body>
</html>
`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

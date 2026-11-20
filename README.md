# Rafflink

Giveaways for Twitch streamers without chat keywords. The streamer creates a giveaway and posts a link;
viewers open it, sign in with Twitch and are entered. See [docs/spec.md](docs/spec.md) for the product spec.

Rafflink runs on Cloudflare (Workers, Durable Objects, D1) or on any server with Docker.

## Development

Requires [Bun](https://bun.sh) 1.4.5 or newer.

```sh
bun install
bun run check
```

## Twitch app registration

Rafflink signs streamers and viewers in with Twitch, so every installation needs its own Twitch app. You
register it once and copy two values into the config.

1. Turn on two-factor authentication on the Twitch account that will own the app (Twitch settings, Security
   and Privacy). The developer console refuses to register apps without it.
2. Open the [Twitch developer console](https://dev.twitch.tv/console/apps) and choose **Register Your
   Application**.
3. Fill in the form:
   - **Name:** any unique name, for example `Rafflink` plus your channel name. Viewers see it on the Twitch
     consent screen.
   - **OAuth Redirect URLs:** add both callback URLs of your installation. Replace the origin with your
     `PUBLIC_URL`:
     - `https://rafflink.example.com/auth/twitch/streamer`
     - `https://rafflink.example.com/auth/twitch/viewer`

     For local development against real Twitch add the local origins too, for example
     `http://localhost:3000/auth/twitch/streamer` and `http://localhost:3000/auth/twitch/viewer` (Docker or the
     Bun server) or the same paths on `http://localhost:8787` (`wrangler dev`). Twitch accepts `http` only for
     `localhost`.

   - **Category:** Website Integration.
   - **Client Type:** Confidential. Rafflink keeps the secret on the server.
4. Choose **Create**, then **Manage** next to the new app.
5. Copy the **Client ID** into `TWITCH_CLIENT_ID`.
6. Choose **New Secret**, confirm, and copy the secret into `TWITCH_CLIENT_SECRET`. Twitch shows it once. If you
   lose it, create a new one and update the config; the old one stops working.

You do not pick scopes in the console. Rafflink asks for them at sign-in:

- streamers: `openid`, `channel:read:vips`, `moderation:read` (to know VIPs and moderators) and
  `user:read:chat` (to watch the chat for claims);
- viewers: `openid`, `user:read:subscriptions` and `user:read:follows` (to check who may enter and how many
  tickets they get).

The rest of the required config:

- `PUBLIC_URL`: the origin people open, for example `https://rafflink.example.com`, with no trailing slash.
  It must match the redirect URLs above.
- `ADMIN_TWITCH_IDS`: your numeric Twitch user id (not the login name). Any "Twitch user id lookup" tool
  shows it.
- `SESSION_SECRET`: a long random string, for example the output of `openssl rand -base64 32`.
- `TOKEN_SEAL_KEYS`: the key that encrypts stored streamer tokens, written as `<key id>:<32 random bytes in
  base64>`, for example `k1:` followed by the output of `openssl rand -base64 32`. To rotate, put the new key
  first and keep the old one after a comma until every streamer has signed in again.

Every other setting has a default; see [.env.example](.env.example).

## Self-hosting

To be written with the server and Cloudflare adapters.

## License

[AGPL-3.0](LICENSE)

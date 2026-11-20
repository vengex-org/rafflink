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

To be written with the sign-in flow.

## Self-hosting

To be written with the server and Cloudflare adapters.

## License

[AGPL-3.0](LICENSE)

# Watchline

Tiny serverless uptime and page-change monitoring for Cloudflare Workers.

Watchline is built for small projects, solo builders, and teams that want a cheap open source monitor without running a VM. It checks whether a URL is up, whether page text changed, or whether a specific JSON/regex field changed.

## What ships in v0.1.0

- TypeScript monitoring core
- Local CLI: `watchline check <url>`
- Cloudflare Worker API and compact UI
- Cloudflare D1 schema
- Single cron-driven scheduler
- GitHub Actions CI and npm release workflow

## Install

```sh
npm install -g watchline
```

```sh
watchline check https://example.com
watchline check https://api.example.com/status --json-pointer /status
watchline check https://example.com/pricing --regex "Price: (\\d+)" --group 1
```

## Deploy on Cloudflare

Create a D1 database:

```sh
npx wrangler d1 create watchline
```

Copy the returned database id into `wrangler.toml`, then apply the schema:

```sh
npx wrangler d1 migrations apply watchline --remote
```

Deploy:

```sh
npm run build
npm run deploy
```

Set an admin token for write actions:

```sh
npx wrangler secret put WATCHLINE_ADMIN_TOKEN
```

## API

```sh
curl https://your-worker.example.com/api/monitors
```

```sh
curl -X POST https://your-worker.example.com/api/monitors \
  -H "content-type: application/json" \
  -H "x-watchline-token: $WATCHLINE_ADMIN_TOKEN" \
  -d '{
    "name": "Docs",
    "url": "https://example.com/docs",
    "mode": "page",
    "intervalMinutes": 60
  }'
```

## Monitor modes

- `uptime`: checks HTTP health and response time.
- `page`: strips noisy HTML and compares normalized text hashes.
- `field`: tracks one extracted value with JSON Pointer or regex.

## Why this exists

Uptime tools are great for down/up checks. Page-change tools are powerful but often heavier than needed. Watchline aims for the thin middle: a small serverless monitor that costs almost nothing for small workloads, with room for JavaScript rendering and AI summaries later.

## Release

The repo uses Changesets. CI checks type safety, tests, and build output. The release workflow publishes to npm when `NPM_TOKEN` is configured in GitHub repository secrets.

For user-facing changes, run `npm run changeset` before merging the feature PR.

Local release checks:

```sh
npm run ci
npm run release:dry-run
```

## License

MIT

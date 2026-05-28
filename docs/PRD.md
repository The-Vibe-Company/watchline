# PRD: Watchline

## Introduction

Watchline is a tiny open source monitor for people who need to know whether a URL is up or whether a page/field changed, without running a server. It combines the useful parts of uptime monitoring and page-change detection in a deliberately small Cloudflare-first package.

The product should be cheap by default: deterministic checks run every time, and expensive capabilities such as JavaScript rendering or LLM summaries are optional extensions.

## Goals

- Let a user create a monitor for any HTTP URL in under one minute.
- Support three MVP monitor modes: uptime, full-page text change, and field change.
- Run on Cloudflare Workers with D1 and a single global cron trigger.
- Provide a minimal self-serve UI plus JSON API.
- Publish the reusable TypeScript core and CLI to npm as `watchline`.
- Keep the architecture ready for future JavaScript rendering without requiring it in v0.

## User Stories

### US-001: Add an uptime monitor

**Description:** As a builder, I want to monitor whether a URL returns a healthy response so that I know when a project is down.

**Acceptance Criteria:**

- [ ] User can create a monitor with name, URL, mode, and interval.
- [ ] Uptime mode marks a monitor up for 2xx/3xx responses by default.
- [ ] Uptime mode supports an exact expected status code.
- [ ] Runs are stored with status, status code, response time, and error.
- [ ] Typecheck and tests pass.

### US-002: Detect page text changes

**Description:** As a builder, I want to detect when meaningful page text changes so that I can track docs, pricing, or public pages.

**Acceptance Criteria:**

- [ ] Page mode fetches the response body without JavaScript rendering.
- [ ] HTML is normalized by removing scripts, styles, tags, and extra whitespace.
- [ ] The normalized text is hashed and compared with the previous run.
- [ ] A run is marked changed only when the hash differs after the first baseline run.
- [ ] A short diff summary is stored when previous text exists.
- [ ] Typecheck and tests pass.

### US-003: Detect a field change

**Description:** As a builder, I want to monitor a specific value instead of a whole page so that alerts stay quiet.

**Acceptance Criteria:**

- [ ] Field mode supports JSON Pointer extraction for JSON APIs.
- [ ] Field mode supports regex extraction for HTML/text responses.
- [ ] Extracted values are hashed and compared with previous values.
- [ ] Extraction failures mark the run down and store a useful error.
- [ ] Typecheck and tests pass.

### US-004: Run serverless checks on a schedule

**Description:** As a self-hosting user, I want scheduled checks without a server so that the monitor costs almost nothing while idle.

**Acceptance Criteria:**

- [ ] A single Cloudflare Cron Trigger runs every minute.
- [ ] The Worker queries D1 for monitors whose `next_check_at` is due.
- [ ] The Worker caps checks per cron run with `WATCHLINE_MAX_CHECKS_PER_CRON`.
- [ ] Each run updates `last_hash`, `last_status`, `last_checked_at`, and `next_check_at`.
- [ ] D1 schema is included in `migrations/`.

### US-005: Use a tiny self-serve UI

**Description:** As a solo user, I want a simple browser UI so that I do not need to write JSON for common monitor operations.

**Acceptance Criteria:**

- [ ] UI lists monitors with name, URL, mode, last status, and next check time.
- [ ] UI can add a monitor.
- [ ] UI can trigger a check now.
- [ ] UI can delete a monitor.
- [ ] UI works on mobile and desktop without overlapping text.

### US-006: Publish an open source package

**Description:** As an open source user, I want to install Watchline from npm so that I can use the CLI or build on the core library.

**Acceptance Criteria:**

- [ ] Package is named `watchline`.
- [ ] Package exports TypeScript types and ESM modules.
- [ ] CLI command `watchline check <url>` works after build.
- [ ] CI runs typecheck, tests, and build.
- [ ] Release workflow can publish to npm with `NPM_TOKEN`.

## Functional Requirements

- FR-1: The system must support monitor modes `uptime`, `page`, and `field`.
- FR-2: The system must fetch pages with standard HTTP fetch in v0.
- FR-3: The system must normalize HTML before hashing page content.
- FR-4: The system must store monitor definitions in D1.
- FR-5: The system must store every check run in D1.
- FR-6: The system must use one global cron trigger instead of one cron per monitor.
- FR-7: The system must expose a JSON API for listing, creating, deleting, and manually checking monitors.
- FR-8: The system must expose a minimal browser UI served by the Worker.
- FR-9: The npm package must include a CLI for one-off checks.
- FR-10: The release process must support automated npm publication from GitHub Actions.

## Non-Goals

- No JavaScript/browser rendering in v0.
- No hosted SaaS billing or multi-tenant accounts in v0.
- No SMS, Slack, Discord, or email notification delivery in v0.
- No visual screenshot diffing in v0.
- No complex incident management or public status pages in v0.
- No AI diff summaries in v0; the architecture should leave room for them.

## Design Considerations

- The UI should feel like a compact utility, not a marketing site.
- The first screen should be the monitor list and add form.
- Configuration should prefer boring primitives: URL, mode, interval, extractor.
- Advanced fields can come later after the core loop proves useful.

## Technical Considerations

- Cloudflare Workers Free has limited cron triggers, so Watchline must schedule from the database.
- D1 is the source of truth for monitor configuration and run history.
- The core monitor logic must be framework-free TypeScript so it can run in the CLI and Worker.
- Future JavaScript rendering should be implemented as a fetcher strategy, likely using Cloudflare Browser Rendering.
- Future AI summaries should run only after deterministic change detection finds a change.

## Success Metrics

- First monitor created and checked in under one minute.
- Idle deployment cost stays within Cloudflare free-tier usage for small personal use.
- 100 hourly page monitors produce fewer than 2,500 Worker checks per day.
- CLI check produces useful JSON output in under one second for fast pages.
- False-positive noise can be reduced by switching from page mode to field mode.

## Open Questions

- Which notification channel should ship first: webhook, email, Slack, or Discord?
- Should public status pages be a separate package or a later Worker route?
- Should CSS selector extraction be implemented with a parser dependency or deferred until JavaScript rendering exists?
- Should the hosted version use one Cloudflare account per customer or a multi-tenant database?

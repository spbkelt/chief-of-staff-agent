# Fixtures (contributor / CI only)

JSON sample data for **Vitest** and `pnpm demo-fixtures`. Not used on executive product paths.

| File | Purpose |
|------|---------|
| `calendar-events.json` | Mock Google Calendar ingest |
| `email-threads.json` | Mock Gmail ingest |
| `asana-tasks.json` | Mock Asana ingest |

Requires `COS_ALLOW_FIXTURES=true` (set by `demo-fixtures` and test harness). Never enable on live operator demos.

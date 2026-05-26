# Contributing

Contributor documentation is centralized here.

## Canonical References

- Acceptance checklist: `docs/ACCEPTANCE_CRITERIA.md`
- Architecture and extensibility: `docs/ARCHITECTURE.md`
- Setup/deployment runbook: `docs/DEPLOYMENT.md`

## Core Commands

```bash
pnpm build
pnpm test
pnpm acceptance
pnpm account   # list connected accounts (~/.cos/config.json)
```

## Team-kit (build-time only)

```bash
pnpm setup-soofi-plugin
pnpm verify-soofi-plugin
```

`setup-soofi-plugin` / `verify-soofi-plugin` **only** install and verify the team-kit Cursor plugin. They are not product runtime, not `@bigboss` operator commands, and not substitutes for `skills/build-cos-*`.

### Skills policy (contributors vs operators)

| Audience | What to use |
|----------|-------------|
| **Executive / operator** | `@bigboss` in Cursor → approved `pnpm` Runs. **Do not** load `skills/build-cos-*` or invoke team-kit subagents on this path. |
| **Contributor** | `/arceus` (routing) → team-kit **subagent** for heavy/generic work → team-kit **parent skill** → repo **`skills/build-cos-*/SKILL.md` overlays** (thin COS-only delta: paths, contracts, hard rules). |

Keep overlays light (“extends team-kit; don’t duplicate parent”). Subagents route and implement patterns; overlays preserve COS constraints when Cursor does not invoke a subagent. Runtime code never reads skill files.

Audit team-kit agents against COS at pin `external/soofi-team-kit.lock` (`8e85bc1`). Map module gaps in `docs/ACCEPTANCE_CRITERIA.md` § Team-Kit Module Alignment; agent audit in `docs/ARCHITECTURE.md` § Team-kit alignment — do not add new markdown audit files.

Route via `/arceus` before implementing; load parent skills then `skills/build-cos-*` overlays.

## Local Development

Use `docs/DEPLOYMENT.md` for setup, validation, ingest, and run workflows. Executive UX: `agents/bigboss.md` § Executive journeys.

## Local infra scripts (optional)

One-off helpers (e.g. `scripts/infra/seed-asana-dummy-data.py`) live under `scripts/infra/`. That directory is **gitignored** — copy or create locally; do not commit credentials. AWS bootstrap: `scripts/bootstrap-aws-cos.sh`, `scripts/fix-aws-sso-config.sh` (tracked).

## Guardrails

- Follow `CLAUDE.md` and `.cursor/rules/`
- Do not commit secrets
- Keep acceptance status synchronized with `docs/ACCEPTANCE_CRITERIA.md`

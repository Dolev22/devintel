---
name: devintel-rebuild
description: Step-by-step guide to rebuilding DevIntel — a multi-agent code-analysis / developer-intelligence platform (FastAPI + React/Vite + Supabase Postgres, deployed on Vercel) — from an empty project through a working production deployment. Use this skill whenever the user wants to recreate, scaffold, or understand the DevIntel system architecture, or asks how to build a similar developer-intelligence / code-review platform with Supabase auth+RLS, a multi-agent analysis pipeline, an internal scheduling calendar, or demo-only social account integrations. Also consult it before touching DevIntel's Supabase schema, RLS policies, Vercel deployment config, or the Code Review Calendar / Social Accounts features, since it documents real bugs that were hit and fixed during development and how to avoid repeating them.
---

# DevIntel Rebuild Guide

DevIntel is a multi-agent developer-intelligence platform: it clones a GitHub
repository, runs a Code Analysis Agent and a Security Agent over it, has a
Review Agent consolidate their findings into a health score and report, and
exposes all of it through a FastAPI backend + React/Vite frontend backed by
Supabase Postgres.

This skill documents the **exact, verified build order** for recreating this
system, plus every real bug that was discovered and fixed along the way —
follow the order below and read the referenced file before each stage; each
one exists because skipping it caused a real, reproducible failure during
development.

## Before you start: what's real vs. simulated

Be precise about this with whoever you're building for — DevIntel intentionally
mixes real and demo functionality, and blurring the line is the single easiest
way to misrepresent the system:

| Feature | Status |
|---|---|
| GitHub analysis pipeline, findings, reports, health scores | **Real** — runs against real repos (or bundled demo fixtures), real Postgres persistence |
| Auth (JWT), Supabase Postgres, RLS | **Real** |
| Code Review Calendar (scheduling) | **Real** — real persistence, real timezone math, no external calendar |
| Anthropic/Claude-powered analysis | **Real integration, intentionally disabled** — see `references/03-anthropic-config.md` |
| LinkedIn/Facebook/Instagram "connections" | **Demo only** — see `references/07-social-accounts-demo.md`. Never claim these are real OAuth. |
| Meeting email/reminder notifications | **Does not exist.** No emails are ever sent. |
| KIE.ai / fal.ai | **Not part of this system at all.** If a task mentions these, say so plainly rather than inventing an integration — nothing in DevIntel touches either service. |

## Build order

Follow this order. Each stage's reference file has copy-pasteable schemas,
commands, and — critically — a "Pitfalls" section documenting what actually
broke when this was built the first time.

### 1. Data model, Supabase, auth, RLS
Read `references/01-supabase-and-auth.md` first — everything downstream
depends on getting the ownership model right. Key decision to make upfront:
DevIntel uses **its own JWT auth**, not Supabase Auth, which changes how RLS
policies must be written and why they're a defense-in-depth layer rather than
the primary access control for the app's own traffic.

### 2. Backend: FastAPI + the multi-agent analysis pipeline
Read `references/02-backend-and-analysis-pipeline.md`. Covers the
Orchestrator → Code Analysis Agent + Security Agent → Review Agent → Report
pipeline, the local heuristic engine, and the GitHub fetch/prescan step.

### 3. Anthropic/Claude integration — and its safe kill switch
Read `references/03-anthropic-config.md`. Build the real integration, then
wire the disable flag the way this project does it — a single boolean that
overrides everything else, so cost can be controlled without deleting code.

### 4. Frontend: React/Vite architecture
Read `references/04-frontend-architecture.md`. Component/page conventions,
the shared `Modal`/`Icon`/badge system, and how pages call the backend.

### 5. Deploy to Vercel
Read `references/05-vercel-deployment.md` **before** attempting a first
deploy. This is the stage with the most non-obvious failure modes — a naive
approach silently produces a broken deployment that looks like it succeeded.

### 6. Internal Code Review Calendar (scheduling feature)
Read `references/06-code-review-calendar.md`. Covers the
`scheduled_meetings` table, the UTC-instant + IANA-timezone storage pattern,
and two real bugs that were fixed (an empty-string foreign key bug and a
broken date-range label from a partial `Intl` options object).

### 7. Social Accounts feature (Facebook/Instagram/LinkedIn) — demo only
Read `references/07-social-accounts-demo.md`. Covers how to build a
homework/demo-safe "connect accounts" feature that is honest about not being
a real integration, without inventing fake backend infrastructure.

### 8. Full pitfalls register
`references/08-pitfalls-register.md` is a flat, searchable list of every bug
in this skill in one place, in case you only need to check one thing.

## Reusable scripts

- `scripts/rls_policy_template.sql` — the exact ownership-RLS pattern used on
  every table in this project. Fill in the table name and apply after
  creating any new user-owned table.

## What NOT to add

- **KIE.ai, fal.ai** — not part of this system. Do not add references,
  environment variables, or UI copy implying they exist.
- **Real OAuth for Facebook/Instagram/LinkedIn** — out of scope unless a real
  Developer App with credentials is explicitly configured; see
  `references/07-social-accounts-demo.md` for exactly what that would require.
- **Email/notification sending for meetings** — not built, not planned;
  don't imply it exists in UI copy.
- **A second ORM or Node-based database layer** — this project is
  Python/SQLAlchemy only, schema evolved via `Base.metadata.create_all`
  (no Alembic). Keep it that way unless there's a strong reason to change.

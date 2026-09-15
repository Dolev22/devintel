# devintel-rebuild (Skill)

A Claude Code skill documenting exactly how DevIntel — a multi-agent
code-analysis / developer-intelligence platform — was built, in the order it
was actually built and verified, including the real bugs hit along the way
and how they were fixed.

## What this is for

This is a **rebuild/reference skill**, not a general-purpose tool. It exists
so that:

- Claude (or a developer) can recreate this exact system from an empty
  project through a working Vercel production deployment, in the correct
  order, without repeating mistakes that were already made and fixed once.
- Anyone touching DevIntel's Supabase schema, RLS policies, Vercel config,
  Code Review Calendar, or Social Accounts features has a single place to
  check before making a change, so tribal knowledge about *why* things are
  built the way they are doesn't get lost.

## How it's organized

- **`SKILL.md`** — the entry point. States the build order and, critically,
  a table distinguishing what's genuinely real in DevIntel from what's
  intentionally simulated/demo. Read this first.
- **`references/`** — one file per build stage, each with a "why," working
  code/config, and a pitfalls section for bugs specific to that stage.
- **`scripts/rls_policy_template.sql`** — the one piece of copy-paste-and-
  fill-in tooling worth bundling: the exact RLS policy pattern used on every
  user-owned table in this project.

## What this skill deliberately does *not* cover

- **KIE.ai and fal.ai** — these are not part of DevIntel in any way. If a
  task description mentions them, that's a mismatch with this project, not
  something to silently paper over by inventing an integration.
- Any instruction to make a demo feature (social account "connections,"
  Anthropic re-enablement, etc.) behave as if it were real. The whole point
  of `SKILL.md`'s "what's real vs. simulated" table and
  `references/07-social-accounts-demo.md` is to keep that line clear for
  whoever uses this skill next.

## Using this skill

Point Claude Code at this skill directory (or let it auto-discover via
`.claude/skills/devintel-rebuild/` in this repo) when the task is: rebuilding
DevIntel from scratch, understanding why a piece of its architecture is
shaped the way it is, or extending it in a way that touches auth, RLS,
deployment config, the calendar, or the social-accounts feature. Read
`SKILL.md`'s build order, then only the specific `references/*.md` file
relevant to the stage in question — the whole reference set doesn't need to
be loaded for every task.

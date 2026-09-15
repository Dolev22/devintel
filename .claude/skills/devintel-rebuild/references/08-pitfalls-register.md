# Pitfalls Register — Flat Index

Every real bug documented in this skill, in one searchable place. Each links
to the fuller writeup.

| # | Symptom | Cause | Fix | Detail |
|---|---|---|---|---|
| 1 | `DATABASE_URL=` (blank but set) silently uses SQLite instead of erroring or falling through | `os.getenv(key, default)` only falls through on a fully *unset* var, not an empty string | Use `os.getenv(key) or default` | `01-supabase-and-auth.md` |
| 2 | Backend can't reach Postgres at all | Using Supabase's direct host, which can be IPv6-only/unreachable | Use the pooler host, `postgresql+psycopg://` scheme, `psycopg[binary]` installed | `01-supabase-and-auth.md` |
| 3 | New user-owned table has no RLS after `create_all` | `create_all` only creates schema, never RLS | Apply `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policies separately, every time | `01-supabase-and-auth.md` |
| 4 | Vercel deploy "succeeds" but `/` returns bare 404 | Legacy `builds`/`routes` config silently drops the static-build output | Use `buildCommand`/`outputDirectory`/`rewrites` config instead | `05-vercel-deployment.md` |
| 5 | Vercel function throws `ModuleNotFoundError: No module named 'app'` | Vercel doesn't add `backend/` to `sys.path` automatically | `sys.path.insert(0, ...)` in the `api/index.py` entry file before importing | `05-vercel-deployment.md` |
| 6 | Vercel Python function's real dependencies never actually installed | `requirements.txt` was only in `backend/`, not at the project root / next to the entry file | Mirror `requirements.txt` next to `api/index.py` | `05-vercel-deployment.md` |
| 7 | Deployed app 500s on every DB-touching request | `DATABASE_URL` not set in Vercel env — falls back to a SQLite path on a read-only filesystem | Set `DATABASE_URL` (and `JWT_SECRET`) in the Vercel project before/immediately after first deploy | `05-vercel-deployment.md` |
| 8 | Creating a meeting with a blank `finding_id`/`report_id` 500s with a `ForeignKeyViolation` | Row construction used the raw unvalidated request field instead of the validated resolved object | Build the row from `finding.id if finding else None`, not `payload.finding_id` directly; also normalize blank strings to `None` in the request schema | `06-code-review-calendar.md` |
| 9 | Calendar Week-view header renders garbled text like `"2026 (day: 19)"` | Partial `Intl.DateTimeFormat` options object (`{day, year}` with no `month`) | Extract pieces explicitly and assemble the label string yourself; don't trust partial `Intl` options in concatenated strings | `06-code-review-calendar.md` |
| 10 | Settings shows LinkedIn "Connected" but the LinkedIn-sharing modal thinks it isn't (or vice versa) | Two independent `localStorage` keys tracking the same concept, from two features built at different times | Consolidate to one shared state module; never add a second flag for a concept that already has one | `07-social-accounts-demo.md` |
| 11 | Icon component throws a TypeScript error when passed `style` | The shared `Icon.X` components don't accept a `style` prop | Wrap in a `<span style={...}>` instead | `04-frontend-architecture.md` |
| 12 | Local `curl`/dev-server calls to `127.0.0.1:<port>` hang or refuse while `localhost:<port>` works | Some local dev setups bind/resolve `localhost` and `127.0.0.1` differently (IPv6 vs IPv4) | Prefer `localhost` over the literal `127.0.0.1` when testing a local dev server, if one form mysteriously hangs | (encountered during local Vite dev-server testing; not a DevIntel code bug, an environment quirk worth knowing about) |

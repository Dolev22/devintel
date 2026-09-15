# Supabase, Auth, and RLS

## Auth model: custom JWT, not Supabase Auth

DevIntel does **not** use Supabase Auth. It has its own `users` table and its
own login/register endpoints:

- Passwords hashed with **PBKDF2-HMAC-SHA256** (stdlib `hashlib`, 240,000
  iterations, salted) — no bcrypt dependency needed.
- Sessions are custom JWTs (PyJWT), signed with `JWT_SECRET`, decoded by a
  `get_current_user` FastAPI dependency.
- Wrong password → `401 "Incorrect email or password."`

**Why this matters for RLS**: Supabase's `auth.uid()` reflects the JWT
`sub` claim that *Supabase's own* auth system injects via PostgREST. Since
DevIntel's backend authenticates with its own JWTs and connects to Postgres
directly (not through PostgREST), `auth.uid()` is never populated by
DevIntel's own traffic. Write the RLS policies anyway, in the same
`auth.uid()::text = user_id` style used throughout this project — they still
serve as the real enforcement layer for any *other* access path (Supabase
client SDKs, PostgREST, a future direct end-user connection), and staying
consistent with the existing pattern matters more than a marginal
technically-correct alternative.

**Why the app's own traffic isn't blocked by RLS**: connect as the
Postgres role `postgres`, which has `rolbypassrls = true`. This is normal,
expected Postgres behavior for a privileged service connection — RLS is not
"broken" because of it, and don't try to force RLS onto that role.

## Schema shape

All tables use **app-generated UUID strings** (Python `uuid.uuid4()`) as
`varchar(36)` primary keys — not native Postgres `uuid` type, not
DB-generated. Ownership chain:

```
users (root)
 ├─ user_preferences.user_id → users.id           (1:1)
 └─ repositories.user_id → users.id                (owner)
     ├─ repository_files.repository_id → repositories.id
     ├─ analyses.repository_id → repositories.id
     │   ├─ agent_runs.analysis_id → analyses.id
     │   └─ reports.analysis_id → analyses.id (unique) + reports.repository_id
     ├─ findings.analysis_id / .repository_id → both set directly
     │   └─ feedback.finding_id → findings.id  +  feedback.user_id → users.id
     └─ scheduled_meetings.user_id → users.id (direct)
         optionally .repository_id / .finding_id / .report_id

sources — standalone, no owner, shared knowledge-base content
```

Two ownership *styles* exist and both are correct for their case:
- **Direct ownership** (`user_id` column right on the table): `repositories`,
  `feedback`, `scheduled_meetings`. RLS policy: `auth.uid()::text = user_id`.
- **Owned via the repository chain** (no `user_id` column, but a
  `repository_id` that traces to one): `repository_files`, `analyses`,
  `findings`. RLS policy needs an `EXISTS` subquery through `repositories`.

## RLS policy pattern (copy-paste template)

For a directly-owned table (see `scripts/rls_policy_template.sql` for the
fill-in-the-blank version):

```sql
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;

CREATE POLICY <table_name>_select_own ON <table_name>
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY <table_name>_insert_own ON <table_name>
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY <table_name>_update_own ON <table_name>
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY <table_name>_delete_own ON <table_name>
  FOR DELETE USING (auth.uid()::text = user_id);
```

For a table owned via the repository chain, the `USING`/`WITH CHECK` clause
becomes:

```sql
EXISTS (
  SELECT 1 FROM repositories r
  WHERE r.id = <table_name>.repository_id AND r.user_id = auth.uid()::text
)
```

`sources` (shared knowledge base, no owner) gets a simpler `SELECT`-only
policy for any `authenticated` user — no ownership check needed.

**Verify after applying**, don't just trust the migration ran:

```sql
SELECT relrowsecurity FROM pg_class WHERE relname = '<table_name>';
SELECT policyname, cmd FROM pg_policies WHERE tablename = '<table_name>';
```

## Schema evolution: no Alembic

This project evolves its schema with SQLAlchemy's `Base.metadata.create_all`
(called on every backend startup), not migrations. Adding a table or column
means: add it to the SQLAlchemy model, and it appears in Postgres on the next
process start. RLS is **not** part of `create_all` — you must apply it
separately (via `execute_sql`/`apply_migration` against Supabase, or by
running raw SQL through the app's own configured engine) every time a new
user-owned table is added. Don't skip this step; a table with no RLS is a
real security gap on a publicly-reachable Supabase project.

## Connection string pitfalls (both were real bugs)

1. **Use the pooler, not the direct host.** Supabase's direct Postgres host
   (`db.<ref>.supabase.co`) can be IPv6-only and unreachable from some dev
   environments. Always use the pooler:
   ```
   DATABASE_URL=postgresql+psycopg://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
   Scheme **must** be `postgresql+psycopg://` (psycopg3 — add
   `psycopg[binary]` to requirements). Plain `postgresql://` fails with
   `ModuleNotFoundError: psycopg2` if psycopg2 was never installed.

2. **`os.getenv(key, default)` does not fall through on an empty-but-set
   variable.** If `.env` has `DATABASE_URL=` (present but blank), the
   two-argument form returns `""`, not the default — only a fully *unset*
   variable falls through. This project's `config.py` uses
   `os.getenv("DATABASE_URL") or default_db` specifically to handle this.
   Keep the `or`, don't "simplify" it back to the two-arg form.

3. **For serverless deployment (Vercel)**, SQLAlchemy's default connection
   pool (5 + overflow per warm function instance) combined with Supabase's
   **session-mode** pooler (port 5432) can exhaust connections under
   concurrent traffic, since each cold serverless instance opens its own
   pool. This wasn't hit in testing at demo scale, but if scaling up,
   switch `DATABASE_URL` to the **transaction-mode** pooler port (6543)
   instead — an env-var-only change, no code touch needed.

## Demo user seeding

Seed a demo account idempotently on backend startup (check-then-insert, not
upsert-with-conflict, since IDs are app-generated). If you ever run the same
seed logic against two different databases, the demo user will get
**different UUIDs** in each — match it by email across databases, never by ID.

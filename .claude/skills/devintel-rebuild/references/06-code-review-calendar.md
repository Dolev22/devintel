# Internal Code Review Calendar (Scheduling Feature)

This is a real, fully-internal feature: no Google Calendar, no Outlook, no
external service, no emails sent. It exists specifically because a homework
requirement to "schedule social media posts" was adapted to DevIntel's real
purpose — scheduling a future Code Review / Code Discussion meeting around
an existing Finding or Report.

## Schema

```python
class ScheduledMeeting(Base):
    __tablename__ = "scheduled_meetings"

    id = Column(String(36), primary_key=True, default=new_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    repository_id = Column(String(36), ForeignKey("repositories.id"), nullable=True, index=True)
    finding_id = Column(String(36), ForeignKey("findings.id"), nullable=True, index=True)
    report_id = Column(String(36), ForeignKey("reports.id"), nullable=True, index=True)

    title = Column(String(255), nullable=False)
    scheduled_at = Column(DateTime(timezone=True), nullable=False, index=True)  # UTC instant
    timezone = Column(String(64), nullable=False, default="UTC")               # IANA name

    participants = Column(String(1024), nullable=True)  # comma-separated, free text
    notes = Column(Text, nullable=True)
    status = Column(String(16), default="scheduled", nullable=False, index=True)  # scheduled | cancelled

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
```

Directly `user_id`-owned (like `feedback`), with optional links to
`repository_id`/`finding_id`/`report_id` for context. Cancel is a **soft
delete** (`status = "cancelled"`) — a `reschedule` endpoint flips it back to
`"scheduled"`. There is no hard-delete endpoint by design; keep the history.

## The timezone storage pattern (this is the core design decision)

Store **two fields**, not one naive datetime:

- `scheduled_at` — the authoritative **UTC instant**, computed server-side
  from the user's chosen date + time + timezone. Used for ordering and any
  range queries.
- `timezone` — the **IANA zone name** (e.g. `"Asia/Jerusalem"`) the meeting
  was booked in.

Never store just a naive local datetime, and never discard the timezone
after computing UTC — you need both so the meeting can always be re-rendered
at the exact wall-clock time it was scheduled for, regardless of what
timezone the *viewer's browser* happens to be in (the same principle a real
calendar app uses per-event timezones).

**Backend conversion** (stdlib `zoneinfo`, no new dependency):

```python
from datetime import datetime
from zoneinfo import ZoneInfo

def compute_scheduled_at(date: str, time: str, timezone: str) -> datetime:
    local_dt = datetime.fromisoformat(f"{date}T{time}")
    zoned = local_dt.replace(tzinfo=ZoneInfo(timezone))
    return zoned.astimezone(ZoneInfo("UTC"))
```

Validate the timezone by trying `ZoneInfo(value)` and catching the
exception — this gives you free validation against the real IANA database
instead of maintaining a hardcoded enum on the backend (the frontend can
still offer a curated dropdown of common zones for UX, but the backend
should accept any valid IANA name).

**Frontend**: never rely on the browser's own timezone to display a meeting.
Use `Intl.DateTimeFormat(..., { timeZone: meeting.timezone })` to always
render in the meeting's *own* stored zone:

```ts
function formatInTimezone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone, year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}
```

When editing a meeting, decompose the stored UTC instant back into
`YYYY-MM-DD` / `HH:MM` form values **in the meeting's own timezone**, not
the browser's, using `Intl.DateTimeFormat(..., { timeZone })` with
`formatToParts()` — otherwise re-opening an edit form silently shifts the
displayed date/time.

## Bug #1 (real, fixed): raw payload IDs bypassing validation

The create-meeting endpoint validates `finding_id`/`report_id` ownership via
a `_resolve_context()` helper that returns the *validated* `Finding`/`Report`
objects (or `None`). The original implementation validated correctly but
then did this when actually building the row:

```python
# WRONG — uses the raw, unvalidated request field
meeting = ScheduledMeeting(finding_id=payload.finding_id, ...)
```

If `payload.finding_id` was an empty string (a client bug, or a form that
sends `""` instead of omitting the field), `_resolve_context` correctly
treated it as "no finding" and returned `finding=None` — but the row
construction still wrote the literal `""` into the `finding_id` foreign key
column, which Postgres then rejected with a `ForeignKeyViolation` (`Key
(finding_id)=() is not present`), surfaced to the client as a generic 500.

**Fix**: always build the row from the *validated* objects the resolver
returned, never from the raw payload fields:

```python
finding_id=finding.id if finding else None,
report_id=report.id if report else None,
```

Also add a Pydantic validator that normalizes blank strings to `None` on the
request schema itself, as defense in depth — don't rely on a single layer to
catch this class of bug.

## Bug #2 (real, fixed): broken date-range label from partial `Intl` options

The Week view's header originally built its label like this:

```ts
// WRONG — partial options object
`${start.toLocaleDateString(undefined, { month: "long", day: "numeric" })} – ` +
`${end.toLocaleDateString(undefined, { day: "numeric", year: "numeric" })}`
```

Passing `{ day: "numeric", year: "numeric" }` with **no `month`** to
`toLocaleDateString` is technically valid, but at least one browser's `Intl`
implementation rendered it in a non-obvious fallback form that looked like
`"2026 (day: 19)"` instead of a plain date — garbled, and not caught by a
type checker since the options object is valid TypeScript.

**Fix**: don't rely on partial `Intl` options for anything you're
concatenating into a larger string — extract the pieces you need explicitly
and assemble the label yourself:

```ts
const startMonth = start.toLocaleDateString(undefined, { month: "short" });
const endMonth = end.toLocaleDateString(undefined, { month: "short" });
const label = startMonth === endMonth
  ? `${startMonth} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`
  : `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
```

General lesson: **visually check every `Intl`-formatted string that mixes
partial option sets**, especially ones you're concatenating — don't trust
that "it typechecks" means "it renders sensibly."

## Verifying this feature end-to-end (do this after building it)

1. Create a meeting from a real Finding/Report with a non-UTC timezone.
2. Confirm the returned `scheduled_at` is the correct UTC conversion (e.g.
   14:30 Asia/Jerusalem in September → 11:30 UTC, a +3 offset).
3. **Restart the backend process entirely** (or redeploy) and re-fetch the
   same meeting by ID — this proves it's real Postgres persistence, not an
   in-memory artifact.
4. Edit the timezone/time and confirm `scheduled_at` recomputes correctly.
5. Check it renders on the correct day in Day, Week, and Month views.
6. Cancel it, confirm the status change persists and the UI reflects it
   (e.g. strikethrough) without a full page reload.
7. Clean up any meetings you created purely for testing — never leave test
   artifacts in a shared/production database, and never delete a meeting
   that wasn't yours to begin with (check title/participants/notes before
   assuming a row is safe to remove).

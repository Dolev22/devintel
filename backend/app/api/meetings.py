"""Internal Code Review Calendar — scheduling future Code Review / Code
Discussion meetings around an existing Insight (Finding) or Report.

Purely internal to DevIntel: no external calendar or social platform is
involved. Every meeting is owned by a user and, where possible, linked to
the repository/finding/report it was scheduled from so the calendar can
show real DevIntel context.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query

from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db.session import get_db
from app.models import Finding, Report, Repository, ScheduledMeeting, User
from app.schemas import MeetingCreateRequest, MeetingUpdateRequest, serialize_meeting

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def _compute_scheduled_at(date: str, time: str, timezone: str) -> datetime:
    local_dt = datetime.fromisoformat(f"{date}T{time}")
    zoned = local_dt.replace(tzinfo=ZoneInfo(timezone))
    return zoned.astimezone(ZoneInfo("UTC"))


def _owned_meeting(meeting_id: str, user: User, db: Session) -> ScheduledMeeting:
    meeting = db.get(ScheduledMeeting, meeting_id)
    if meeting is None or meeting.user_id != user.id:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return meeting


def _resolve_context(
    payload_repository_id: str | None,
    payload_finding_id: str | None,
    payload_report_id: str | None,
    user: User,
    db: Session,
) -> tuple[str | None, Finding | None, Report | None]:
    """Validates ownership of any linked repository/finding/report and
    derives the repository id from the finding/report when not given
    explicitly. Raises 404 if the caller references something they don't own.
    """
    finding: Finding | None = None
    report: Report | None = None
    repository_id = payload_repository_id

    if payload_finding_id:
        finding = db.get(Finding, payload_finding_id)
        if finding is None:
            raise HTTPException(status_code=404, detail="Insight not found.")
        repo = db.get(Repository, finding.repository_id)
        if repo is None or repo.user_id != user.id:
            raise HTTPException(status_code=404, detail="Insight not found.")
        repository_id = repository_id or finding.repository_id

    if payload_report_id:
        report = db.get(Report, payload_report_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Report not found.")
        repo = db.get(Repository, report.repository_id)
        if repo is None or repo.user_id != user.id:
            raise HTTPException(status_code=404, detail="Report not found.")
        repository_id = repository_id or report.repository_id

    if repository_id:
        repo = db.get(Repository, repository_id)
        if repo is None or repo.user_id != user.id:
            raise HTTPException(status_code=404, detail="Repository not found.")

    return repository_id, finding, report


def _hydrate(meeting: ScheduledMeeting, db: Session) -> dict:
    repository = db.get(Repository, meeting.repository_id) if meeting.repository_id else None
    finding = db.get(Finding, meeting.finding_id) if meeting.finding_id else None
    report = db.get(Report, meeting.report_id) if meeting.report_id else None
    return serialize_meeting(meeting, repository, finding, report)


@router.get("")
def list_meetings(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    status: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ScheduledMeeting).filter(ScheduledMeeting.user_id == user.id)

    if date_from:
        parsed = datetime.fromisoformat(date_from)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo("UTC"))
        query = query.filter(ScheduledMeeting.scheduled_at >= parsed)
    if date_to:
        parsed = datetime.fromisoformat(date_to)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo("UTC"))
        query = query.filter(ScheduledMeeting.scheduled_at <= parsed)
    if status:
        query = query.filter(ScheduledMeeting.status == status)

    meetings = query.order_by(ScheduledMeeting.scheduled_at).all()
    return {"meetings": [_hydrate(m, db) for m in meetings]}


@router.post("", status_code=201)
def create_meeting(
    payload: MeetingCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repository_id, finding, report = _resolve_context(
        payload.repository_id, payload.finding_id, payload.report_id, user, db
    )

    try:
        scheduled_at = _compute_scheduled_at(payload.date, payload.time, payload.timezone)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date/time/timezone: {exc}") from exc

    meeting = ScheduledMeeting(
        user_id=user.id,
        repository_id=repository_id,
        finding_id=finding.id if finding else None,
        report_id=report.id if report else None,
        title=payload.title.strip(),
        scheduled_at=scheduled_at,
        timezone=payload.timezone,
        participants=(payload.participants or "").strip() or None,
        notes=(payload.notes or "").strip() or None,
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    return _hydrate(meeting, db)


@router.get("/{meeting_id}")
def get_meeting(
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _owned_meeting(meeting_id, user, db)
    return _hydrate(meeting, db)


@router.patch("/{meeting_id}")
def update_meeting(
    meeting_id: str,
    payload: MeetingUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _owned_meeting(meeting_id, user, db)

    fields = payload.model_dump(exclude_unset=True)

    if any(k in fields for k in ("date", "time", "timezone")):
        current_local = meeting.scheduled_at.astimezone(ZoneInfo(meeting.timezone))
        date = fields.get("date", current_local.date().isoformat())
        time = fields.get("time", current_local.time().strftime("%H:%M"))
        timezone = fields.get("timezone", meeting.timezone)
        try:
            meeting.scheduled_at = _compute_scheduled_at(date, time, timezone)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid date/time/timezone: {exc}") from exc
        meeting.timezone = timezone

    if "title" in fields:
        meeting.title = fields["title"].strip()
    if "participants" in fields:
        meeting.participants = (fields["participants"] or "").strip() or None
    if "notes" in fields:
        meeting.notes = (fields["notes"] or "").strip() or None

    db.commit()
    db.refresh(meeting)
    return _hydrate(meeting, db)


@router.patch("/{meeting_id}/cancel")
def cancel_meeting(
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = _owned_meeting(meeting_id, user, db)
    meeting.status = "cancelled"
    db.commit()
    db.refresh(meeting)
    return _hydrate(meeting, db)


@router.patch("/{meeting_id}/reschedule")
def reactivate_meeting(
    meeting_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restores a cancelled meeting back to 'scheduled'."""
    meeting = _owned_meeting(meeting_id, user, db)
    meeting.status = "scheduled"
    db.commit()
    db.refresh(meeting)
    return _hydrate(meeting, db)

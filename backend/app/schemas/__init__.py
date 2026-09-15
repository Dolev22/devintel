from __future__ import annotations

import json
from datetime import date as date_cls
from datetime import datetime
from datetime import time as time_cls
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator

from app.models import (
    Analysis,
    AgentRun,
    Feedback,
    Finding,
    Report,
    Repository,
    RepositoryFile,
    ScheduledMeeting,
    Source,
    User,
)


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str
    password: str


class RepositoryCreateRequest(BaseModel):
    github_url: str = Field(min_length=5, max_length=512)
    branch: str | None = Field(default=None, max_length=128)
    name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("github_url")
    @classmethod
    def strip_url(cls, value: str) -> str:
        return value.strip()


class RepositoryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    branch: str | None = Field(default=None, max_length=128)
    language: str | None = Field(default=None, max_length=64)


class FindingStatusRequest(BaseModel):
    status: Literal["open", "resolved", "false_positive", "review_later"]
    note: str | None = Field(default=None, max_length=2000)


class FeedbackCreateRequest(BaseModel):
    text: str = Field(min_length=3, max_length=2000)


class PreferencesUpdateRequest(BaseModel):
    theme: Literal["dark", "light"] | None = None
    direction: Literal["ltr", "rtl"] | None = None
    run_code_analysis: bool | None = None
    run_security: bool | None = None
    min_severity: Literal["critical", "high", "medium", "low"] | None = None
    min_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    max_files_per_analysis: int | None = Field(default=None, ge=5, le=200)
    notify_on_complete: bool | None = None
    notify_on_critical: bool | None = None
    notify_weekly_digest: bool | None = None


def _check_date(value: str | None) -> str | None:
    if value is None:
        return value
    try:
        date_cls.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("date must be in YYYY-MM-DD format") from exc
    return value


def _check_time(value: str | None) -> str | None:
    if value is None:
        return value
    try:
        time_cls.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("time must be in HH:MM format") from exc
    return value


def _check_timezone(value: str | None) -> str | None:
    if value is None:
        return value
    try:
        ZoneInfo(value)
    except Exception as exc:
        raise ValueError(f"Unknown timezone: {value}") from exc
    return value


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


class MeetingCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    repository_id: str | None = None
    finding_id: str | None = None
    report_id: str | None = None
    date: str
    time: str
    timezone: str = "UTC"
    participants: str | None = Field(default=None, max_length=1024)
    notes: str | None = Field(default=None, max_length=4000)

    _v_repo = field_validator("repository_id")(_blank_to_none)
    _v_finding = field_validator("finding_id")(_blank_to_none)
    _v_report = field_validator("report_id")(_blank_to_none)
    _v_date = field_validator("date")(_check_date)
    _v_time = field_validator("time")(_check_time)
    _v_tz = field_validator("timezone")(_check_timezone)


class MeetingUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    date: str | None = None
    time: str | None = None
    timezone: str | None = None
    participants: str | None = Field(default=None, max_length=1024)
    notes: str | None = Field(default=None, max_length=4000)

    _v_date = field_validator("date")(_check_date)
    _v_time = field_validator("time")(_check_time)
    _v_tz = field_validator("timezone")(_check_timezone)


class ProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=255)


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat() + "Z"
    return value.isoformat()


def _loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "created_at": _iso(user.created_at),
    }


def serialize_preferences(preference) -> dict:
    if preference is None:
        return {}
    return {
        "theme": preference.theme,
        "direction": preference.direction,
        "language": preference.language,
        "run_code_analysis": preference.run_code_analysis,
        "run_security": preference.run_security,
        "min_severity": preference.min_severity,
        "min_confidence": preference.min_confidence,
        "max_files_per_analysis": preference.max_files_per_analysis,
        "notify_on_complete": preference.notify_on_complete,
        "notify_on_critical": preference.notify_on_critical,
        "notify_weekly_digest": preference.notify_weekly_digest,
        "updated_at": _iso(preference.updated_at),
    }


def serialize_repository(repository: Repository, stats: dict | None = None) -> dict:
    payload = {
        "id": repository.id,
        "name": repository.name,
        "owner": repository.owner,
        "github_url": repository.github_url,
        "description": repository.description,
        "language": repository.language,
        "branch": repository.branch,
        "is_demo": repository.is_demo,
        "health_score": repository.health_score,
        "file_count": repository.file_count,
        "loc_count": repository.loc_count,
        "created_at": _iso(repository.created_at),
        "last_analyzed_at": _iso(repository.last_analyzed_at),
    }
    if stats:
        payload.update(stats)
    return payload


def serialize_agent_run(run: AgentRun) -> dict:
    return {
        "id": run.id,
        "analysis_id": run.analysis_id,
        "agent_type": run.agent_type,
        "label": run.label,
        "order_index": run.order_index,
        "status": run.status,
        "input_summary": run.input_summary,
        "output_summary": run.output_summary,
        "error_message": run.error_message,
        "findings_count": run.findings_count,
        "duration_ms": run.duration_ms,
        "started_at": _iso(run.started_at),
        "completed_at": _iso(run.completed_at),
    }


def serialize_analysis(
    analysis: Analysis,
    repository: Repository | None = None,
    include_stages: bool = False,
    severity_counts: dict | None = None,
) -> dict:
    payload = {
        "id": analysis.id,
        "repository_id": analysis.repository_id,
        "repository_name": repository.name if repository else None,
        "repository_language": repository.language if repository else None,
        "status": analysis.status,
        "current_stage": analysis.current_stage,
        "summary": analysis.summary,
        "error_message": analysis.error_message,
        "files_analyzed": analysis.files_analyzed,
        "loc_analyzed": analysis.loc_analyzed,
        "duration_ms": analysis.duration_ms,
        "engine": analysis.engine,
        "created_at": _iso(analysis.created_at),
        "started_at": _iso(analysis.started_at),
        "completed_at": _iso(analysis.completed_at),
        "findings_count": len(analysis.findings) if analysis.findings is not None else 0,
        "has_report": analysis.report is not None,
    }
    if include_stages:
        payload["stages"] = [serialize_agent_run(r) for r in analysis.agent_runs]
    if severity_counts is not None:
        payload["severity_counts"] = severity_counts
    return payload


def serialize_feedback(feedback: Feedback, author: User | None = None) -> dict:
    return {
        "id": feedback.id,
        "finding_id": feedback.finding_id,
        "text": feedback.text,
        "author_name": author.name if author else None,
        "considered": feedback.considered,
        "considered_at": _iso(feedback.considered_at),
        "created_at": _iso(feedback.created_at),
    }


def serialize_finding(
    finding: Finding, repository: Repository | None = None, include_feedback: bool = False
) -> dict:
    payload = {
        "id": finding.id,
        "analysis_id": finding.analysis_id,
        "repository_id": finding.repository_id,
        "repository_name": repository.name if repository else None,
        "agent_type": finding.agent_type,
        "rule_id": finding.rule_id,
        "title": finding.title,
        "description": finding.description,
        "explanation": finding.explanation,
        "why_it_matters": finding.why_it_matters,
        "recommendation": finding.recommendation,
        "suggested_fix": finding.suggested_fix,
        "severity": finding.severity,
        "category": finding.category,
        "domain": finding.domain,
        "confidence": finding.confidence,
        "file_path": finding.file_path,
        "line_number": finding.line_number,
        "code_start_line": finding.code_start_line,
        "code_end_line": finding.code_end_line,
        "related_file_path": finding.related_file_path,
        "related_line_number": finding.related_line_number,
        "status": finding.status,
        "status_note": finding.status_note,
        "status_changed_at": _iso(finding.status_changed_at),
        "reviewed": finding.reviewed,
        "review_verdict": finding.review_verdict,
        "review_priority": finding.review_priority,
        "original_severity": finding.original_severity,
        "original_confidence": finding.original_confidence,
        "merged_count": finding.merged_count,
        "corroborated_by": finding.corroborated_by,
        "group_key": finding.group_key,
        "created_at": _iso(finding.created_at),
        "feedback_count": finding.feedback_count,
        "feedback_verdict": finding.feedback_verdict,
        "feedback_considered_at": _iso(finding.feedback_considered_at),
        "pre_feedback_severity": finding.pre_feedback_severity,
        "pre_feedback_confidence": finding.pre_feedback_confidence,
    }
    if include_feedback:
        payload["feedback"] = [serialize_feedback(f, f.user) for f in finding.feedback_entries]
    return payload


def serialize_report(report: Report, repository: Repository | None = None, analysis: Analysis | None = None) -> dict:
    return {
        "id": report.id,
        "analysis_id": report.analysis_id,
        "repository_id": report.repository_id,
        "repository_name": repository.name if repository else None,
        "title": report.title,
        "summary": report.summary,
        "recommendations": _loads(report.recommendations, []),
        "top_issues": _loads(report.top_issues, []),
        "category_breakdown": _loads(report.category_breakdown, {}),
        "severity_breakdown": _loads(report.severity_breakdown, {}),
        "metadata": _loads(report.metadata_json, {}),
        "health_score": report.health_score,
        "total_findings": report.total_findings,
        "created_at": _iso(report.created_at),
        "analysis_status": analysis.status if analysis else None,
        "analysis_completed_at": _iso(analysis.completed_at) if analysis else None,
        "engine": analysis.engine if analysis else None,
    }


def serialize_file_summary(file: RepositoryFile, finding_counts: dict | None = None) -> dict:
    return {
        "id": file.id,
        "path": file.path,
        "language": file.language,
        "line_count": file.line_count,
        "size_bytes": file.size_bytes,
        "is_test": file.is_test,
        "priority_score": file.priority_score,
        "finding_counts": finding_counts or {},
    }


def serialize_file_detail(file: RepositoryFile, findings: list[Finding]) -> dict:
    return {
        "id": file.id,
        "path": file.path,
        "language": file.language,
        "line_count": file.line_count,
        "size_bytes": file.size_bytes,
        "is_test": file.is_test,
        "content": file.content,
        "findings": [serialize_finding(f) for f in findings],
    }


def serialize_meeting(
    meeting: ScheduledMeeting,
    repository: Repository | None = None,
    finding: Finding | None = None,
    report: Report | None = None,
) -> dict:
    return {
        "id": meeting.id,
        "title": meeting.title,
        "repository_id": meeting.repository_id,
        "repository_name": repository.name if repository else None,
        "finding_id": meeting.finding_id,
        "finding_title": finding.title if finding else None,
        "report_id": meeting.report_id,
        "report_title": report.title if report else None,
        "scheduled_at": _iso(meeting.scheduled_at),
        "timezone": meeting.timezone,
        "participants": meeting.participants,
        "notes": meeting.notes,
        "status": meeting.status,
        "created_at": _iso(meeting.created_at),
        "updated_at": _iso(meeting.updated_at),
    }


def serialize_source(source: Source) -> dict:
    return {
        "id": source.id,
        "name": source.name,
        "type": source.type,
        "url": source.url,
        "description": source.description,
        "category": source.category,
        "tags": [t.strip() for t in (source.tags or "").split(",") if t.strip()],
        "body": source.body,
        "order_index": source.order_index,
    }

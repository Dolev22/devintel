from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.agents import review_agent
from app.auth.deps import get_current_user
from app.db.session import get_db
from app.models import Analysis, Feedback, Finding, Report, Repository, User
from app.schemas import (
    FeedbackCreateRequest,
    FindingStatusRequest,
    serialize_analysis,
    serialize_feedback,
    serialize_finding,
    serialize_report,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["analyses"])


def _user_repository_ids(user: User, db: Session) -> list[str]:
    return [
        row[0]
        for row in db.query(Repository.id).filter(Repository.user_id == user.id).all()
    ]


def _severity_counts(db: Session, analysis_id: str) -> dict:
    counts = Counter()
    rows = db.query(Finding.severity).filter(Finding.analysis_id == analysis_id).all()
    for (severity,) in rows:
        counts[severity] += 1
    return {s: counts.get(s, 0) for s in ("critical", "high", "medium", "low")}


# ---------------------------------------------------------------------------
# Analyses
# ---------------------------------------------------------------------------


@router.get("/analyses")
def list_analyses(
    repository_id: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repository_ids = _user_repository_ids(user, db)
    if not repository_ids:
        return []

    query = db.query(Analysis).filter(Analysis.repository_id.in_(repository_ids))
    if repository_id:
        query = query.filter(Analysis.repository_id == repository_id)
    if status_filter:
        query = query.filter(Analysis.status == status_filter)

    analyses = query.order_by(Analysis.created_at.desc()).limit(limit).all()
    repositories = {
        r.id: r for r in db.query(Repository).filter(Repository.id.in_(repository_ids)).all()
    }

    return [
        serialize_analysis(
            a,
            repositories.get(a.repository_id),
            include_stages=True,
            severity_counts=_severity_counts(db, a.id),
        )
        for a in analyses
    ]


@router.get("/analyses/{analysis_id}")
def get_analysis(
    analysis_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    analysis = db.get(Analysis, analysis_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    repository = db.get(Repository, analysis.repository_id)
    if repository is None or repository.user_id != user.id:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    findings = (
        db.query(Finding)
        .filter(Finding.analysis_id == analysis.id)
        .order_by(Finding.review_priority)
        .all()
    )

    return {
        "analysis": serialize_analysis(
            analysis,
            repository,
            include_stages=True,
            severity_counts=_severity_counts(db, analysis.id),
        ),
        "findings": [serialize_finding(f, repository) for f in findings],
        "report": (
            serialize_report(analysis.report, repository, analysis)
            if analysis.report
            else None
        ),
    }


# ---------------------------------------------------------------------------
# Findings / Developer Insights
# ---------------------------------------------------------------------------


@router.get("/findings")
def list_findings(
    repository_id: str | None = Query(default=None),
    analysis_id: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    category: str | None = Query(default=None),
    domain: str | None = Query(default=None),
    agent_type: str | None = Query(default=None),
    finding_status: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    latest_only: bool = Query(default=True),
    limit: int = Query(default=300, ge=1, le=1000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repository_ids = _user_repository_ids(user, db)
    if not repository_ids:
        return {"findings": [], "facets": {}, "total": 0}

    query = db.query(Finding).filter(Finding.repository_id.in_(repository_ids))

    if latest_only and not analysis_id:
        # Only the most recent completed analysis per repository.
        latest_ids = []
        for rid in repository_ids:
            latest = (
                db.query(Analysis.id)
                .filter(Analysis.repository_id == rid, Analysis.status == "completed")
                .order_by(Analysis.created_at.desc())
                .first()
            )
            if latest:
                latest_ids.append(latest[0])
        if not latest_ids:
            return {"findings": [], "facets": {}, "total": 0}
        query = query.filter(Finding.analysis_id.in_(latest_ids))

    if analysis_id:
        query = query.filter(Finding.analysis_id == analysis_id)
    if repository_id:
        query = query.filter(Finding.repository_id == repository_id)
    if severity:
        query = query.filter(Finding.severity.in_(severity.split(",")))
    if category:
        query = query.filter(Finding.category.in_(category.split(",")))
    if domain:
        query = query.filter(Finding.domain.in_(domain.split(",")))
    if agent_type:
        query = query.filter(Finding.agent_type.in_(agent_type.split(",")))
    if finding_status:
        query = query.filter(Finding.status.in_(finding_status.split(",")))
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            Finding.title.ilike(pattern)
            | Finding.description.ilike(pattern)
            | Finding.file_path.ilike(pattern)
        )

    findings = (
        query.order_by(Finding.review_priority, Finding.created_at.desc()).limit(limit).all()
    )

    repositories = {
        r.id: r for r in db.query(Repository).filter(Repository.id.in_(repository_ids)).all()
    }

    facets = {
        "severity": dict(Counter(f.severity for f in findings)),
        "category": dict(Counter(f.category for f in findings).most_common()),
        "domain": dict(Counter(f.domain for f in findings)),
        "agent_type": dict(Counter(f.agent_type for f in findings)),
        "status": dict(Counter(f.status for f in findings)),
    }

    return {
        "findings": [serialize_finding(f, repositories.get(f.repository_id)) for f in findings],
        "facets": facets,
        "total": len(findings),
    }


@router.get("/findings/{finding_id}")
def get_finding(
    finding_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found.")

    repository = db.get(Repository, finding.repository_id)
    if repository is None or repository.user_id != user.id:
        raise HTTPException(status_code=404, detail="Finding not found.")

    related = (
        db.query(Finding)
        .filter(
            Finding.analysis_id == finding.analysis_id,
            Finding.id != finding.id,
            Finding.group_key == finding.group_key,
        )
        .order_by(Finding.review_priority)
        .limit(8)
        .all()
    )

    # Same-file neighbours help the developer see clustering.
    same_file = (
        db.query(Finding)
        .filter(
            Finding.analysis_id == finding.analysis_id,
            Finding.id != finding.id,
            Finding.file_path == finding.file_path,
        )
        .order_by(Finding.line_number)
        .limit(8)
        .all()
        if finding.file_path
        else []
    )

    from app.models import RepositoryFile

    code_file = (
        db.query(RepositoryFile)
        .filter(
            RepositoryFile.repository_id == finding.repository_id,
            RepositoryFile.path == finding.file_path,
        )
        .first()
        if finding.file_path
        else None
    )

    related_file = (
        db.query(RepositoryFile)
        .filter(
            RepositoryFile.repository_id == finding.repository_id,
            RepositoryFile.path == finding.related_file_path,
        )
        .first()
        if finding.related_file_path
        else None
    )

    analysis = db.get(Analysis, finding.analysis_id)

    return {
        "finding": serialize_finding(finding, repository, include_feedback=True),
        "related_findings": [serialize_finding(f, repository) for f in related],
        "same_file_findings": [serialize_finding(f, repository) for f in same_file],
        "code": (
            {
                "file_id": code_file.id,
                "path": code_file.path,
                "language": code_file.language,
                "content": code_file.content,
                "line_count": code_file.line_count,
            }
            if code_file
            else None
        ),
        "related_code": (
            {
                "file_id": related_file.id,
                "path": related_file.path,
                "language": related_file.language,
                "content": related_file.content,
                "line_count": related_file.line_count,
            }
            if related_file
            else None
        ),
        "analysis": serialize_analysis(analysis, repository) if analysis else None,
    }


@router.patch("/findings/{finding_id}/status")
def update_finding_status(
    finding_id: str,
    payload: FindingStatusRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found.")

    repository = db.get(Repository, finding.repository_id)
    if repository is None or repository.user_id != user.id:
        raise HTTPException(status_code=404, detail="Finding not found.")

    finding.status = payload.status
    finding.status_note = (payload.note or "").strip() or None
    finding.status_changed_at = datetime.now(timezone.utc)
    db.commit()

    return serialize_finding(finding, repository)


# ---------------------------------------------------------------------------
# Developer feedback
#
# Feedback -> Database -> Review / Developer Intelligence Agent -> outcome.
# Submitting feedback immediately hands it to the Review Agent as high-priority
# context for THIS finding (not a full pipeline re-run), and the agent's
# verdict — including any severity/confidence change — is stored right away so
# the developer sees the outcome without waiting for a new analysis.
# ---------------------------------------------------------------------------


@router.post("/findings/{finding_id}/feedback", status_code=status.HTTP_201_CREATED)
def add_finding_feedback(
    finding_id: str,
    payload: FeedbackCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found.")

    repository = db.get(Repository, finding.repository_id)
    if repository is None or repository.user_id != user.id:
        raise HTTPException(status_code=404, detail="Finding not found.")

    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Feedback cannot be empty.")

    feedback = Feedback(finding_id=finding.id, user_id=user.id, text=text)
    db.add(feedback)
    db.flush()

    # Hand ALL feedback on this finding (most recent last) to the Review Agent as
    # high-priority context — not just the entry just submitted — so a second
    # piece of feedback is reasoned about alongside the first, not in isolation.
    all_texts = [f.text for f in finding.feedback_entries] + [text]

    if finding.feedback_count == 0:
        # First time feedback is considered: snapshot what the agents concluded
        # on their own, so the UI can always show "AI finding -> feedback -> outcome".
        finding.pre_feedback_severity = finding.severity
        finding.pre_feedback_confidence = finding.confidence

    try:
        outcome = review_agent.integrate_feedback(finding, all_texts)
    except Exception:
        logger.exception("Review Agent failed to integrate feedback for finding %s", finding.id)
        outcome = None

    now = datetime.now(timezone.utc)
    feedback.considered = outcome is not None
    feedback.considered_at = now if outcome is not None else None

    finding.feedback_count = (finding.feedback_count or 0) + 1
    finding.feedback_considered_at = now

    if outcome is not None:
        finding.feedback_verdict = outcome.verdict
        if outcome.changed:
            finding.severity = outcome.new_severity
            finding.confidence = outcome.new_confidence
    else:
        finding.feedback_verdict = (
            "Your feedback was saved, but the Review Agent could not evaluate it "
            "automatically this time. It remains available as context for the next "
            "review."
        )

    db.commit()
    db.refresh(finding)

    return {
        "feedback": serialize_feedback(feedback, user),
        "finding": serialize_finding(finding, repository, include_feedback=True),
    }


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


@router.get("/reports")
def list_reports(
    repository_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repository_ids = _user_repository_ids(user, db)
    if not repository_ids:
        return []

    query = db.query(Report).filter(Report.repository_id.in_(repository_ids))
    if repository_id:
        query = query.filter(Report.repository_id == repository_id)

    reports = query.order_by(Report.created_at.desc()).limit(limit).all()
    repositories = {
        r.id: r for r in db.query(Repository).filter(Repository.id.in_(repository_ids)).all()
    }
    analyses = {
        a.id: a
        for a in db.query(Analysis)
        .filter(Analysis.id.in_([r.analysis_id for r in reports]))
        .all()
    }

    return [
        serialize_report(
            report, repositories.get(report.repository_id), analyses.get(report.analysis_id)
        )
        for report in reports
    ]


@router.get("/reports/{report_id}")
def get_report(
    report_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found.")

    repository = db.get(Repository, report.repository_id)
    if repository is None or repository.user_id != user.id:
        raise HTTPException(status_code=404, detail="Report not found.")

    analysis = db.get(Analysis, report.analysis_id)
    findings = (
        db.query(Finding)
        .filter(Finding.analysis_id == report.analysis_id)
        .order_by(Finding.review_priority)
        .all()
    )

    return {
        "report": serialize_report(report, repository, analysis),
        "findings": [serialize_finding(f, repository) for f in findings],
        "analysis": serialize_analysis(analysis, repository, include_stages=True)
        if analysis
        else None,
    }

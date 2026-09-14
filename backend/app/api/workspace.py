from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import settings as app_settings
from app.db.session import get_db
from app.models import Analysis, Finding, Report, Repository, Source, User, UserPreference
from app.schemas import (
    PreferencesUpdateRequest,
    serialize_analysis,
    serialize_finding,
    serialize_preferences,
    serialize_report,
    serialize_repository,
    serialize_source,
)

router = APIRouter(prefix="/api", tags=["workspace"])


@router.get("/dashboard")
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    repositories = (
        db.query(Repository)
        .filter(Repository.user_id == user.id)
        .order_by(Repository.created_at.desc())
        .all()
    )
    repository_ids = [r.id for r in repositories]

    if not repository_ids:
        return {
            "stats": {
                "repository_count": 0,
                "analyses_in_progress": 0,
                "critical_findings": 0,
                "open_findings": 0,
                "resolved_findings": 0,
                "false_positive_findings": 0,
                "review_later_findings": 0,
                "total_findings": 0,
                "average_health": None,
                "analyses_completed": 0,
            },
            "repository_health": [],
            "recent_insights": [],
            "recent_runs": [],
            "severity_breakdown": {"critical": 0, "high": 0, "medium": 0, "low": 0},
            "domain_breakdown": {},
        }

    analyses = (
        db.query(Analysis)
        .filter(Analysis.repository_id.in_(repository_ids))
        .order_by(Analysis.created_at.desc())
        .all()
    )

    latest_completed_ids = []
    seen: set[str] = set()
    for analysis in analyses:
        if analysis.status == "completed" and analysis.repository_id not in seen:
            seen.add(analysis.repository_id)
            latest_completed_ids.append(analysis.id)

    findings = (
        db.query(Finding)
        .filter(Finding.analysis_id.in_(latest_completed_ids))
        .all()
        if latest_completed_ids
        else []
    )

    status_counts = Counter(f.status for f in findings)
    open_findings = [f for f in findings if f.status == "open"]
    severity_counts = Counter(f.severity for f in open_findings)
    domain_counts = Counter(f.domain for f in open_findings)

    in_progress = [a for a in analyses if a.status in ("pending", "running", "reviewing")]
    scored = [r for r in repositories if r.health_score is not None]

    repositories_by_id = {r.id: r for r in repositories}

    recent_insights = sorted(
        open_findings,
        key=lambda f: ({"critical": 4, "high": 3, "medium": 2, "low": 1}.get(f.severity, 0), f.confidence),
        reverse=True,
    )[:6]

    return {
        "stats": {
            "repository_count": len(repositories),
            "analyses_in_progress": len(in_progress),
            "critical_findings": severity_counts.get("critical", 0),
            "open_findings": len(open_findings),
            "resolved_findings": status_counts.get("resolved", 0),
            "false_positive_findings": status_counts.get("false_positive", 0),
            "review_later_findings": status_counts.get("review_later", 0),
            "total_findings": len(findings),
            "average_health": (
                round(sum(r.health_score for r in scored) / len(scored)) if scored else None
            ),
            "analyses_completed": len([a for a in analyses if a.status == "completed"]),
        },
        "repository_health": [
            {
                "id": r.id,
                "name": r.name,
                "language": r.language,
                "health_score": r.health_score,
                "last_analyzed_at": serialize_repository(r)["last_analyzed_at"],
                "open_findings": len(
                    [f for f in open_findings if f.repository_id == r.id]
                ),
                "critical_findings": len(
                    [
                        f
                        for f in open_findings
                        if f.repository_id == r.id and f.severity == "critical"
                    ]
                ),
            }
            for r in repositories
        ],
        "recent_insights": [
            serialize_finding(f, repositories_by_id.get(f.repository_id))
            for f in recent_insights
        ],
        "recent_runs": [
            serialize_analysis(a, repositories_by_id.get(a.repository_id), include_stages=True)
            for a in analyses[:6]
        ],
        "severity_breakdown": {
            s: severity_counts.get(s, 0) for s in ("critical", "high", "medium", "low")
        },
        "domain_breakdown": dict(domain_counts),
    }


@router.get("/knowledge")
def knowledge(
    category: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(Source)
    if category:
        query = query.filter(Source.category == category)

    sources = query.order_by(Source.order_index, Source.name).all()
    categories = [
        row[0]
        for row in db.query(Source.category).distinct().order_by(Source.category).all()
        if row[0]
    ]

    return {
        "sources": [serialize_source(s) for s in sources],
        "categories": categories,
    }


@router.get("/settings")
def get_settings_endpoint(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if user.preference is None:
        db.add(UserPreference(user_id=user.id))
        db.commit()
        db.refresh(user)

    return {
        "preferences": serialize_preferences(user.preference),
        "system": {
            "llm_enabled": app_settings.llm_enabled,
            "llm_model": app_settings.anthropic_model if app_settings.llm_enabled else None,
            "analysis_engine": "Claude API" if app_settings.llm_enabled else "Local analyzers",
            "database": "PostgreSQL"
            if app_settings.database_url.startswith("postgres")
            else "SQLite",
            "max_files_per_analysis": app_settings.max_files_per_analysis,
            "secrets_source": ".env (environment variables)",
        },
    }


@router.patch("/settings")
def update_settings(
    payload: PreferencesUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.preference is None:
        db.add(UserPreference(user_id=user.id))
        db.commit()
        db.refresh(user)

    preference = user.preference
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(preference, field, value)

    db.commit()
    return {"preferences": serialize_preferences(preference)}

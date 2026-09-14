from __future__ import annotations

import threading
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db.session import get_db
from app.github.fetcher import RepositoryError, parse_github_url
from app.models import Analysis, Finding, Repository, RepositoryFile, User
from app.orchestrator.orchestrator import run_analysis
from app.schemas import (
    RepositoryCreateRequest,
    RepositoryUpdateRequest,
    serialize_analysis,
    serialize_file_detail,
    serialize_file_summary,
    serialize_finding,
    serialize_repository,
)

router = APIRouter(prefix="/api/repositories", tags=["repositories"])


def _owned_repository(repository_id: str, user: User, db: Session) -> Repository:
    repository = db.get(Repository, repository_id)
    if repository is None or repository.user_id != user.id:
        raise HTTPException(status_code=404, detail="Repository not found.")
    return repository


def _repository_stats(db: Session, repository_ids: list[str]) -> dict[str, dict]:
    if not repository_ids:
        return {}

    stats: dict[str, dict] = {
        rid: {
            "open_findings": 0,
            "critical_findings": 0,
            "resolved_findings": 0,
            "total_findings": 0,
            "analysis_count": 0,
            "latest_analysis_id": None,
            "latest_analysis_status": None,
        }
        for rid in repository_ids
    }

    findings = (
        db.query(Finding.repository_id, Finding.severity, Finding.status)
        .filter(Finding.repository_id.in_(repository_ids))
        .all()
    )
    for repository_id, severity, finding_status in findings:
        entry = stats[repository_id]
        entry["total_findings"] += 1
        if finding_status == "resolved":
            entry["resolved_findings"] += 1
        elif finding_status == "open":
            entry["open_findings"] += 1
            if severity == "critical":
                entry["critical_findings"] += 1

    analyses = (
        db.query(Analysis)
        .filter(Analysis.repository_id.in_(repository_ids))
        .order_by(Analysis.created_at.desc())
        .all()
    )
    for analysis in analyses:
        entry = stats[analysis.repository_id]
        entry["analysis_count"] += 1
        if entry["latest_analysis_id"] is None:
            entry["latest_analysis_id"] = analysis.id
            entry["latest_analysis_status"] = analysis.status

    return stats


@router.get("")
def list_repositories(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    repositories = (
        db.query(Repository)
        .filter(Repository.user_id == user.id)
        .order_by(Repository.created_at.desc())
        .all()
    )
    stats = _repository_stats(db, [r.id for r in repositories])
    return [serialize_repository(r, stats.get(r.id)) for r in repositories]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_repository(
    payload: RepositoryCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        owner, name = parse_github_url(payload.github_url)
    except RepositoryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    normalized_url = f"https://github.com/{owner}/{name}"

    existing = (
        db.query(Repository)
        .filter(Repository.user_id == user.id, Repository.github_url == normalized_url)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"'{existing.name}' is already in your workspace.",
        )

    repository = Repository(
        user_id=user.id,
        name=payload.name.strip() if payload.name else name,
        owner=owner,
        github_url=normalized_url,
        description=payload.description,
        branch=(payload.branch or "").strip() or None,
        is_demo=False,
    )
    db.add(repository)
    db.commit()

    return serialize_repository(repository, _repository_stats(db, [repository.id]).get(repository.id))


@router.get("/{repository_id}")
def get_repository(
    repository_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repository = _owned_repository(repository_id, user, db)
    stats = _repository_stats(db, [repository.id]).get(repository.id)

    analyses = (
        db.query(Analysis)
        .filter(Analysis.repository_id == repository.id)
        .order_by(Analysis.created_at.desc())
        .limit(20)
        .all()
    )

    return {
        "repository": serialize_repository(repository, stats),
        "analyses": [serialize_analysis(a, repository) for a in analyses],
    }


@router.patch("/{repository_id}")
def update_repository(
    repository_id: str,
    payload: RepositoryUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repository = _owned_repository(repository_id, user, db)

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Repository name cannot be empty.")
        repository.name = name
    if payload.description is not None:
        repository.description = payload.description.strip() or None
    if payload.branch is not None:
        repository.branch = payload.branch.strip() or None
    if payload.language is not None:
        repository.language = payload.language.strip() or None

    db.commit()
    stats = _repository_stats(db, [repository.id]).get(repository.id)
    return serialize_repository(repository, stats)


@router.delete("/{repository_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_repository(
    repository_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repository = _owned_repository(repository_id, user, db)
    db.query(Finding).filter(Finding.repository_id == repository.id).delete(
        synchronize_session=False
    )
    db.delete(repository)
    db.commit()


@router.post("/{repository_id}/analyze", status_code=status.HTTP_202_ACCEPTED)
def start_analysis(
    repository_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repository = _owned_repository(repository_id, user, db)

    active = (
        db.query(Analysis)
        .filter(
            Analysis.repository_id == repository.id,
            Analysis.status.in_(("pending", "running", "reviewing")),
        )
        .first()
    )
    if active:
        raise HTTPException(
            status_code=409,
            detail="An analysis is already running for this repository.",
        )

    analysis = Analysis(repository_id=repository.id, status="pending")
    db.add(analysis)
    db.commit()

    thread = threading.Thread(
        target=run_analysis, args=(analysis.id,), daemon=True, name=f"analysis-{analysis.id[:8]}"
    )
    thread.start()

    return serialize_analysis(analysis, repository, include_stages=True)


@router.get("/{repository_id}/files")
def list_repository_files(
    repository_id: str,
    analysis_id: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repository = _owned_repository(repository_id, user, db)

    files = (
        db.query(RepositoryFile)
        .filter(RepositoryFile.repository_id == repository.id)
        .order_by(RepositoryFile.path)
        .all()
    )

    finding_query = db.query(Finding).filter(Finding.repository_id == repository.id)
    if analysis_id:
        finding_query = finding_query.filter(Finding.analysis_id == analysis_id)
    else:
        latest = (
            db.query(Analysis)
            .filter(Analysis.repository_id == repository.id, Analysis.status == "completed")
            .order_by(Analysis.created_at.desc())
            .first()
        )
        if latest:
            finding_query = finding_query.filter(Finding.analysis_id == latest.id)

    counts: dict[str, Counter] = {}
    for finding in finding_query.all():
        if not finding.file_path:
            continue
        counts.setdefault(finding.file_path, Counter())
        counts[finding.file_path][finding.severity] += 1
        counts[finding.file_path]["total"] += 1
        if finding.status == "open":
            counts[finding.file_path]["open"] += 1

    return [
        serialize_file_summary(f, dict(counts.get(f.path, Counter())))
        for f in files
    ]


@router.get("/{repository_id}/files/{file_id}")
def get_repository_file(
    repository_id: str,
    file_id: str,
    analysis_id: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repository = _owned_repository(repository_id, user, db)

    file = db.get(RepositoryFile, file_id)
    if file is None or file.repository_id != repository.id:
        raise HTTPException(status_code=404, detail="File not found.")

    query = db.query(Finding).filter(
        Finding.repository_id == repository.id, Finding.file_path == file.path
    )
    if analysis_id:
        query = query.filter(Finding.analysis_id == analysis_id)
    else:
        latest = (
            db.query(Analysis)
            .filter(Analysis.repository_id == repository.id, Analysis.status == "completed")
            .order_by(Analysis.created_at.desc())
            .first()
        )
        if latest:
            query = query.filter(Finding.analysis_id == latest.id)

    findings = query.order_by(Finding.line_number).all()
    return serialize_file_detail(file, findings)

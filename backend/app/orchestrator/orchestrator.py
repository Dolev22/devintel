"""The Orchestrator.

Coordinates the Multi-Agent workflow. It does not analyse code itself: it
prepares the repository context, runs the specialised agents concurrently,
hands their findings to the Review Agent, persists everything, and tracks status.

Failure policy (from the architecture plan):
  * repository problems fail fast, before any agent runs
  * one failing specialised agent does NOT fail the analysis
  * if the Review Agent fails, raw findings are still persisted
"""

from __future__ import annotations

import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.agents import code_analysis_agent, review_agent, security_agent
from app.agents.base import AnalysisContext
from app.config import settings
from app.db.session import SessionLocal
from app.github import demo_repos
from app.github.fetcher import FetchedFile, FetchedRepository, RepositoryError, clone_repository
from app.github.prescan import run_prescan
from app.models import (
    STAGE_LABELS,
    STAGE_ORDER,
    AgentRun,
    Analysis,
    Finding,
    Report,
    Repository,
    RepositoryFile,
)

logger = logging.getLogger(__name__)

# Deliberate pacing so the Analysis Run screen shows the pipeline progressing
# stage by stage. Set STAGE_PACING_SECONDS=0 to run at full speed.
STAGE_PACING_SECONDS = float(os.getenv("STAGE_PACING_SECONDS", "0.9"))


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _ms_since(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


class StageTracker:
    """Creates and updates the five pipeline stage rows for an analysis."""

    def __init__(self, db: Session, analysis_id: str) -> None:
        self.db = db
        self.analysis_id = analysis_id
        self.runs: dict[str, AgentRun] = {}

    def create_all(self) -> None:
        for index, key in enumerate(STAGE_ORDER):
            run = AgentRun(
                analysis_id=self.analysis_id,
                agent_type=key,
                label=STAGE_LABELS[key],
                order_index=index,
                status="pending",
            )
            self.db.add(run)
            self.runs[key] = run
        self.db.commit()

    def start(self, key: str, input_summary: str) -> float:
        run = self.runs[key]
        run.status = "running"
        run.input_summary = input_summary
        run.started_at = _utcnow()
        self.db.commit()
        return time.perf_counter()

    def complete(self, key: str, started: float, output_summary: str, findings_count: int = 0) -> None:
        run = self.runs[key]
        run.status = "completed"
        run.output_summary = output_summary
        run.findings_count = findings_count
        run.completed_at = _utcnow()
        run.duration_ms = _ms_since(started)
        self.db.commit()

    def fail(self, key: str, started: float | None, message: str) -> None:
        run = self.runs[key]
        run.status = "failed"
        run.error_message = message[:1000]
        run.completed_at = _utcnow()
        if started is not None:
            run.duration_ms = _ms_since(started)
        self.db.commit()

    def skip(self, key: str, message: str) -> None:
        run = self.runs[key]
        run.status = "skipped"
        run.output_summary = message
        run.completed_at = _utcnow()
        self.db.commit()


def _load_demo_repository(repository: Repository) -> FetchedRepository:
    fixture = next(
        (r for r in demo_repos.DEMO_REPOSITORIES if r["name"] == repository.name), None
    )
    if fixture is None:
        raise RepositoryError(
            "This demo repository is no longer available in the local fixtures."
        )

    fetched = FetchedRepository(
        owner=fixture["owner"],
        name=fixture["name"],
        github_url=fixture["github_url"],
        branch=fixture["branch"],
    )

    for entry in fixture["files"]:
        content = entry["content"]
        if entry["language"] == "markdown":
            fetched.readme = content
            continue
        fetched.files.append(
            FetchedFile(
                path=entry["path"],
                language=entry["language"],
                content=content,
                line_count=content.count("\n") + 1,
                size_bytes=len(content.encode()),
                is_test=entry["path"].startswith("tests/")
                or "test_" in entry["path"]
                or ".test." in entry["path"],
            )
        )

    return fetched


def _persist_files(db: Session, repository: Repository, fetched: FetchedRepository) -> None:
    db.query(RepositoryFile).filter(
        RepositoryFile.repository_id == repository.id
    ).delete(synchronize_session=False)

    for file in fetched.files:
        db.add(
            RepositoryFile(
                repository_id=repository.id,
                path=file.path,
                language=file.language,
                content=file.content,
                line_count=file.line_count,
                size_bytes=file.size_bytes,
                is_test=file.is_test,
                priority_score=getattr(file, "priority_score", 0.0) or 0.0,
            )
        )

    repository.file_count = len(fetched.files)
    repository.loc_count = sum(f.line_count for f in fetched.files)
    db.commit()


def run_analysis(analysis_id: str) -> None:
    """Entry point executed on a worker thread."""

    db = SessionLocal()
    overall_start = time.perf_counter()

    try:
        analysis = db.get(Analysis, analysis_id)
        if analysis is None:
            logger.error("analysis %s disappeared before it started", analysis_id)
            return

        repository = db.get(Repository, analysis.repository_id)
        if repository is None:
            _fail_analysis(db, analysis, "The repository record no longer exists.")
            return

        analysis.status = "running"
        analysis.started_at = _utcnow()
        analysis.current_stage = "preparation"
        db.commit()

        stages = StageTracker(db, analysis.id)
        stages.create_all()

        # ------------------------------------------------------------------
        # Stage 1 — Repository Preparation
        # ------------------------------------------------------------------
        started = stages.start(
            "preparation",
            f"{repository.github_url} (branch: {repository.branch or 'default'})",
        )
        _pace()

        try:
            if repository.is_demo:
                fetched = _load_demo_repository(repository)
            else:
                fetched = clone_repository(repository.github_url, repository.branch)
        except RepositoryError as exc:
            stages.fail("preparation", started, str(exc))
            for key in ("code_analysis", "security", "review", "report"):
                stages.skip(key, "Skipped: the repository could not be prepared.")
            _fail_analysis(db, analysis, str(exc))
            return

        prescan = run_prescan(fetched, settings.max_files_per_analysis)
        _persist_files(db, repository, fetched)

        repository.language = (prescan.primary_language or repository.language or "").title() or None
        repository.branch = fetched.branch or repository.branch
        db.commit()

        context = AnalysisContext(
            repository_name=repository.name,
            github_url=repository.github_url,
            primary_language=prescan.primary_language,
            files=prescan.selected_files,
            readme=fetched.readme,
            dependency_manifest=fetched.dependency_manifest,
            test_file_paths=prescan.test_file_paths,
            secret_hits=prescan.secret_hits,
        )

        analysis.files_analyzed = len(prescan.selected_files)
        analysis.loc_analyzed = prescan.total_loc
        db.commit()

        stages.complete(
            "preparation",
            started,
            (
                f"Prepared {len(prescan.selected_files)} files "
                f"({prescan.total_loc} lines) for analysis. "
                f"Language: {prescan.primary_language or 'mixed'}. "
                f"Tests found: {prescan.test_file_count}. "
                f"Pre-scan secret hits: {len(prescan.secret_hits)}."
            ),
        )

        # ------------------------------------------------------------------
        # Stages 2 & 3 — specialised agents, run concurrently
        # ------------------------------------------------------------------
        analysis.current_stage = "code_analysis"
        db.commit()

        code_started = stages.start(
            "code_analysis", f"{len(context.files)} files, {context.primary_language or 'mixed'}"
        )
        security_started = stages.start(
            "security",
            f"{len(context.files)} files, {len(prescan.secret_hits)} pre-scan secret hits",
        )
        _pace()

        with ThreadPoolExecutor(max_workers=2) as pool:
            code_future = pool.submit(_safe_agent, code_analysis_agent.run, context)
            security_future = pool.submit(_safe_agent, security_agent.run, context)

            code_findings, code_engine, code_error = code_future.result()
            security_findings, security_engine, security_error = security_future.result()

        if code_error:
            stages.fail("code_analysis", code_started, code_error)
        else:
            stages.complete(
                "code_analysis",
                code_started,
                (
                    f"Raised {len(code_findings)} raw findings across bug and "
                    f"code-quality rules ({code_engine} engine)."
                ),
                len(code_findings),
            )

        analysis.current_stage = "security"
        db.commit()

        if security_error:
            stages.fail("security", security_started, security_error)
        else:
            stages.complete(
                "security",
                security_started,
                (
                    f"Raised {len(security_findings)} raw security findings "
                    f"({security_engine} engine)."
                ),
                len(security_findings),
            )

        if code_error and security_error:
            for key in ("review", "report"):
                stages.skip(key, "Skipped: both analysis agents failed.")
            _fail_analysis(
                db,
                analysis,
                "Both specialised agents failed. "
                f"Code Analysis: {code_error} | Security: {security_error}",
            )
            return

        raw_findings = list(code_findings) + list(security_findings)

        # ------------------------------------------------------------------
        # Stage 4 — Review / Developer Intelligence Agent
        # ------------------------------------------------------------------
        analysis.status = "reviewing"
        analysis.current_stage = "review"
        db.commit()

        review_started = stages.start(
            "review", f"{len(raw_findings)} raw findings from 2 agents"
        )
        _pace()

        partial_notice = None
        if code_error:
            partial_notice = (
                "Code Analysis Agent failed for this run, so bug and code-quality "
                "coverage is incomplete."
            )
        elif security_error:
            partial_notice = (
                "Security Agent failed for this run, so security coverage is "
                "incomplete."
            )

        try:
            result = review_agent.run(context, raw_findings)
            stages.complete(
                "review",
                review_started,
                (
                    f"Consolidated {len(raw_findings)} raw findings into "
                    f"{len(result.findings)} ({result.merged_count} merged, "
                    f"{result.adjusted_count} severity/confidence adjustments). "
                    f"Health score: {result.health_score}/100."
                ),
                len(result.findings),
            )
        except Exception as exc:
            logger.exception("review agent failed")
            stages.fail("review", review_started, str(exc))
            result = _degraded_review(raw_findings)

        engine = "llm" if "llm" in (code_engine, security_engine, result.engine) else "heuristic"
        analysis.engine = engine

        _persist_findings(db, analysis, repository, result.findings)

        # ------------------------------------------------------------------
        # Stage 5 — Final Report
        # ------------------------------------------------------------------
        analysis.current_stage = "report"
        db.commit()

        report_started = stages.start("report", f"{len(result.findings)} reviewed findings")
        _pace()

        summary = result.summary
        if partial_notice:
            summary = f"{summary}\n\nNote: {partial_notice}"

        metadata = {
            "engine": engine,
            "files_analyzed": len(context.files),
            "loc_analyzed": prescan.total_loc,
            "files_skipped": prescan.skipped_file_count,
            "language_breakdown": prescan.language_breakdown,
            "test_files_found": prescan.test_file_count,
            "has_readme": prescan.has_readme,
            "has_dependency_manifest": prescan.has_dependency_manifest,
            "prescan_secret_hits": len(prescan.secret_hits),
            "raw_findings": len(raw_findings),
            "merged_findings": result.merged_count,
            "adjusted_findings": result.adjusted_count,
            "agents_succeeded": [
                name
                for name, failed in (
                    ("code_analysis", code_error),
                    ("security", security_error),
                )
                if not failed
            ],
            "agents_failed": [
                name
                for name, failed in (
                    ("code_analysis", code_error),
                    ("security", security_error),
                )
                if failed
            ],
            "domain_breakdown": result.domain_breakdown,
        }

        report = Report(
            analysis_id=analysis.id,
            repository_id=repository.id,
            title=f"Developer Intelligence Report — {repository.name}",
            summary=summary,
            recommendations=json.dumps(result.recommendations),
            top_issues=json.dumps([f.rule_id for f in result.findings[:5]]),
            category_breakdown=json.dumps(result.category_breakdown),
            severity_breakdown=json.dumps(result.severity_breakdown),
            metadata_json=json.dumps(metadata),
            health_score=result.health_score,
            total_findings=len(result.findings),
        )
        db.add(report)

        stages.complete(
            "report",
            report_started,
            f"Report generated with {len(result.recommendations)} prioritised recommendations.",
        )

        analysis.status = "completed"
        analysis.current_stage = None
        analysis.completed_at = _utcnow()
        analysis.duration_ms = _ms_since(overall_start)
        analysis.summary = summary[:2000]

        repository.health_score = result.health_score
        repository.last_analyzed_at = analysis.completed_at

        db.commit()
        logger.info(
            "analysis %s completed: %s findings, health %s",
            analysis.id,
            len(result.findings),
            result.health_score,
        )

    except Exception as exc:  # last-resort guard so a run never hangs in `running`
        logger.exception("analysis %s crashed", analysis_id)
        try:
            analysis = db.get(Analysis, analysis_id)
            if analysis and analysis.status not in ("completed", "failed"):
                _fail_analysis(db, analysis, f"Unexpected error: {exc}")
        except Exception:
            logger.exception("could not mark analysis %s as failed", analysis_id)
    finally:
        db.close()


def _pace() -> None:
    if STAGE_PACING_SECONDS > 0:
        time.sleep(STAGE_PACING_SECONDS)


def _safe_agent(runner, context) -> tuple[list, str, str | None]:
    """Run an agent inside an error boundary so one failure cannot end the run."""
    try:
        findings, engine = runner(context)
        return findings, engine, None
    except Exception as exc:
        logger.exception("agent %s failed", getattr(runner, "__module__", "unknown"))
        return [], "heuristic", str(exc)


def _degraded_review(raw_findings):
    """Fallback when the Review Agent itself fails: keep the raw agent output."""
    from app.agents.review_agent import ReviewResult, _health_score

    for finding in raw_findings:
        finding.reviewed = False
        finding.review_verdict = (
            "The Review Agent failed for this run, so this finding is shown exactly "
            "as the detecting agent reported it, without consolidation."
        )
        finding.group_key = finding.category

    ordered = sorted(
        raw_findings,
        key=lambda f: ({"critical": 4, "high": 3, "medium": 2, "low": 1}.get(f.severity, 0), f.confidence),
        reverse=True,
    )
    for position, finding in enumerate(ordered, start=1):
        finding.review_priority = position

    from collections import Counter

    severity_counts = Counter(f.severity for f in ordered)
    return ReviewResult(
        findings=ordered,
        summary=(
            "The Review Agent could not be completed for this run. The findings below "
            "are the raw output of the specialised agents: they have not been "
            "deduplicated, re-prioritised or severity-validated. Treat them as a "
            "starting point and re-run the analysis to get a reviewed report."
        ),
        recommendations=[
            "Re-run this analysis to produce a fully reviewed report.",
            "Until then, verify each finding manually before acting on it.",
        ],
        health_score=_health_score(ordered),
        severity_breakdown={s: severity_counts.get(s, 0) for s in ("critical", "high", "medium", "low")},
        category_breakdown=dict(Counter(f.category for f in ordered).most_common()),
        domain_breakdown=dict(Counter(f.domain for f in ordered)),
    )


def _persist_findings(db: Session, analysis: Analysis, repository: Repository, findings) -> None:
    for finding in findings:
        db.add(
            Finding(
                analysis_id=analysis.id,
                repository_id=repository.id,
                agent_type=finding.agent_type,
                rule_id=finding.rule_id,
                title=finding.title,
                description=finding.description,
                explanation=finding.explanation,
                why_it_matters=finding.why_it_matters,
                recommendation=finding.recommendation,
                suggested_fix=finding.suggested_fix,
                severity=finding.severity,
                category=finding.category,
                domain=finding.domain,
                confidence=finding.confidence,
                file_path=finding.file_path,
                line_number=finding.line_number,
                code_start_line=finding.code_start_line,
                code_end_line=finding.code_end_line,
                related_file_path=finding.related_file_path,
                related_line_number=finding.related_line_number,
                status="open",
                reviewed=bool(getattr(finding, "reviewed", False)),
                review_verdict=getattr(finding, "review_verdict", None),
                review_priority=getattr(finding, "review_priority", None),
                original_severity=getattr(finding, "original_severity", None),
                original_confidence=getattr(finding, "original_confidence", None),
                merged_count=getattr(finding, "merged_count", 1) or 1,
                corroborated_by=getattr(finding, "corroborated_by", None),
                group_key=getattr(finding, "group_key", None) or finding.category,
            )
        )
    db.commit()


def _fail_analysis(db: Session, analysis: Analysis, message: str) -> None:
    analysis.status = "failed"
    analysis.current_stage = None
    analysis.error_message = message[:2000]
    analysis.summary = message[:2000]
    analysis.completed_at = _utcnow()
    db.commit()

"""SQLAlchemy models for the AI Developer Intelligence system.

Entity map (matches the approved architecture plan):

    User 1--N Repository 1--N Analysis 1--N Finding
                                       1--N AgentRun
                                       1--1 Report
    Repository 1--N RepositoryFile     (snapshot of analyzed code, powers Code Review UI)
    Source                             (standalone knowledge reference table)
    UserPreference 1--1 User           (theme / direction / analysis preferences)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# Controlled vocabularies (kept as plain constants so SQLite stays portable)
# --------------------------------------------------------------------------

SEVERITIES = ("critical", "high", "medium", "low")
FINDING_STATUSES = ("open", "resolved", "false_positive", "review_later")
ANALYSIS_STATUSES = ("pending", "running", "reviewing", "completed", "failed")
STAGE_STATUSES = ("pending", "running", "completed", "failed", "skipped")

# The five pipeline stages recorded in agent_runs. `preparation` and `report`
# are not LLM agents; they are recorded in the same table so the Analysis Run
# screen can render the full Multi-Agent pipeline from one query.
STAGE_ORDER = ("preparation", "code_analysis", "security", "review", "report")
STAGE_LABELS = {
    "preparation": "Repository Preparation",
    "code_analysis": "Code Analysis Agent",
    "security": "Security Agent",
    "review": "Review / Developer Intelligence Agent",
    "report": "Final Report",
}


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=new_id)
    name = Column(String(120), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    repositories = relationship(
        "Repository", back_populates="user", cascade="all, delete-orphan"
    )
    preference = relationship(
        "UserPreference",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id = Column(String(36), primary_key=True, default=new_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, unique=True)

    theme = Column(String(16), default="dark", nullable=False)          # dark | light
    direction = Column(String(4), default="ltr", nullable=False)        # ltr | rtl
    language = Column(String(8), default="en", nullable=False)

    # Analysis preferences
    run_code_analysis = Column(Boolean, default=True, nullable=False)
    run_security = Column(Boolean, default=True, nullable=False)
    min_severity = Column(String(16), default="low", nullable=False)
    min_confidence = Column(Float, default=0.3, nullable=False)
    max_files_per_analysis = Column(Integer, default=40, nullable=False)

    # Notification preferences
    notify_on_complete = Column(Boolean, default=True, nullable=False)
    notify_on_critical = Column(Boolean, default=True, nullable=False)
    notify_weekly_digest = Column(Boolean, default=False, nullable=False)

    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user = relationship("User", back_populates="preference")


class Repository(Base):
    __tablename__ = "repositories"

    id = Column(String(36), primary_key=True, default=new_id)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    owner = Column(String(255), nullable=True)
    github_url = Column(String(512), nullable=False)
    description = Column(Text, nullable=True)
    language = Column(String(64), nullable=True)
    # Null means "whatever the repository's default branch is". It is filled in
    # with the resolved branch name after the first successful clone.
    branch = Column(String(128), nullable=True)

    is_demo = Column(Boolean, default=False, nullable=False)
    health_score = Column(Integer, nullable=True)          # 0-100, set by Review Agent
    file_count = Column(Integer, default=0, nullable=False)
    loc_count = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_analyzed_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="repositories")
    files = relationship(
        "RepositoryFile", back_populates="repository", cascade="all, delete-orphan"
    )
    analyses = relationship(
        "Analysis",
        back_populates="repository",
        cascade="all, delete-orphan",
        order_by="Analysis.created_at.desc()",
    )


class RepositoryFile(Base):
    """Snapshot of a source file that was analyzed.

    Persisted so the Code Review screen can render the exact code the agents
    saw, with findings anchored to real line numbers.
    """

    __tablename__ = "repository_files"
    __table_args__ = (UniqueConstraint("repository_id", "path", name="uq_repo_path"),)

    id = Column(String(36), primary_key=True, default=new_id)
    repository_id = Column(
        String(36), ForeignKey("repositories.id"), nullable=False, index=True
    )

    path = Column(String(1024), nullable=False)
    language = Column(String(32), nullable=True)
    content = Column(Text, nullable=False)
    line_count = Column(Integer, default=0, nullable=False)
    size_bytes = Column(Integer, default=0, nullable=False)
    is_test = Column(Boolean, default=False, nullable=False)
    priority_score = Column(Float, default=0.0, nullable=False)

    repository = relationship("Repository", back_populates="files")


class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(String(36), primary_key=True, default=new_id)
    repository_id = Column(
        String(36), ForeignKey("repositories.id"), nullable=False, index=True
    )

    status = Column(String(16), default="pending", nullable=False, index=True)
    current_stage = Column(String(32), nullable=True)

    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    summary = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)

    files_analyzed = Column(Integer, default=0, nullable=False)
    loc_analyzed = Column(Integer, default=0, nullable=False)
    duration_ms = Column(Integer, nullable=True)

    # How the agents were executed for this run: "llm" (Claude API) or
    # "heuristic" (deterministic local analyzers used when no API key is set).
    engine = Column(String(16), default="heuristic", nullable=False)

    repository = relationship("Repository", back_populates="analyses")
    findings = relationship(
        "Finding", back_populates="analysis", cascade="all, delete-orphan"
    )
    agent_runs = relationship(
        "AgentRun",
        back_populates="analysis",
        cascade="all, delete-orphan",
        order_by="AgentRun.order_index",
    )
    report = relationship(
        "Report",
        back_populates="analysis",
        uselist=False,
        cascade="all, delete-orphan",
    )


class AgentRun(Base):
    """One pipeline stage of an analysis (see STAGE_ORDER)."""

    __tablename__ = "agent_runs"

    id = Column(String(36), primary_key=True, default=new_id)
    analysis_id = Column(
        String(36), ForeignKey("analyses.id"), nullable=False, index=True
    )

    agent_type = Column(String(32), nullable=False)
    label = Column(String(128), nullable=False)
    order_index = Column(Integer, default=0, nullable=False)

    status = Column(String(16), default="pending", nullable=False)
    input_summary = Column(Text, nullable=True)
    output_summary = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)

    findings_count = Column(Integer, default=0, nullable=False)
    duration_ms = Column(Integer, nullable=True)

    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    analysis = relationship("Analysis", back_populates="agent_runs")


class Finding(Base):
    __tablename__ = "findings"

    id = Column(String(36), primary_key=True, default=new_id)
    analysis_id = Column(
        String(36), ForeignKey("analyses.id"), nullable=False, index=True
    )
    repository_id = Column(
        String(36), ForeignKey("repositories.id"), nullable=False, index=True
    )

    agent_type = Column(String(32), nullable=False)     # code_analysis | security | review
    rule_id = Column(String(64), nullable=True)

    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    explanation = Column(Text, nullable=True)           # full "what is happening"
    why_it_matters = Column(Text, nullable=True)        # impact framing
    recommendation = Column(Text, nullable=False)
    suggested_fix = Column(Text, nullable=True)         # code snippet of the fix

    severity = Column(String(16), nullable=False, index=True)
    category = Column(String(64), nullable=False, index=True)
    domain = Column(String(32), nullable=False)         # bug | quality | security
    confidence = Column(Float, default=0.5, nullable=False)

    file_path = Column(String(1024), nullable=True)
    line_number = Column(Integer, nullable=True)
    code_start_line = Column(Integer, nullable=True)
    code_end_line = Column(Integer, nullable=True)

    # Secondary location, used by duplicate-code findings
    related_file_path = Column(String(1024), nullable=True)
    related_line_number = Column(Integer, nullable=True)

    status = Column(String(24), default="open", nullable=False, index=True)
    status_note = Column(Text, nullable=True)
    status_changed_at = Column(DateTime(timezone=True), nullable=True)

    # Review / Developer Intelligence Agent output
    reviewed = Column(Boolean, default=False, nullable=False)
    review_verdict = Column(Text, nullable=True)
    review_priority = Column(Integer, nullable=True)     # 1 = most important
    original_severity = Column(String(16), nullable=True)
    original_confidence = Column(Float, nullable=True)
    merged_count = Column(Integer, default=1, nullable=False)
    corroborated_by = Column(String(64), nullable=True)  # other agent that agreed
    group_key = Column(String(128), nullable=True, index=True)

    # Developer feedback loop. `pre_feedback_severity` preserves what the agents
    # concluded on their own, so the UI can show AI finding -> feedback -> outcome.
    feedback_count = Column(Integer, default=0, nullable=False)
    feedback_verdict = Column(Text, nullable=True)
    feedback_considered_at = Column(DateTime(timezone=True), nullable=True)
    pre_feedback_severity = Column(String(16), nullable=True)
    pre_feedback_confidence = Column(Float, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    analysis = relationship("Analysis", back_populates="findings")
    feedback_entries = relationship(
        "Feedback",
        back_populates="finding",
        cascade="all, delete-orphan",
        order_by="Feedback.created_at",
    )


class Feedback(Base):
    """Free-text developer feedback on one Finding.

    This is the input side of the feedback loop: it is written here by the
    developer and read back by the Review / Developer Intelligence Agent as
    high-priority context the next time that finding is reviewed.
    """

    __tablename__ = "feedback"

    id = Column(String(36), primary_key=True, default=new_id)
    finding_id = Column(String(36), ForeignKey("findings.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)

    text = Column(Text, nullable=False)
    considered = Column(Boolean, default=False, nullable=False)
    considered_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    finding = relationship("Finding", back_populates="feedback_entries")
    user = relationship("User")


class Report(Base):
    __tablename__ = "reports"

    id = Column(String(36), primary_key=True, default=new_id)
    analysis_id = Column(
        String(36), ForeignKey("analyses.id"), nullable=False, unique=True, index=True
    )
    repository_id = Column(
        String(36), ForeignKey("repositories.id"), nullable=False, index=True
    )

    title = Column(String(255), nullable=False)
    summary = Column(Text, nullable=False)
    recommendations = Column(Text, nullable=False)       # JSON list[str]
    top_issues = Column(Text, nullable=True)             # JSON list[finding_id]
    category_breakdown = Column(Text, nullable=True)     # JSON dict
    severity_breakdown = Column(Text, nullable=True)     # JSON dict
    metadata_json = Column(Text, nullable=True)          # JSON dict

    health_score = Column(Integer, nullable=True)
    total_findings = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    analysis = relationship("Analysis", back_populates="report")


class Source(Base):
    """External knowledge source surfaced in the Knowledge section."""

    __tablename__ = "sources"

    id = Column(String(36), primary_key=True, default=new_id)
    name = Column(String(255), nullable=False)
    type = Column(String(64), nullable=False)   # security_guideline | docs | community | guide
    url = Column(String(512), nullable=True)
    description = Column(Text, nullable=True)
    category = Column(String(64), nullable=True)
    tags = Column(String(512), nullable=True)   # comma separated
    body = Column(Text, nullable=True)          # short in-app explainer
    order_index = Column(Integer, default=0, nullable=False)

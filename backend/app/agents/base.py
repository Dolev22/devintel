from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentFinding:
    """The common finding structure every agent emits."""

    rule_id: str
    title: str
    description: str
    recommendation: str
    severity: str          # critical | high | medium | low
    category: str
    domain: str            # bug | quality | security
    confidence: float      # 0.0 - 1.0
    agent_type: str        # code_analysis | security

    explanation: str | None = None
    why_it_matters: str | None = None
    suggested_fix: str | None = None

    file_path: str | None = None
    line_number: int | None = None
    code_start_line: int | None = None
    code_end_line: int | None = None

    related_file_path: str | None = None
    related_line_number: int | None = None

    # Populated by the Review / Developer Intelligence Agent.
    reviewed: bool = False
    review_verdict: str | None = None
    review_priority: int | None = None
    original_severity: str | None = None
    original_confidence: float | None = None
    merged_count: int = 1
    corroborated_by: str | None = None
    group_key: str | None = None

    def context_window(self, total_lines: int, before: int = 4, after: int = 4) -> tuple[int, int]:
        if self.line_number is None:
            return (1, min(total_lines, 20))
        start = max(1, (self.code_start_line or self.line_number) - before)
        end = min(total_lines, (self.code_end_line or self.line_number) + after)
        return start, end


@dataclass
class AnalysisContext:
    """Everything the specialised agents receive from the Orchestrator."""

    repository_name: str
    github_url: str
    primary_language: str | None
    files: list = field(default_factory=list)          # list[FetchedFile]
    readme: str | None = None
    dependency_manifest: str | None = None
    test_file_paths: list[str] = field(default_factory=list)
    secret_hits: list = field(default_factory=list)    # list[SecretHit]
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def source_files(self) -> list:
        return [f for f in self.files if not f.is_test]

    @property
    def has_tests(self) -> bool:
        return bool(self.test_file_paths)


SEVERITY_WEIGHT = {"critical": 4, "high": 3, "medium": 2, "low": 1}


def severity_rank(severity: str) -> int:
    return SEVERITY_WEIGHT.get(severity, 0)


def clamp_confidence(value: float) -> float:
    return round(max(0.05, min(0.99, value)), 2)

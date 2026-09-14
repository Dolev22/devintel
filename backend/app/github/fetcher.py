"""GitHub repository retrieval.

Public repositories only for the MVP: a shallow clone over HTTPS, no token
required. The clone lives in a temporary directory and is deleted as soon as the
relevant files have been read into memory.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from app.config import settings

GITHUB_URL_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/"
    r"(?P<owner>[A-Za-z0-9_.-]+)/(?P<name>[A-Za-z0-9_.-]+?)(?:\.git)?/?$"
)

LANGUAGE_BY_EXTENSION = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "jsx",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".java": "java",
    ".rb": "ruby",
    ".go": "go",
    ".php": "php",
    ".cs": "csharp",
    ".rs": "rust",
    ".kt": "kotlin",
    ".swift": "swift",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".sql": "sql",
    ".sh": "bash",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".json": "json",
    ".md": "markdown",
}

ANALYSABLE_LANGUAGES = {
    "python",
    "javascript",
    "jsx",
    "typescript",
    "tsx",
    "java",
    "ruby",
    "go",
    "php",
    "csharp",
    "rust",
}

DEPENDENCY_FILES = {
    "requirements.txt",
    "pyproject.toml",
    "Pipfile",
    "setup.py",
    "package.json",
    "go.mod",
    "Gemfile",
    "pom.xml",
    "build.gradle",
    "composer.json",
    "Cargo.toml",
}

SKIP_DIRECTORIES = {
    ".git",
    "node_modules",
    "dist",
    "build",
    "out",
    "vendor",
    "venv",
    ".venv",
    "env",
    "__pycache__",
    ".next",
    ".nuxt",
    "coverage",
    "target",
    ".idea",
    ".vscode",
    "migrations",
    "site-packages",
}

SKIP_FILE_SUFFIXES = (
    ".min.js",
    ".min.css",
    ".lock",
    ".map",
    ".snap",
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".pdf",
    ".zip",
)

TEST_PATH_MARKERS = ("test", "spec", "__tests__")


class RepositoryError(Exception):
    """Raised when a repository cannot be retrieved or is unusable."""


@dataclass
class FetchedFile:
    path: str
    language: str
    content: str
    line_count: int
    size_bytes: int
    is_test: bool


@dataclass
class FetchedRepository:
    owner: str
    name: str
    github_url: str
    branch: str
    files: list[FetchedFile] = field(default_factory=list)
    readme: str | None = None
    dependency_manifest: str | None = None
    dependency_manifest_path: str | None = None


def parse_github_url(url: str) -> tuple[str, str]:
    match = GITHUB_URL_RE.match((url or "").strip())
    if not match:
        raise RepositoryError(
            "That does not look like a GitHub repository URL. "
            "Expected something like https://github.com/owner/repository"
        )
    return match.group("owner"), match.group("name")


def detect_language(path: Path) -> str | None:
    return LANGUAGE_BY_EXTENSION.get(path.suffix.lower())


def is_test_path(relative_path: str) -> bool:
    lowered = relative_path.lower()
    parts = lowered.split("/")
    if any(part in TEST_PATH_MARKERS for part in parts):
        return True
    filename = parts[-1]
    return (
        filename.startswith("test_")
        or filename.endswith("_test.py")
        or ".test." in filename
        or ".spec." in filename
    )


def _should_skip(relative_path: str) -> bool:
    parts = relative_path.split("/")
    if any(part in SKIP_DIRECTORIES for part in parts[:-1]):
        return True
    return relative_path.lower().endswith(SKIP_FILE_SUFFIXES)


def clone_repository(github_url: str, branch: str | None = None) -> FetchedRepository:
    """Shallow-clone a public repository and read its analysable files."""

    owner, name = parse_github_url(github_url)
    normalized_url = f"https://github.com/{owner}/{name}.git"
    temp_dir = tempfile.mkdtemp(prefix="devintel-clone-")

    try:
        command = ["git", "clone", "--depth", "1", "--quiet"]
        if branch:
            command += ["--branch", branch]
        command += [normalized_url, temp_dir]

        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=settings.clone_timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            raise RepositoryError(
                "Cloning the repository timed out. It may be too large for the MVP."
            ) from exc
        except FileNotFoundError as exc:
            raise RepositoryError("git is not available on this machine.") from exc

        if result.returncode != 0:
            stderr = (result.stderr or "").strip().lower()
            # Check the branch-specific message first: it also contains the
            # substring "not found" and would otherwise be misreported.
            if "not found in upstream origin" in stderr or "remote branch" in stderr:
                raise RepositoryError(
                    f"Branch '{branch}' does not exist in this repository. "
                    "Leave the branch empty to use the repository's default branch."
                )
            if "could not resolve host" in stderr or "network is unreachable" in stderr:
                raise RepositoryError(
                    "Could not reach GitHub. Check the network connection and retry."
                )
            if "not found" in stderr or "does not exist" in stderr:
                raise RepositoryError(
                    "Repository not found. It may be private, renamed or deleted. "
                    "The MVP supports public repositories only."
                )
            if "authentication failed" in stderr or "permission denied" in stderr:
                raise RepositoryError(
                    "Access denied. The MVP supports public repositories only."
                )
            raise RepositoryError(
                "Could not clone the repository. "
                + ((result.stderr or "").strip().splitlines() or ["Unknown git error"])[0]
            )

        repo_root = Path(temp_dir)
        resolved_branch = branch or _current_branch(repo_root) or "main"

        fetched = FetchedRepository(
            owner=owner, name=name, github_url=normalized_url, branch=resolved_branch
        )

        for file_path in sorted(repo_root.rglob("*")):
            if not file_path.is_file():
                continue

            relative = file_path.relative_to(repo_root).as_posix()
            if _should_skip(relative):
                continue

            try:
                size = file_path.stat().st_size
            except OSError:
                continue
            if size > settings.max_file_bytes:
                continue

            filename = file_path.name
            language = detect_language(file_path)

            if filename.lower().startswith("readme") and fetched.readme is None:
                fetched.readme = _read_text(file_path)[:6000]
                continue

            if filename in DEPENDENCY_FILES and fetched.dependency_manifest is None:
                fetched.dependency_manifest = _read_text(file_path)[:6000]
                fetched.dependency_manifest_path = relative
                continue

            if language not in ANALYSABLE_LANGUAGES:
                continue

            content = _read_text(file_path)
            if not content.strip():
                continue

            fetched.files.append(
                FetchedFile(
                    path=relative,
                    language=language,
                    content=content,
                    line_count=content.count("\n") + 1,
                    size_bytes=size,
                    is_test=is_test_path(relative),
                )
            )

        if not fetched.files:
            raise RepositoryError(
                "No analysable source files were found in this repository. "
                "The MVP supports Python, JavaScript/TypeScript, Java, Go, Ruby, "
                "PHP, C#, and Rust."
            )

        return fetched
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _current_branch(repo_root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode == 0:
            return result.stdout.strip() or None
    except (subprocess.SubprocessError, OSError):
        pass
    return None


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""

"""Claude API wrapper used by the specialised agents.

The API key is read from the environment only (see app/config.py). When no key
is configured the agents fall back to their deterministic local analyzers, so
the whole Multi-Agent pipeline still runs end to end.
"""

from __future__ import annotations

import json
import logging
import re

from app.config import settings

logger = logging.getLogger(__name__)

_JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


class LLMUnavailable(Exception):
    """Raised when the LLM cannot be used for this run."""


def llm_enabled() -> bool:
    return settings.llm_enabled


def _client():
    try:
        import anthropic
    except ImportError as exc:  # pragma: no cover
        raise LLMUnavailable("anthropic package is not installed") from exc

    if not settings.anthropic_api_key:
        raise LLMUnavailable("ANTHROPIC_API_KEY is not set")

    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def extract_json_array(text: str) -> list[dict]:
    """Pull a JSON array out of a model response, tolerating prose and fences."""

    candidate = text.strip()

    block = _JSON_BLOCK_RE.search(candidate)
    if block:
        candidate = block.group(1).strip()

    if not candidate.startswith("["):
        start = candidate.find("[")
        end = candidate.rfind("]")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("no JSON array found in response")
        candidate = candidate[start : end + 1]

    parsed = json.loads(candidate)
    if not isinstance(parsed, list):
        raise ValueError("expected a JSON array")
    return [item for item in parsed if isinstance(item, dict)]


def _log_usage(label: str, response) -> None:
    """Log non-secret token counts so a run's cost can be estimated afterward.

    Never logs the API key or any request/response content — token counts only.
    """
    usage = getattr(response, "usage", None)
    if usage is None:
        return
    logger.info(
        "Claude usage [%s] model=%s input_tokens=%s output_tokens=%s",
        label,
        settings.anthropic_model,
        getattr(usage, "input_tokens", "?"),
        getattr(usage, "output_tokens", "?"),
    )


def complete_json(
    system_prompt: str, user_prompt: str, max_tokens: int = 4000, label: str = "call"
) -> list[dict]:
    """Send one request to Claude and parse a JSON array from the reply.

    Retries once with a corrective instruction if the first reply does not parse.
    """

    client = _client()

    messages = [{"role": "user", "content": user_prompt}]

    for attempt in range(2):
        try:
            response = client.messages.create(
                model=settings.anthropic_model,
                max_tokens=max_tokens,
                system=system_prompt,
                messages=messages,
            )
        except Exception as exc:  # network, rate limit, auth
            raise LLMUnavailable(f"Claude request failed: {exc}") from exc

        _log_usage(label, response)

        text = "".join(
            block.text for block in response.content if getattr(block, "type", "") == "text"
        )

        try:
            return extract_json_array(text)
        except (ValueError, json.JSONDecodeError) as exc:
            if attempt == 1:
                raise LLMUnavailable(f"Claude returned unparseable JSON: {exc}") from exc
            logger.warning("LLM returned unparseable JSON, retrying with correction")
            messages = [
                {"role": "user", "content": user_prompt},
                {"role": "assistant", "content": text[:2000]},
                {
                    "role": "user",
                    "content": (
                        "That response could not be parsed. Reply with ONLY a valid "
                        "JSON array and no other text."
                    ),
                },
            ]

    raise LLMUnavailable("Claude did not return usable JSON")


def format_files_for_prompt(files, max_lines_per_file: int = 220) -> str:
    """Render files with line numbers so the model can cite exact locations."""

    chunks: list[str] = []
    for file in files:
        lines = file.content.splitlines()[:max_lines_per_file]
        numbered = "\n".join(f"{i + 1:4d} | {line}" for i, line in enumerate(lines))
        chunks.append(f"--- FILE: {file.path} ({file.language}) ---\n{numbered}")
    return "\n\n".join(chunks)

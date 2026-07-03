#!/usr/bin/env python3
"""Claude Code PostToolUse hook for deterministic and optional LLM quality review."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
PATH_KEYS = {"file_path", "path", "notebook_path"}
DEFAULT_MAX_FILE_LINES = 500
DEFAULT_TIMEOUT_MS = 15000
MAX_EMBEDDED_CONTENT_BYTES = 30 * 1024

FALLBACK_PROMPT = """You are Farrier's per-edit semantic quality judge.

Review the edited file content and return JSON only with this exact shape:
{
  "severity": "pass | advisory | serious",
  "summary": "short summary",
  "findings": [
    {
      "path": "path",
      "message": "what is wrong",
      "suggestion": "what to do instead"
    }
  ]
}

Judge only gross issues: misplaced business logic, poor cohesion, obvious language-practice problems,
or changes that appear unrelated to the edited module. Avoid nitpicks. Use "serious" only when the
change is likely to cause real maintenance or correctness harm.
"""


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {}

    return payload if isinstance(payload, dict) else {}


def load_manifest(cwd: str) -> dict[str, Any]:
    try:
        data = json.loads((Path(cwd) / ".farrier.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    return data if isinstance(data, dict) else {}


def int_from(value: Any, default: int) -> int:
    if isinstance(value, int) and value > 0:
        return value
    return default


def str_from(value: Any, default: str) -> str:
    if isinstance(value, str) and value.strip():
        return value
    return default


def iter_path_values(value: Any) -> list[str]:
    paths: list[str] = []

    if isinstance(value, dict):
        for key, item in value.items():
            if key in PATH_KEYS and isinstance(item, str):
                paths.append(item)
                continue

            if isinstance(item, (dict, list)):
                paths.extend(iter_path_values(item))

    elif isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
                paths.extend(iter_path_values(item))

    return paths


def normalize_project_path(path: str) -> str:
    normalized = path.replace("\\", "/").strip().strip("\"'")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def is_hook_path(path: str) -> bool:
    normalized = normalize_project_path(path)
    return normalized.startswith(".claude/hooks/") or "/.claude/hooks/" in normalized


def unique_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []

    for path in paths:
        normalized = normalize_project_path(path)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)

    return result


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def capped_text(text: str, limit: int = MAX_EMBEDDED_CONTENT_BYTES) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= limit:
        return text

    head = encoded[:limit].decode("utf-8", errors="ignore")
    return f"{head}\n[truncated]"


def max_file_lines(manifest: dict[str, Any]) -> int:
    quality = manifest.get("quality")
    if not isinstance(quality, dict):
        return DEFAULT_MAX_FILE_LINES

    return int_from(quality.get("maxFileLines"), DEFAULT_MAX_FILE_LINES)


def per_edit_config(manifest: dict[str, Any]) -> dict[str, Any]:
    judge = manifest.get("judge")
    if not isinstance(judge, dict):
        return {}

    per_edit = judge.get("perEdit")
    return per_edit if isinstance(per_edit, dict) else {}


def prompt_text(cwd: str, config: dict[str, Any]) -> str:
    configured = config.get("prompt")
    if isinstance(configured, str) and configured.strip():
        text = read_text(Path(cwd) / configured)
        if text is not None and text.strip():
            return text

    return FALLBACK_PROMPT


def edited_files(cwd: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return []

    files: list[dict[str, Any]] = []
    for path in unique_paths(iter_path_values(tool_input)):
        if is_hook_path(path):
            continue

        text = read_text(Path(cwd) / path)
        if text is None:
            continue

        files.append(
            {
                "path": path,
                "lineCount": len(text.splitlines()),
                "content": capped_text(text),
            }
        )

    return files


def deterministic_findings(files: list[dict[str, Any]], max_lines: int) -> list[str]:
    findings: list[str] = []

    for file in files:
        line_count = file.get("lineCount")
        path = file.get("path")

        if isinstance(path, str) and isinstance(line_count, int) and line_count > max_lines:
            findings.append(
                f"{path} is {line_count} lines, exceeding quality.maxFileLines={max_lines}. "
                "Split responsibilities or document the architectural reason for the larger file."
            )

    return findings


def build_combined_prompt(base_prompt: str, files: list[dict[str, Any]]) -> str:
    payload = {
        "event": "PostToolUse",
        "files": files,
    }

    return f"{base_prompt.strip()}\n\nInput JSON:\n{json.dumps(payload, indent=2)}\n"


def backend_command(backend: str, model: str, prompt: str) -> tuple[list[str], str | None] | None:
    if backend == "claude":
        if shutil.which("claude") is None:
            return None
        return (["claude", "-p", "--model", model], prompt)

    if backend == "codex":
        if shutil.which("codex") is None:
            return None
        return (["codex", "exec", "--model", model, prompt], None)

    return None


def run_backend(config: dict[str, Any], combined_prompt: str, cwd: str) -> dict[str, Any] | None:
    if config.get("enabled") is not True:
        return None

    backend = str_from(config.get("backend"), "claude")
    model = str_from(config.get("model"), "haiku")
    timeout_ms = int_from(config.get("timeoutMs"), DEFAULT_TIMEOUT_MS)

    command = backend_command(backend, model, combined_prompt)
    if command is None:
        return None

    args, stdin_text = command

    try:
        proc = subprocess.run(
            args,
            input=stdin_text,
            cwd=cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout_ms / 1000,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    if proc.returncode != 0:
        return None

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None

    return data if isinstance(data, dict) else None


def valid_judgement(data: dict[str, Any] | None) -> dict[str, Any] | None:
    if data is None:
        return None

    severity = data.get("severity")
    if severity not in {"pass", "advisory", "serious"}:
        return None

    summary = data.get("summary")
    if not isinstance(summary, str):
        return None

    findings = data.get("findings")
    if not isinstance(findings, list):
        return None

    return data


def judgement_context(judgement: dict[str, Any]) -> str | None:
    severity = judgement.get("severity")
    if severity == "pass":
        return None

    summary = judgement.get("summary")
    if not isinstance(summary, str):
        return None

    lines = [f"semantic quality judge ({severity}): {summary}"]

    findings = judgement.get("findings")
    if isinstance(findings, list):
        for finding in findings:
            if not isinstance(finding, dict):
                continue

            path = finding.get("path")
            message = finding.get("message")
            suggestion = finding.get("suggestion")

            if isinstance(path, str) and isinstance(message, str):
                line = f"- {path}: {message}"
                if isinstance(suggestion, str) and suggestion.strip():
                    line = f"{line} Suggestion: {suggestion}"
                lines.append(line)

    return "\n".join(lines)


def emit_posttool_context(context: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": context,
                }
            }
        )
    )


def main() -> int:
    payload = read_payload()

    if payload.get("hook_event_name") != "PostToolUse":
        return 0

    if payload.get("tool_name") not in EDIT_TOOLS:
        return 0

    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()
    manifest = load_manifest(cwd)
    files = edited_files(cwd, payload)

    contexts = deterministic_findings(files, max_file_lines(manifest))

    config = per_edit_config(manifest)
    if files and config.get("enabled") is True:
        base_prompt = prompt_text(cwd, config)
        judgement = valid_judgement(run_backend(config, build_combined_prompt(base_prompt, files), cwd))
        context = judgement_context(judgement) if judgement is not None else None
        if context is not None:
            contexts.append(context)

    if contexts:
        emit_posttool_context("\n\n".join(contexts))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

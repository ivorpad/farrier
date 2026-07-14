#!/usr/bin/env python3
"""Shared Claude and Codex Stop hook for optional full-diff semantic review."""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from typing import Any

from _hook_runtime import read_project_text, run_bounded_process


DEFAULT_TIMEOUT_MS = 30000
DEFAULT_MAX_DIFF_BYTES = 120000
DEFAULT_MAX_UNTRACKED_FILES = 50
MAX_EMBEDDED_CONTENT_BYTES = 30 * 1024
MAX_PAYLOAD_BYTES = 256 * 1024
MAX_REASON_BYTES = 16 * 1024
MAX_BACKEND_OUTPUT_BYTES = 64 * 1024
MAX_TIMEOUT_MS = 120000
MAX_UNTRACKED_FILES = 1000
MAX_DIFF_BYTES = 120000
MAX_COMBINED_PROMPT_BYTES = 64 * 1024
MAX_MANIFEST_BYTES = 256 * 1024
MAX_UNTRACKED_PATH_BYTES = 4096

REDACTION_PATTERNS = (
    (re.compile(r"-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----"), "[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"), "[REDACTED_TOKEN]"),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}"), "Bearer [REDACTED_TOKEN]"),
    (re.compile(r"(?i)\b([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})\b"), "[REDACTED_EMAIL]"),
    (re.compile(r"(?i)\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+"), r"\1=[REDACTED]"),
)


def redact_text(text: str) -> str:
    redacted = text
    for pattern, replacement in REDACTION_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted

FALLBACK_PROMPT = """You are Farrier's full-turn semantic stop judge.

Review the whole turn diff and untracked file list provided in the input JSON. Return JSON only with this exact shape:
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

Use "serious" only for problems worth blocking Stop: secret exposure, destructive architecture
drift, large unrelated rewrites, obvious broken best practices likely to fail runtime or tests,
business logic dumped into unrelated modules, or generated/owned files edited by bypassing the
proper tool. Advisory findings must not block Stop. Return JSON only.
"""


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read(MAX_PAYLOAD_BYTES + 1)
    if len(raw.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        emit_stop_block("Semantic stop input exceeded 256 KiB. Split the operation and retry Stop.")
        sys.exit(0)
    if not raw.strip():
        emit_stop_block("Semantic stop received empty input. Retry Stop.")
        sys.exit(0)

    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, ValueError, RecursionError):
        emit_stop_block("Semantic stop received invalid JSON. Retry Stop.")
        sys.exit(0)
    if not isinstance(payload, dict):
        emit_stop_block("Semantic stop JSON root must be an object. Retry Stop.")
        sys.exit(0)
    return payload


def load_manifest(cwd: str) -> tuple[dict[str, Any], str | None]:
    text, error = read_project_text(cwd, ".farrier.json", MAX_MANIFEST_BYTES)
    if error is not None or text is None:
        return {}, error
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError, RecursionError):
        return {}, "contains invalid JSON"
    return (data, None) if isinstance(data, dict) else ({}, "root must be an object")


def int_from(value: Any, default: int) -> int:
    if isinstance(value, int) and value > 0:
        return value
    return default


def str_from(value: Any, default: str) -> str:
    if isinstance(value, str) and value.strip():
        return value
    return default


def stop_config(manifest: dict[str, Any]) -> dict[str, Any]:
    judge = manifest.get("judge")
    if not isinstance(judge, dict):
        return {}

    stop = judge.get("stop")
    return stop if isinstance(stop, dict) else {}


def validate_stop_config(config: dict[str, Any]) -> str | None:
    if config.get("enabled") is not True:
        return "judge.stop.enabled must be true or false"
    backend = config.get("backend")
    if backend is not None and backend not in {"claude", "codex"}:
        return 'judge.stop.backend must be "claude" or "codex"'
    model = config.get("model")
    if model is not None and (not isinstance(model, str) or not model.strip()):
        return "judge.stop.model must be a non-empty string"
    numeric_bounds = (
        ("timeoutMs", MAX_TIMEOUT_MS),
        ("maxDiffBytes", MAX_DIFF_BYTES),
        ("maxUntrackedFiles", MAX_UNTRACKED_FILES),
    )
    for field, maximum in numeric_bounds:
        value = config.get(field)
        if value is not None and (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or value <= 0
            or value > maximum
        ):
            return f"judge.stop.{field} must be greater than zero and at most {maximum}"
    prompt = config.get("prompt")
    if prompt is not None and (not isinstance(prompt, str) or not prompt.strip()):
        return "judge.stop.prompt must be a non-empty project-relative path"
    return None


def prompt_text(cwd: str, config: dict[str, Any]) -> tuple[str | None, str | None]:
    configured = config.get("prompt")
    if configured is None:
        return capped_text(FALLBACK_PROMPT), None
    assert isinstance(configured, str)
    text, error = read_project_text(cwd, configured, MAX_EMBEDDED_CONTENT_BYTES)
    if error is not None or text is None:
        if error == "is missing":
            error = "is missing or unreadable"
        return None, f"judge.stop.prompt {error}"
    if not text.strip():
        return None, "judge.stop.prompt must not be empty"
    return capped_text(text), None


def capped_text(text: str, limit: int = MAX_EMBEDDED_CONTENT_BYTES) -> str:
    if not isinstance(limit, int) or isinstance(limit, bool) or limit <= 0:
        raise ValueError("text limit must be a positive integer")
    redacted = redact_text(text)
    encoded = redacted.encode("utf-8")
    if len(encoded) <= limit:
        return redacted
    marker = b"\n[truncated]"
    if limit <= len(marker):
        return encoded[:limit].decode("utf-8", errors="ignore")
    head = encoded[: limit - len(marker)].decode("utf-8", errors="ignore")
    return f"{head}\n[truncated]"


def run_git(
    args: list[str], cwd: str, max_output_bytes: int, timeout_seconds: float = 10
) -> tuple[int, str, bool] | None:
    if shutil.which("git") is None:
        return None

    returncode, output, status = run_bounded_process(
        ["git", *args],
        cwd=cwd,
        timeout_seconds=timeout_seconds,
        max_output_bytes=max_output_bytes,
    )
    if status == "overflow":
        return 0, capped_text(f"{output}\n[truncated during capture]", max_output_bytes), True
    if status != "ok" or returncode is None:
        return None
    return returncode, output, False


def has_valid_git_head(cwd: str) -> bool:
    worktree = run_git(["rev-parse", "--is-inside-work-tree"], cwd, 4096)
    if worktree is None or worktree[0] != 0 or worktree[1].strip() != "true":
        return False

    head = run_git(["rev-parse", "--verify", "HEAD"], cwd, 4096)
    return head is not None and head[0] == 0 and bool(head[1].strip())


def collect_diff(cwd: str, max_diff_bytes: int) -> str | None:
    result = run_git(["diff", "HEAD"], cwd, max_diff_bytes, timeout_seconds=15)
    if result is None or result[0] != 0:
        return None

    return capped_text(result[1], max_diff_bytes)


def collect_untracked(cwd: str, max_files: int) -> list[str] | None:
    capture_budget = min(max_files * (MAX_UNTRACKED_PATH_BYTES + 1) + 1, MAX_UNTRACKED_FILES * (MAX_UNTRACKED_PATH_BYTES + 1) + 1)
    result = run_git(["ls-files", "--others", "--exclude-standard"], cwd, capture_budget)
    if result is None or result[0] != 0:
        return None

    paths = [capped_text(line, MAX_UNTRACKED_PATH_BYTES) for line in result[1].splitlines() if line.strip()][:max_files]
    if result[2] or len([line for line in result[1].splitlines() if line.strip()]) > max_files:
        marker = "[untracked file list truncated]"
        if paths:
            paths[-1] = marker
        else:
            paths.append(marker)
    return paths


def build_combined_prompt(
    base_prompt: str, diff: str, untracked_files: list[str]
) -> tuple[str, bool]:
    payload = {
        "event": "Stop",
        "diff": capped_text(diff, MAX_DIFF_BYTES),
        "untrackedFiles": [capped_text(path, MAX_UNTRACKED_PATH_BYTES) for path in untracked_files],
    }

    combined = f"{capped_text(base_prompt).strip()}\n\nInput JSON:\n{json.dumps(payload, indent=2)}\n"
    truncated = len(redact_text(combined).encode("utf-8")) > MAX_COMBINED_PROMPT_BYTES
    return capped_text(combined, MAX_COMBINED_PROMPT_BYTES), truncated


def backend_command(
    backend: str, model: str, prompt: str
) -> tuple[list[str], str | None] | None:
    if backend == "claude":
        if shutil.which("claude") is None:
            return None
        return (["claude", "-p", "--model", model], prompt)

    if backend == "codex":
        if shutil.which("codex") is None:
            return None
        return (["codex", "exec", "--model", model, prompt], None)

    return None


def run_backend(
    config: dict[str, Any], combined_prompt: str, cwd: str
) -> dict[str, Any] | None:
    backend = str_from(config.get("backend"), "claude")
    model = str_from(config.get("model"), "sonnet")
    timeout_ms = min(int_from(config.get("timeoutMs"), DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS)

    command = backend_command(backend, model, combined_prompt)
    if command is None:
        return None

    args, stdin_text = command

    returncode, output, status = run_bounded_process(
        args,
        cwd=cwd,
        timeout_seconds=timeout_ms / 1000,
        max_output_bytes=MAX_BACKEND_OUTPUT_BYTES,
        stdin_text=stdin_text,
    )
    if status != "ok" or returncode != 0:
        return None

    try:
        data = json.loads(output)
    except (json.JSONDecodeError, ValueError, RecursionError):
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


def block_reason(judgement: dict[str, Any]) -> str:
    summary = judgement.get("summary")
    reason = f"semantic stop judge blocked stop (serious): {summary if isinstance(summary, str) else 'serious finding'}"

    findings = judgement.get("findings")
    if isinstance(findings, list):
        lines = [reason]
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

    return reason


def emit_stop_block(reason: str) -> None:
    reason = redact_text(reason).encode("utf-8")[:MAX_REASON_BYTES].decode("utf-8", errors="ignore")
    print(
        json.dumps(
            {
                "decision": "block",
                "reason": reason,
            }
        )
    )


def main() -> int:
    payload = read_payload()

    if payload.get("hook_event_name") != "Stop":
        emit_stop_block("Semantic stop received the wrong event. Retry Stop.")
        return 0

    active = payload.get("stop_hook_active")
    if active is True:
        return 0
    if active is not None and active is not False:
        emit_stop_block("Semantic stop received malformed stop_hook_active; retry Stop with a boolean value.")
        return 0

    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()
    manifest, manifest_error = load_manifest(cwd)
    if not manifest or not isinstance(manifest.get("judge"), dict) or not isinstance(manifest.get("judge", {}).get("stop"), dict):
        detail = f": {manifest_error}" if manifest_error else ""
        emit_stop_block(f"Semantic stop configuration is missing or malformed{detail}. Run farrier doctor and farrier update --yes.")
        return 0
    config = stop_config(manifest)

    if config.get("enabled") is False:
        return 0
    config_error = validate_stop_config(config)
    if config_error is not None:
        emit_stop_block(f"Semantic stop configuration is malformed: {config_error}. Run farrier doctor and farrier update --yes.")
        return 0
    base_prompt, prompt_error = prompt_text(cwd, config)
    if prompt_error is not None or base_prompt is None:
        emit_stop_block(f"Semantic stop configuration is malformed: {prompt_error}. Run farrier doctor and farrier update --yes.")
        return 0

    if not has_valid_git_head(cwd):
        emit_stop_block("Semantic stop could not establish a valid Git HEAD. Initialize/repair Git or disable the semantic judge explicitly.")
        return 0

    max_diff_bytes = int(config.get("maxDiffBytes", DEFAULT_MAX_DIFF_BYTES))
    max_untracked_files = int(config.get("maxUntrackedFiles", DEFAULT_MAX_UNTRACKED_FILES))

    diff = collect_diff(cwd, max_diff_bytes)
    untracked_files = collect_untracked(cwd, max_untracked_files)

    if diff is None or untracked_files is None:
        emit_stop_block("Semantic stop could not collect the bounded Git evidence. Run git status and retry Stop.")
        return 0

    if not diff.strip() and not untracked_files:
        return 0

    combined_prompt, prompt_truncated = build_combined_prompt(base_prompt, diff, untracked_files)
    if prompt_truncated:
        emit_stop_block(
            f"Semantic stop evidence exceeded the {MAX_COMBINED_PROMPT_BYTES}-byte combined review bound; no backend judgement was accepted. "
            "Split the change into smaller reviewed steps, then retry Stop."
        )
        return 0
    judgement = valid_judgement(run_backend(config, combined_prompt, cwd))

    if judgement is None:
        emit_stop_block("Semantic stop backend failed, timed out, or returned invalid bounded JSON. Retry or disable judge.stop explicitly.")
        return 0

    if judgement.get("severity") == "serious":
        emit_stop_block(block_reason(judgement))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

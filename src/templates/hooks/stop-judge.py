#!/usr/bin/env python3
"""Shared Claude and Codex Stop hook for optional full-diff semantic review."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


DEFAULT_TIMEOUT_MS = 30000
DEFAULT_MAX_DIFF_BYTES = 120000
DEFAULT_MAX_UNTRACKED_FILES = 50
MAX_EMBEDDED_CONTENT_BYTES = 30 * 1024

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


def stop_config(manifest: dict[str, Any]) -> dict[str, Any]:
    judge = manifest.get("judge")
    if not isinstance(judge, dict):
        return {}

    stop = judge.get("stop")
    return stop if isinstance(stop, dict) else {}


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def prompt_text(cwd: str, config: dict[str, Any]) -> str:
    configured = config.get("prompt")
    if isinstance(configured, str) and configured.strip():
        text = read_text(Path(cwd) / configured)
        if text is not None and text.strip():
            return text

    return FALLBACK_PROMPT


def capped_text(text: str, limit: int = MAX_EMBEDDED_CONTENT_BYTES) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= limit:
        return text

    head = encoded[:limit].decode("utf-8", errors="ignore")
    return f"{head}\n[truncated]"


def run_git(
    args: list[str], cwd: str, timeout_seconds: float = 10
) -> tuple[int, str] | None:
    if shutil.which("git") is None:
        return None

    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout_seconds,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    return proc.returncode, proc.stdout


def has_valid_git_head(cwd: str) -> bool:
    worktree = run_git(["rev-parse", "--is-inside-work-tree"], cwd)
    if worktree is None or worktree[0] != 0 or worktree[1].strip() != "true":
        return False

    head = run_git(["rev-parse", "--verify", "HEAD"], cwd)
    return head is not None and head[0] == 0 and bool(head[1].strip())


def collect_diff(cwd: str, max_diff_bytes: int) -> str | None:
    result = run_git(["diff", "HEAD"], cwd, timeout_seconds=15)
    if result is None or result[0] != 0:
        return None

    return capped_text(result[1], min(max_diff_bytes, MAX_EMBEDDED_CONTENT_BYTES))


def collect_untracked(cwd: str, max_files: int) -> list[str] | None:
    result = run_git(["ls-files", "--others", "--exclude-standard"], cwd)
    if result is None or result[0] != 0:
        return None

    return [line for line in result[1].splitlines() if line.strip()][:max_files]


def build_combined_prompt(
    base_prompt: str, diff: str, untracked_files: list[str]
) -> str:
    payload = {
        "event": "Stop",
        "diff": capped_text(diff),
        "untrackedFiles": untracked_files,
    }

    return f"{base_prompt.strip()}\n\nInput JSON:\n{json.dumps(payload, indent=2)}\n"


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
        return 0

    if payload.get("stop_hook_active") is True:
        return 0

    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()
    manifest = load_manifest(cwd)
    config = stop_config(manifest)

    if config.get("enabled") is not True:
        return 0

    if not has_valid_git_head(cwd):
        return 0

    max_diff_bytes = int_from(config.get("maxDiffBytes"), DEFAULT_MAX_DIFF_BYTES)
    max_untracked_files = int_from(
        config.get("maxUntrackedFiles"), DEFAULT_MAX_UNTRACKED_FILES
    )

    diff = collect_diff(cwd, max_diff_bytes)
    untracked_files = collect_untracked(cwd, max_untracked_files)

    if diff is None or untracked_files is None:
        return 0

    if not diff.strip() and not untracked_files:
        return 0

    combined_prompt = build_combined_prompt(
        prompt_text(cwd, config), diff, untracked_files
    )
    judgement = valid_judgement(run_backend(config, combined_prompt, cwd))

    if judgement is None:
        return 0

    if judgement.get("severity") == "serious":
        emit_stop_block(block_reason(judgement))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

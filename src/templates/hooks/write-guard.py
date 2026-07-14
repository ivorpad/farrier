#!/usr/bin/env python3
"""Shared PreToolUse hook that blocks direct writes to protected files."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import PurePosixPath
from pathlib import Path
from typing import Any


EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"}
PATH_KEYS = {"file_path", "path", "notebook_path"}
PATCH_HEADER = re.compile(
    r"^\*\*\* (?:Update|Add|Delete) File: (?P<path>.+?)\s*$", re.MULTILINE
)

LOCKFILE_BASENAMES = {
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "uv.lock",
    "poetry.lock",
    "Pipfile.lock",
    "Cargo.lock",
    "Gemfile.lock",
    "go.sum",
}
MAX_PAYLOAD_BYTES = 256 * 1024


def emit_deny(reason: str) -> None:
    reason = reason.encode("utf-8")[:2000].decode("utf-8", errors="ignore")
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read(MAX_PAYLOAD_BYTES + 1)
    if len(raw.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        emit_deny("Blocked malformed PreToolUse input: payload exceeds 256 KiB. Split the edit and retry.")
        sys.exit(0)
    if not raw.strip():
        emit_deny("Blocked malformed PreToolUse input: expected one JSON object.")
        sys.exit(0)

    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, ValueError, RecursionError):
        emit_deny("Blocked malformed PreToolUse input: invalid JSON.")
        sys.exit(0)
    if not isinstance(payload, dict):
        emit_deny("Blocked malformed PreToolUse input: JSON root must be an object.")
        sys.exit(0)
    return payload


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


def patch_paths(tool_input: dict[str, Any]) -> list[str]:
    command = tool_input.get("command")
    if not isinstance(command, str):
        return []
    return [match.group("path") for match in PATCH_HEADER.finditer(command)]


def normalize_path(path: str) -> str:
    normalized = path.replace("\\", "/").strip().strip("\"'")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def path_parts(path: str) -> list[str]:
    normalized = normalize_path(path)
    return [part for part in PurePosixPath(normalized).parts if part not in {"", "."}]


def protected_reason(path: str) -> str | None:
    parts = path_parts(path)
    basename = os.path.basename(normalize_path(path))

    if ".git" in parts:
        return f"Blocked write to `{path}`. Do not directly mutate `.git/`; use git commands instead."

    if basename == "skills-lock.json":
        return f"Blocked write to `{path}`. `skills-lock.json` is managed by the skills CLI; use `skills add`, `skills update`, or `skills experimental_install`."

    if basename == ".farrier.json":
        return f"Blocked write to `{path}`. `.farrier.json` is managed by farrier; use `farrier update`."

    if basename in LOCKFILE_BASENAMES:
        return f"Blocked write to `{path}`. Lockfiles are owned by their package manager; use the appropriate tool such as `uv`, `bun`, `pnpm`, `npm`, `cargo`, `bundle`, or `go`."

    return None


def outside_root(path: str, cwd: str) -> bool:
    try:
        root = Path(cwd).resolve(strict=False)
        candidate = Path(path)
        resolved = candidate.resolve(strict=False) if candidate.is_absolute() else (root / candidate).resolve(strict=False)
        return resolved != root and root not in resolved.parents
    except (OSError, RuntimeError, ValueError):
        return True


def main() -> int:
    payload = read_payload()

    if payload.get("tool_name") not in EDIT_TOOLS:
        return 0
    if payload.get("hook_event_name") != "PreToolUse":
        emit_deny("Blocked recognized mutation because the hook event contract is invalid. Retry the edit.")
        return 0

    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        emit_deny("Blocked ambiguous recognized mutation: tool_input must be an object.")
        return 0

    paths = (
        patch_paths(tool_input)
        if payload.get("tool_name") == "apply_patch"
        else iter_path_values(tool_input)
    )
    if not paths:
        emit_deny("Blocked ambiguous recognized mutation: no target path could be determined. Use a supported path field or a complete apply_patch header.")
        return 0
    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()
    for path in paths:
        if outside_root(path, cwd):
            emit_deny(f"Blocked out-of-root mutation to `{normalize_path(path)}`. Keep edits inside the project root.")
            return 0
        reason = protected_reason(path)
        if reason is not None:
            emit_deny(reason)
            return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

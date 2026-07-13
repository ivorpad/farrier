#!/usr/bin/env python3
"""Shared PreToolUse hook that blocks direct writes to protected files."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import PurePosixPath
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


def emit_deny(reason: str) -> None:
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
    raw = sys.stdin.read()
    if not raw.strip():
        return {}

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {}

    return payload if isinstance(payload, dict) else {}


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


def main() -> int:
    payload = read_payload()

    if payload.get("tool_name") not in EDIT_TOOLS:
        return 0

    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return 0

    paths = (
        patch_paths(tool_input)
        if payload.get("tool_name") == "apply_patch"
        else iter_path_values(tool_input)
    )
    for path in paths:
        reason = protected_reason(path)
        if reason is not None:
            emit_deny(reason)
            return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

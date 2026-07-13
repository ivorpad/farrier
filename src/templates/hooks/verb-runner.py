#!/usr/bin/env python3
"""Shared Claude and Codex hook that runs project verification verbs."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"}
JUSTFILE_NAMES = ("justfile", "Justfile", ".justfile")
# Structure-linting recipes farrier scaffolds, in priority order. Python packs
# ship "konpy"; TypeScript packs ship "konsistent". A project has at most one.
STRUCTURE_RECIPES = ("konpy", "konsistent")


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {}

    return payload if isinstance(payload, dict) else {}


def iter_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]

    if isinstance(value, dict):
        strings: list[str] = []
        for item in value.values():
            strings.extend(iter_strings(item))
        return strings

    if isinstance(value, list):
        strings: list[str] = []
        for item in value:
            strings.extend(iter_strings(item))
        return strings

    return []


def edited_hook_file(payload: dict[str, Any]) -> bool:
    tool_input = payload.get("tool_input", {})
    for text in iter_strings(tool_input):
        normalized = text.replace("\\", "/")
        if ".claude/hooks/" in normalized or normalized.startswith(".claude/hooks/"):
            return True
    return False


def has_just_recipe(cwd: str, recipe: str) -> bool:
    pattern = re.compile(rf"^{re.escape(recipe)}\s*(?:[^:\n]*)?:", re.MULTILINE)

    for name in JUSTFILE_NAMES:
        path = Path(cwd) / name
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        if pattern.search(text):
            return True

    return False


def run_command(command: list[str], cwd: str) -> tuple[bool, str]:
    try:
        proc = subprocess.run(
            command,
            cwd=cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
    except FileNotFoundError as exc:
        return False, f"{command[0]} not found: {exc}"
    except OSError as exc:
        return False, f"failed to run {' '.join(command)}: {exc}"

    output = proc.stdout.strip()
    if proc.returncode == 0:
        return True, output

    summary = (
        output if output else f"{' '.join(command)} exited with code {proc.returncode}"
    )
    return False, summary


def emit_posttool_failure(output: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": f"just check failed:\n{output}",
                }
            }
        )
    )


def emit_stop_block(recipe: str, output: str) -> None:
    print(
        json.dumps(
            {
                "decision": "block",
                "reason": f"{recipe} check failed:\n{output}",
            }
        )
    )


def main() -> int:
    payload = read_payload()
    event = payload.get("hook_event_name")
    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()

    if event == "PostToolUse":
        tool_name = payload.get("tool_name")

        if tool_name not in EDIT_TOOLS:
            return 0

        if edited_hook_file(payload):
            return 0

        ok, output = run_command(["just", "check"], cwd)
        if not ok:
            emit_posttool_failure(output)
        return 0

    if event == "Stop":
        if payload.get("stop_hook_active") is True:
            return 0

        recipe = next(
            (name for name in STRUCTURE_RECIPES if has_just_recipe(cwd, name)), None
        )
        if recipe is None:
            return 0

        ok, output = run_command(["just", recipe], cwd)
        if not ok:
            emit_stop_block(recipe, output)
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

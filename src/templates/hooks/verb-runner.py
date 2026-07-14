#!/usr/bin/env python3
"""Shared Claude and Codex hook that runs project verification verbs."""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

from _hook_runtime import read_project_text, run_bounded_process


EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"}
JUSTFILE_NAMES = ("justfile", "Justfile", ".justfile")
# Structure-linting recipes farrier scaffolds, in priority order. Python packs
# ship "konpy"; TypeScript packs ship "konsistent". A project has at most one.
STRUCTURE_RECIPES = ("konpy", "konsistent")
MAX_PAYLOAD_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 16 * 1024
COMMAND_TIMEOUT_SECONDS = 120
MAX_JUSTFILE_BYTES = 256 * 1024
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


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read(MAX_PAYLOAD_BYTES + 1)
    if len(raw.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        emit_posttool_failure("Hook input exceeded 256 KiB; split the edit and rerun just check.")
        sys.exit(0)
    if not raw.strip():
        emit_posttool_failure("Malformed hook input; rerun just check manually.")
        sys.exit(0)

    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, ValueError, RecursionError):
        emit_posttool_failure("Malformed hook JSON; rerun just check manually.")
        sys.exit(0)
    if not isinstance(payload, dict):
        emit_posttool_failure("Malformed hook JSON root; rerun just check manually.")
        sys.exit(0)
    return payload


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


def find_just_recipes(cwd: str) -> tuple[set[str], str | None]:
    recipes: set[str] = set()
    found = False
    patterns = {
        recipe: re.compile(rf"^{re.escape(recipe)}\s*(?:[^:\n]*)?:", re.MULTILINE)
        for recipe in STRUCTURE_RECIPES
    }
    for name in JUSTFILE_NAMES:
        if not os.path.lexists(os.path.join(cwd, name)):
            continue
        found = True
        text, error = read_project_text(cwd, name, MAX_JUSTFILE_BYTES)
        if error is not None or text is None:
            return set(), f"{name} {error}"
        recipes.update(recipe for recipe, pattern in patterns.items() if pattern.search(text))
    if not found:
        return set(), "no justfile was found"
    return recipes, None


def run_command(command: list[str], cwd: str) -> tuple[bool, str]:
    returncode, captured, status = run_bounded_process(
        command,
        cwd=cwd,
        timeout_seconds=COMMAND_TIMEOUT_SECONDS,
        max_output_bytes=MAX_OUTPUT_BYTES,
        merge_stderr=True,
    )
    output = redact_text(captured).strip()
    if status == "timeout":
        return False, f"{' '.join(command)} timed out after {COMMAND_TIMEOUT_SECONDS}s; run it manually for full output"
    if status == "overflow":
        return False, f"{' '.join(command)} output exceeded {MAX_OUTPUT_BYTES} bytes; process was terminated and the bounded prefix follows:\n{output}"
    if returncode is None:
        return False, f"failed to run {' '.join(command)}"
    if returncode == 0:
        return True, output

    summary = output if output else f"{' '.join(command)} exited with code {returncode}"
    return False, summary


def bounded_output(output: str) -> str:
    return redact_text(output).encode("utf-8")[:MAX_OUTPUT_BYTES].decode("utf-8", errors="ignore")


def emit_posttool_failure(output: str) -> None:
    output = bounded_output(output)
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
    output = bounded_output(output)
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
        if not isinstance(payload.get("tool_input"), dict):
            emit_posttool_failure("Malformed recognized edit payload; run just check manually.")
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
        if payload.get("stop_hook_active") not in {None, False}:
            emit_stop_block("stop", "Malformed stop_hook_active value; retry Stop after correcting the hook payload.")
            return 0

        recipes, discovery_error = find_just_recipes(cwd)
        if discovery_error is not None:
            emit_stop_block("structure", f"Could not safely discover generated structure recipe: {discovery_error}. Run farrier doctor and farrier update --yes.")
            return 0
        recipe = next((name for name in STRUCTURE_RECIPES if name in recipes), None)
        if recipe is None:
            emit_stop_block("structure", "Required generated structure recipe is missing; run farrier doctor and farrier update --yes.")
            return 0

        ok, output = run_command(["just", recipe], cwd)
        if not ok:
            emit_stop_block(recipe, output)
        return 0

    emit_posttool_failure("Unsupported hook event; run the generated checks manually.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Shared Claude and Codex hook that runs project verification verbs."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from typing import Any

from _hook_runtime import log_event, read_project_text, run_bounded_process


EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"}
# Documentation-only edits cannot break the verification gate in the stacks
# farrier scaffolds; they skip check-fast and downgrade the Stop check.
DOC_EXTENSIONS = (".md", ".markdown", ".rst", ".adoc", ".txt")
JUSTFILE_NAMES = ("justfile", "Justfile", ".justfile")
MAX_JUSTFILE_BYTES = 256 * 1024
MAX_PAYLOAD_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 16 * 1024
COMMAND_TIMEOUT_SECONDS = 120
# Deterministic denylist: known provider token shapes plus assignments to
# secret-named variables. Prose PII (names, addresses, secrets written as free
# text) is not detectable here and stays out of scope pending its own design.
REDACTION_PATTERNS = (
    (re.compile(r"-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----"), "[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|gl(?:pat|rt)-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|npm_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{8,})\b"), "[REDACTED_TOKEN]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"), "[REDACTED_JWT]"),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}"), "Bearer [REDACTED_TOKEN]"),
    (re.compile(r"(?i)\b([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})\b"), "[REDACTED_EMAIL]"),
    (re.compile(r"(?i)\b((?:[A-Za-z0-9]+[_.-])*(?:api[_-]?key|access[_-]?key|secret[_-]?key|signing[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|credentials?|authorization))[\"']?\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)"), r"\1=[REDACTED]"),
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
        if ".farrier/hooks/" in normalized or normalized.startswith(".farrier/hooks/"):
            return True
    return False


def recipe_missing(cwd: str, recipe: str) -> bool:
    """True when the justfile demonstrably has no such recipe.

    An evidence-gated harness only generates the recipes its repository can
    actually run, so a project with no linter and no test runner has no
    check-full at all, and demanding one would block every stop on exactly
    those projects. Read the justfile rather than asking `just`: it is one
    less process, and an unreadable or missing answer must not be mistaken
    for a missing recipe. Anything unreadable returns False so the gate still
    runs and `just` reports the real error.
    """
    pattern = re.compile(rf"^{re.escape(recipe)}\s*(?:[^:\n]*)?:", re.MULTILINE)
    found_justfile = False
    for name in JUSTFILE_NAMES:
        if not os.path.lexists(os.path.join(cwd, name)):
            continue
        found_justfile = True
        text, error = read_project_text(cwd, name, MAX_JUSTFILE_BYTES)
        if error is not None or text is None:
            return False
        if pattern.search(text):
            return False
    # No justfile at all is not evidence of a missing recipe: a harness with no
    # gate never binds this hook in the first place, so reaching here means
    # something else is wrong and `just` should report it.
    return found_justfile


def run_command(command: list[str], cwd: str) -> tuple[bool, str]:
    returncode, captured, status, _ = run_bounded_process(
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


RUNTIME_DIR = os.path.join(".farrier", "runtime")
VERIFY_STATE_NAME = "verify-state.json"
MAX_STATE_BYTES = 16 * 1024
TEST_SUFFIX_STYLES = (".test", ".spec", "_test", "_spec")
MAX_TARGETED_TESTS = 10

ANSI_PATTERN = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
DURATION_PATTERN = re.compile(r"\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|seconds)\b")
CLOCK_PATTERN = re.compile(r"\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b")
TEMP_PATH_PATTERN = re.compile(r"(?:/private)?/(?:var/folders|tmp)/[^\s\"']*")


def normalize_failure(output: str, cwd: str) -> str:
    normalized = ANSI_PATTERN.sub("", output)
    normalized = normalized.replace(cwd, "<project>")
    normalized = TEMP_PATH_PATTERN.sub("<tmp>", normalized)
    normalized = DURATION_PATTERN.sub("<duration>", normalized)
    normalized = CLOCK_PATTERN.sub("<time>", normalized)
    return re.sub(r"[ \t]+", " ", normalized).strip()


def failure_fingerprint(output: str, cwd: str) -> str:
    return hashlib.sha256(normalize_failure(output, cwd).encode("utf-8")).hexdigest()


def read_verify_state(cwd: str) -> dict:
    text, error = read_project_text(cwd, f"{RUNTIME_DIR}/{VERIFY_STATE_NAME}".replace(os.sep, "/"), MAX_STATE_BYTES)
    if error is not None or text is None:
        return {}
    try:
        state = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return {}
    return state if isinstance(state, dict) else {}


def write_verify_state(cwd: str, state: dict) -> None:
    try:
        directory = os.path.join(cwd, RUNTIME_DIR)
        os.makedirs(directory, exist_ok=True)
        with open(os.path.join(directory, VERIFY_STATE_NAME), "w", encoding="utf-8") as handle:
            json.dump(state, handle)
    except OSError:
        # Losing verification state degrades to blocking again, never to
        # skipping a real failure.
        pass


def docs_only_edit(payload: dict[str, Any]) -> bool:
    paths = edited_project_paths(payload)
    return bool(paths) and all(path.lower().endswith(DOC_EXTENSIONS) for path in paths)


def record_edit(cwd: str, docs_only: bool) -> None:
    """Count hook-visible edits so the Stop gate can tell whether anything
    changed since its last verdict, and whether any change touched non-docs."""
    state = read_verify_state(cwd)
    state["editSerial"] = int(state.get("editSerial", 0)) + 1
    if not docs_only:
        state["sourceEditSerial"] = int(state.get("sourceEditSerial", 0)) + 1
    write_verify_state(cwd, state)


def is_test_file(path: str) -> bool:
    name = os.path.basename(path)
    stem, _ = os.path.splitext(name)
    if name.startswith("test_") or stem.endswith(TEST_SUFFIX_STYLES):
        return True
    return False


def edited_project_paths(payload: dict[str, Any]) -> list[str]:
    tool_input = payload.get("tool_input", {})
    paths: list[str] = []

    if isinstance(tool_input, dict):
        for key in ("file_path", "notebook_path", "path"):
            value = tool_input.get(key)
            if isinstance(value, str) and value.strip():
                paths.append(value.strip())

    # Codex apply_patch payloads carry paths inside the patch text.
    for text in iter_strings(tool_input):
        for match in re.finditer(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$", text, re.MULTILINE):
            paths.append(match.group(1).strip())

    return paths


def targeted_test_files(payload: dict[str, Any], cwd: str) -> list[str]:
    """Existing test files related to the edited paths, deduped and bounded."""
    candidates: list[str] = []

    for raw in edited_project_paths(payload):
        relative = raw.replace("\\", "/")
        if os.path.isabs(relative):
            try:
                relative = os.path.relpath(relative, cwd).replace(os.sep, "/")
            except ValueError:
                continue
        if relative.startswith("../"):
            continue

        if is_test_file(relative):
            candidates.append(relative)
            continue

        directory = os.path.dirname(relative)
        stem, extension = os.path.splitext(os.path.basename(relative))
        for candidate_dir in (directory, "tests", "test"):
            candidates.extend(
                f"{candidate_dir}/{name}" if candidate_dir else name
                for name in (
                    f"test_{stem}.py",
                    f"{stem}_test{extension}",
                    f"{stem}.test{extension}",
                    f"{stem}.spec{extension}",
                )
            )

    existing: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen or len(existing) >= MAX_TARGETED_TESTS:
            continue
        seen.add(candidate)
        normalized = os.path.normpath(candidate)
        if normalized.startswith(".."):
            continue
        if os.path.isfile(os.path.join(cwd, normalized)) and not os.path.islink(os.path.join(cwd, normalized)):
            existing.append(candidate)

    return existing


def emit_posttool_failure(output: str) -> None:
    output = bounded_output(output)
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": f"just check-fast failed:\n{output}",
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

        docs_only = docs_only_edit(payload)
        record_edit(cwd, docs_only)
        if docs_only:
            log_event(cwd, "verb-runner", "PostToolUse", "skipped-docs-only", rule="check-fast")
            return 0

        if recipe_missing(cwd, "check-fast"):
            log_event(cwd, "verb-runner", "PostToolUse", "skipped-no-recipe", rule="check-fast")
            return 0

        ok, output = run_command(["just", "check-fast", *targeted_test_files(payload, cwd)], cwd)
        log_event(cwd, "verb-runner", "PostToolUse", "passed" if ok else "failed", rule="check-fast")
        if not ok:
            emit_posttool_failure(output)
        return 0

    if event == "Stop":
        if payload.get("stop_hook_active") is True:
            return 0
        if payload.get("stop_hook_active") not in {None, False}:
            emit_stop_block("stop", "Malformed stop_hook_active value; retry Stop after correcting the hook payload.")
            return 0

        state = read_verify_state(cwd)
        edit_serial = int(state.get("editSerial", 0))

        # A previous Stop already recorded this tree's failure fingerprint and
        # no hook-visible edit happened since: allow immediately instead of
        # paying for an identical full run. Edits made through paths hooks do
        # not see (raw shell edits) degrade to allowing a stop the gate would
        # also have allowed on the recorded identical failure.
        if "checkFullFailure" in state and state.get("checkFullEditSerial") == edit_serial:
            log_event(cwd, "verb-runner", "Stop", "baseline-allowed", rule="check-full")
        else:
            # Sessions whose hook-visible edits were all documentation run the
            # fast gate instead of the full suite; docs cannot break it.
            source_serial = int(state.get("sourceEditSerial", 0))
            docs_only_session = edit_serial > 0 and source_serial == 0
            recipe_name = "check-fast" if docs_only_session else "check-full"

            if recipe_missing(cwd, recipe_name):
                log_event(cwd, "verb-runner", "Stop", "skipped-no-recipe", rule=recipe_name)
                return 0

            ok, output = run_command(["just", recipe_name], cwd)
            if ok:
                log_event(cwd, "verb-runner", "Stop", "passed", rule=recipe_name)
                if "checkFullFailure" in state:
                    state.pop("checkFullFailure", None)
                    state.pop("checkFullEditSerial", None)
                    write_verify_state(cwd, state)
            else:
                fingerprint = failure_fingerprint(output, cwd)
                if state.get("checkFullFailure") != fingerprint:
                    state["checkFullFailure"] = fingerprint
                    state["checkFullEditSerial"] = edit_serial
                    write_verify_state(cwd, state)
                    log_event(cwd, "verb-runner", "Stop", "blocked", rule=recipe_name)
                    emit_stop_block(
                        recipe_name,
                        f"{output}\n\nIf this failure predates your changes, name each failing test explicitly in "
                        "your final summary as pre-existing and stop again. Do not re-run the full check yourself; "
                        "stopping again with the identical failure will be allowed.",
                    )
                    return 0
                # Known baseline failure already reported once: allow the stop.
                state["checkFullEditSerial"] = edit_serial
                write_verify_state(cwd, state)
                log_event(cwd, "verb-runner", "Stop", "baseline-allowed", rule=recipe_name)

        return 0

    emit_posttool_failure("Unsupported hook event; run the generated checks manually.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

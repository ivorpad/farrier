#!/usr/bin/env python3
"""Shared Stop hook that surfaces leftover test/automation processes once.

Parameterized by `guards.processTeardown` in `.farrier.json`:
  patterns  list of regular expressions matched against process command lines
  message   optional extra teaching line appended to the advisory
  enabled   set false to turn the audit off without uninstalling it

Advisory by design: when leftovers match, Stop is blocked ONCE with the
listing so the agent can tear them down; the retried Stop (stop_hook_active)
always passes. Every infrastructure failure (no ps, bad manifest, bad
pattern) fails OPEN with a logged event — this hook must never strand an
agent.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

from _hook_runtime import log_event, read_project_text, run_bounded_process

MAX_PAYLOAD_BYTES = 256 * 1024
MAX_MANIFEST_BYTES = 256 * 1024
MAX_PS_OUTPUT_BYTES = 1024 * 1024
PS_TIMEOUT_SECONDS = 5.0
MAX_PATTERNS = 32
MAX_PATTERN_CHARS = 400
MAX_REPORTED_PROCESSES = 10
MAX_COMMAND_CHARS = 160
MAX_REASON_BYTES = 4000

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

HOOK_NAME = "process-teardown-audit"


def redact_text(text: str) -> str:
    redacted = text
    for pattern, replacement in REDACTION_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def emit_stop_block(reason: str) -> None:
    reason = redact_text(reason).encode("utf-8")[:MAX_REASON_BYTES].decode("utf-8", errors="ignore")
    print(json.dumps({"decision": "block", "reason": reason}))


def read_payload() -> dict[str, Any] | None:
    """Parse the Stop payload; malformed input fails OPEN (advisory hook)."""
    raw = sys.stdin.read(MAX_PAYLOAD_BYTES + 1)
    if len(raw.encode("utf-8")) > MAX_PAYLOAD_BYTES or not raw.strip():
        return None
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, ValueError, RecursionError):
        return None
    return payload if isinstance(payload, dict) else None


def load_config(cwd: str) -> dict[str, Any] | None:
    text, error = read_project_text(cwd, ".farrier.json", MAX_MANIFEST_BYTES)
    if error is not None or text is None:
        return None
    try:
        manifest = json.loads(text)
    except (json.JSONDecodeError, ValueError, RecursionError):
        return None
    if not isinstance(manifest, dict):
        return None
    guards = manifest.get("guards")
    config = guards.get("processTeardown") if isinstance(guards, dict) else None
    return config if isinstance(config, dict) else {}


def compiled_patterns(config: dict[str, Any]) -> list[re.Pattern[str]] | None:
    """Compile the configured patterns; None means the config is malformed."""
    raw = config.get("patterns")
    if raw is None:
        return []
    if not isinstance(raw, list):
        return None
    compiled: list[re.Pattern[str]] = []
    for item in raw[:MAX_PATTERNS]:
        if not isinstance(item, str) or not item.strip() or len(item) > MAX_PATTERN_CHARS:
            return None
        try:
            compiled.append(re.compile(item))
        except re.error:
            return None
    return compiled


def list_processes() -> list[tuple[int, str]] | None:
    """(pid, command line) for every visible process; None means fail open."""
    returncode, output, status, _ = run_bounded_process(
        ["ps", "-axo", "pid=,args="],
        cwd=os.getcwd(),
        timeout_seconds=PS_TIMEOUT_SECONDS,
        max_output_bytes=MAX_PS_OUTPUT_BYTES,
    )
    if status != "ok" or returncode != 0:
        return None
    processes: list[tuple[int, str]] = []
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        processes.append((pid, parts[1]))
    return processes


def matching_leftovers(
    processes: list[tuple[int, str]], patterns: list[re.Pattern[str]]
) -> list[tuple[int, str]]:
    own_pid = os.getpid()
    ancestors = {own_pid, os.getppid()}
    matches: list[tuple[int, str]] = []
    for pid, command in processes:
        if pid in ancestors:
            continue
        if any(pattern.search(command) for pattern in patterns):
            matches.append((pid, command))
    return matches


def advisory_reason(leftovers: list[tuple[int, str]], extra_message: str | None) -> str:
    lines = [
        f"Process teardown audit: {len(leftovers)} leftover process(es) match this project's teardown patterns (guards.processTeardown in .farrier.json)."
    ]
    for pid, command in leftovers[:MAX_REPORTED_PROCESSES]:
        shown = command if len(command) <= MAX_COMMAND_CHARS else f"{command[:MAX_COMMAND_CHARS - 3]}..."
        lines.append(f"- PID {pid}: {shown}")
    if len(leftovers) > MAX_REPORTED_PROCESSES:
        lines.append(f"- ...and {len(leftovers) - MAX_REPORTED_PROCESSES} more")
    pids = " ".join(str(pid) for pid, _ in leftovers[:MAX_REPORTED_PROCESSES])
    lines.append(
        f"Terminate the ones your session started (e.g. `kill {pids}`), or state why they must stay. This advisory will not repeat on the next Stop."
    )
    if extra_message:
        lines.append(extra_message)
    return "\n".join(lines)


def main() -> int:
    payload = read_payload()
    if payload is None:
        return 0

    if payload.get("hook_event_name") != "Stop":
        return 0
    if payload.get("stop_hook_active") is not False and payload.get("stop_hook_active") is not None:
        # Second Stop after our own advisory (or any non-boolean value): allow.
        return 0

    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()

    config = load_config(cwd)
    if config is None:
        log_event(cwd, HOOK_NAME, "Stop", "error:manifest-unreadable")
        return 0
    if config.get("enabled") is False:
        return 0

    patterns = compiled_patterns(config)
    if patterns is None:
        log_event(cwd, HOOK_NAME, "Stop", "error:malformed-patterns")
        return 0
    if not patterns:
        return 0

    processes = list_processes()
    if processes is None:
        log_event(cwd, HOOK_NAME, "Stop", "error:ps-failed")
        return 0

    leftovers = matching_leftovers(processes, patterns)
    if not leftovers:
        log_event(cwd, HOOK_NAME, "Stop", "clean")
        return 0

    detail = redact_text("; ".join(f"{pid}:{command[:80]}" for pid, command in leftovers[:MAX_REPORTED_PROCESSES]))
    log_event(cwd, HOOK_NAME, "Stop", "advisory", detail=detail)
    extra_message = config.get("message") if isinstance(config.get("message"), str) else None
    emit_stop_block(advisory_reason(leftovers, extra_message))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

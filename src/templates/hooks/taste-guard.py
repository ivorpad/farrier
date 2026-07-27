#!/usr/bin/env python3
"""PreToolUse hook that denies edits whose proposed content matches a taste rule.

Parameterized by `guards.tasteGuard` in `.farrier.json`:
  rules    list of {ruleId, patterns, message} objects (patterns are regexes)
  enabled  set false to turn the guard off without uninstalling it

Each rule carries reviewed regex patterns authored from a preference-KB rule
plus its evidence (never invented by the guard itself). The hook inspects the
PROPOSED content of an Edit (`new_string`) or Write (`content`) before it is
written; a match denies the edit and cites the offending ruleId and message so
the agent can fix the code instead of the neighbouring pattern it copied.

Every internal failure (unreadable manifest, un-compilable pattern, any
unexpected error) FAILS OPEN with a logged event: the guard never blocks on its
own fault. Only malformed hook input fails closed, matching the shared
PreToolUse contract. Codex hook dispatch is unreliable, so each rule is ALSO
mirrored as a declarative AGENTS.md line — the words are the dependable layer
there; this hook is the Claude-side enforcement half.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

from _hook_runtime import log_event, read_project_text

MAX_PAYLOAD_BYTES = 1024 * 1024
MAX_MANIFEST_BYTES = 256 * 1024
MAX_CONTENT_BYTES = 512 * 1024
MAX_PATTERNS_PER_RULE = 5

HOOK_NAME = "taste-guard"


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
        emit_deny("Blocked malformed PreToolUse input: payload exceeds 1 MiB. Retry with a bounded edit.")
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


def load_config(cwd: str) -> dict[str, Any] | None:
    """Return guards.tasteGuard or None when the manifest is unreadable."""
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
    config = guards.get("tasteGuard") if isinstance(guards, dict) else None
    return config if isinstance(config, dict) else {}


def proposed_content(tool_name: str, tool_input: dict[str, Any]) -> str | None:
    """The text this edit would introduce, or None when there is nothing to check."""
    value: Any
    if tool_name == "Write":
        value = tool_input.get("content")
    elif tool_name == "Edit":
        value = tool_input.get("new_string")
    else:
        return None
    if not isinstance(value, str) or value == "":
        return None
    return value[:MAX_CONTENT_BYTES]


def first_violation(content: str, rules: list[Any]) -> tuple[str, str] | None:
    """First (ruleId, message) whose reviewed pattern matches the content.

    Un-compilable patterns are skipped (they never manufacture a block); a rule
    with no usable pattern is inert. The caller wraps this so any unexpected
    error still fails open.
    """
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        rule_id = rule.get("ruleId")
        patterns = rule.get("patterns")
        message = rule.get("message")
        if not isinstance(rule_id, str) or not isinstance(patterns, list):
            continue
        message_text = message if isinstance(message, str) and message.strip() else ""
        for pattern in patterns[:MAX_PATTERNS_PER_RULE]:
            if not isinstance(pattern, str) or not pattern:
                continue
            try:
                compiled = re.compile(pattern)
            except re.error:
                continue
            if compiled.search(content):
                return rule_id, message_text
    return None


def deny_reason(rule_id: str, message: str) -> str:
    lines = [f"Blocked by taste-guard rule `{rule_id}`: the proposed content matches a reviewed team convention."]
    if message:
        lines.append(message)
    lines.append(
        "This convention lives in .farrier/preferences.json and its AGENTS.md line; rewrite the edit to satisfy it, "
        "or ask the user to relax guards.tasteGuard in .farrier.json if the rule no longer applies."
    )
    return "\n".join(lines)


def main() -> int:
    payload = read_payload()

    if payload.get("hook_event_name") != "PreToolUse":
        emit_deny("Blocked edit because the hook event contract is invalid. Retry the operation.")
        return 0

    tool_name = payload.get("tool_name")
    if tool_name not in {"Edit", "Write"}:
        return 0

    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return 0

    content = proposed_content(tool_name, tool_input)
    if content is None:
        return 0

    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()

    config = load_config(cwd)
    if config is None:
        log_event(cwd, HOOK_NAME, "PreToolUse", "error:manifest-unreadable")
        return 0
    if config.get("enabled") is False:
        return 0
    rules = config.get("rules")
    if not isinstance(rules, list) or not rules:
        return 0

    try:
        violation = first_violation(content, rules)
    except Exception:  # noqa: BLE001 - a guard must never block on its own fault
        log_event(cwd, HOOK_NAME, "PreToolUse", "error:match-failed")
        return 0

    if violation is not None:
        rule_id, message = violation
        log_event(cwd, HOOK_NAME, "PreToolUse", "blocked", rule=rule_id)
        emit_deny(deny_reason(rule_id, message))
        return 0

    log_event(cwd, HOOK_NAME, "PreToolUse", "allowed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

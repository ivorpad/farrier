#!/usr/bin/env python3
"""Shared PreToolUse hook that enforces one declarative tool-policy rules file."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any


RULES_RELATIVE_PATH = Path(".claude") / "hooks" / "tool-policy-rules.json"


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


def regex_flags(flags: Any) -> int:
    if not isinstance(flags, str):
        return 0

    value = 0
    if "i" in flags:
        value |= re.IGNORECASE
    if "m" in flags:
        value |= re.MULTILINE
    if "s" in flags:
        value |= re.DOTALL

    return value


def load_rules(cwd: str) -> list[dict[str, Any]]:
    rules_path = Path(cwd) / RULES_RELATIVE_PATH

    try:
        data = json.loads(rules_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    if not isinstance(data, dict):
        return []

    rules = data.get("rules")
    if not isinstance(rules, list):
        return []

    return [rule for rule in rules if isinstance(rule, dict)]


def rule_matches(rule: dict[str, Any], command: str) -> bool:
    if rule.get("tool") != "Bash":
        return False

    pattern = rule.get("commandPattern")
    if not isinstance(pattern, str) or pattern == "":
        return False

    try:
        compiled = re.compile(pattern, regex_flags(rule.get("flags")))
    except re.error:
        return False

    return compiled.search(command) is not None


def deny_reason(rule: dict[str, Any]) -> str:
    rule_id = rule.get("id") if isinstance(rule.get("id"), str) else "unknown-rule"
    message = (
        rule.get("message")
        if isinstance(rule.get("message"), str)
        else "Command is blocked by project policy."
    )
    redirect = (
        rule.get("redirect")
        if isinstance(rule.get("redirect"), str)
        else "Use the project-approved tool instead."
    )

    return f"{message}\nRedirect: {redirect}\nRule: {rule_id}"


def main() -> int:
    payload = read_payload()

    if payload.get("tool_name") != "Bash":
        return 0

    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return 0

    command = tool_input.get("command")
    if not isinstance(command, str) or command.strip() == "":
        return 0

    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()

    for rule in load_rules(cwd):
        if rule_matches(rule, command):
            emit_deny(deny_reason(rule))
            return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

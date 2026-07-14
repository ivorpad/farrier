#!/usr/bin/env python3
"""Shared PreToolUse hook that enforces one declarative tool-policy rules file."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from _hook_runtime import read_project_text


RULES_RELATIVE_PATH = Path(".claude") / "hooks" / "tool-policy-rules.json"
MAX_PAYLOAD_BYTES = 256 * 1024
RULE_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
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


def emit_deny(reason: str) -> None:
    reason = redact_text(reason).encode("utf-8")[:2000].decode("utf-8", errors="ignore")
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
        emit_deny("Blocked malformed PreToolUse input: payload exceeds 256 KiB. Retry with a bounded command.")
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


def regex_flags(flags: str) -> int:
    value = 0
    if "i" in flags:
        value |= re.IGNORECASE
    if "m" in flags:
        value |= re.MULTILINE
    if "s" in flags:
        value |= re.DOTALL
    return value


def malformed_rules(message: str) -> tuple[list[dict[str, Any]], str]:
    return [], f"Blocked Bash because {RULES_RELATIVE_PATH} {message}. Run farrier doctor, then farrier update --yes."


def load_rules(cwd: str) -> tuple[list[dict[str, Any]], str | None]:
    text, error = read_project_text(cwd, RULES_RELATIVE_PATH.as_posix(), MAX_PAYLOAD_BYTES)
    if error is not None or text is None:
        return malformed_rules(f"is missing, unreadable, or invalid JSON ({error or 'safe read failed'})")
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError, RecursionError):
        return malformed_rules("is missing, unreadable, or invalid JSON")

    if not isinstance(data, dict):
        return malformed_rules("root must be an object")
    if data.get("version") != 1:
        return malformed_rules("version must be exactly 1")
    rules = data.get("rules")
    if not isinstance(rules, list):
        return malformed_rules("rules must be an array")

    required = ("id", "description", "tool", "commandPattern", "message", "redirect")
    seen: set[str] = set()
    for index, rule in enumerate(rules):
        if not isinstance(rule, dict):
            return malformed_rules(f"rule {index} must be an object")
        for field in required:
            if not isinstance(rule.get(field), str) or not rule[field].strip():
                return malformed_rules(f"rule {index} field {field} must be a non-empty string")
        if rule["tool"] != "Bash":
            return malformed_rules(f"rule {index} tool must be exactly Bash")
        rule_id = rule["id"]
        if RULE_ID.fullmatch(rule_id) is None:
            return malformed_rules(f"rule {index} id must be kebab-case")
        if rule_id in seen:
            return malformed_rules(f"contains duplicate rule id {rule_id}")
        seen.add(rule_id)
        flags = rule.get("flags", "")
        if (
            not isinstance(flags, str)
            or ("flags" in rule and flags == "")
            or any(flag not in "ims" for flag in flags)
            or len(set(flags)) != len(flags)
        ):
            return malformed_rules(f"rule {rule_id} flags must contain each optional i, m, or s at most once")
        try:
            re.compile(rule["commandPattern"], regex_flags(flags))
        except re.error:
            return malformed_rules(f"rule {rule_id} commandPattern is invalid")
    return rules, None


def rule_matches(rule: dict[str, Any], command: str) -> bool:
    if rule.get("tool") != "Bash":
        return False

    pattern = rule.get("commandPattern")
    if not isinstance(pattern, str) or pattern == "":
        return False

    try:
        compiled = re.compile(pattern, regex_flags(rule.get("flags", "")))
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
    if payload.get("hook_event_name") != "PreToolUse":
        emit_deny("Blocked Bash because the hook event contract is invalid. Retry the operation.")
        return 0

    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        emit_deny("Blocked ambiguous Bash mutation: tool_input must be an object.")
        return 0

    command = tool_input.get("command")
    if not isinstance(command, str) or command.strip() == "":
        emit_deny("Blocked ambiguous Bash mutation: command must be a non-empty string.")
        return 0

    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()

    rules, error = load_rules(cwd)
    if error:
        emit_deny(error)
        return 0
    for rule in rules:
        if rule_matches(rule, command):
            emit_deny(deny_reason(rule))
            return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

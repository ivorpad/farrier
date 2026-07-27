#!/usr/bin/env python3
"""UserPromptSubmit hook that injects the team's reviewed preferences as context.

Reads .farrier/preferences.json (farrier's preference KB) and, if it holds any
reviewed rules, injects up to 20 of them — one line each, under a one-line
header — as additional context on every user prompt. v1 does no domain matching:
the whole KB is single sentences, so the budget is trivial and all rules go in.

This is the Claude-side just-in-time reminder half; the compiler's declarative
AGENTS.md rendering is the codex-side counterpart (codex hook dispatch is
unreliable). It FAILS OPEN unconditionally: a missing file, malformed KB, or any
other error yields no output and exit 0. It never blocks a prompt.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from _hook_runtime import log_event, read_project_text

MAX_PAYLOAD_BYTES = 1024 * 1024
MAX_KB_BYTES = 256 * 1024
MAX_INJECTED_RULES = 20
MAX_RULE_CHARS = 300

HOOK_NAME = "taste-context"
KB_RELATIVE = ".farrier/preferences.json"
HEADER = "This project's reviewed team preferences (from .farrier/preferences.json) — follow them unless the user overrides:"


def load_rules(cwd: str) -> list[str]:
    """Up to MAX_INJECTED_RULES rule sentences from the KB, or [] on any problem."""
    text, error = read_project_text(cwd, KB_RELATIVE, MAX_KB_BYTES)
    if error is not None or text is None or not text.strip():
        return []
    try:
        kb = json.loads(text)
    except (json.JSONDecodeError, ValueError, RecursionError):
        return []
    if not isinstance(kb, dict) or kb.get("version") != 1:
        return []
    rules = kb.get("rules")
    if not isinstance(rules, list):
        return []
    lines: list[str] = []
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        sentence = rule.get("rule")
        if isinstance(sentence, str) and sentence.strip():
            lines.append(sentence.strip()[:MAX_RULE_CHARS])
        if len(lines) >= MAX_INJECTED_RULES:
            break
    return lines


def format_context(rules: list[str]) -> str:
    body = "\n".join(f"- {rule}" for rule in rules)
    return f"{HEADER}\n{body}"


def read_payload() -> dict[str, Any] | None:
    raw = sys.stdin.read(MAX_PAYLOAD_BYTES + 1)
    if len(raw.encode("utf-8")) > MAX_PAYLOAD_BYTES or not raw.strip():
        return None
    payload = json.loads(raw)
    return payload if isinstance(payload, dict) else None


def main() -> int:
    try:
        payload = read_payload()
        if payload is None:
            return 0
        event = payload.get("hook_event_name")
        if event is not None and event != "UserPromptSubmit":
            return 0
        cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()

        rules = load_rules(cwd)
        if not rules:
            return 0

        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "UserPromptSubmit",
                        "additionalContext": format_context(rules),
                    }
                }
            )
        )
        log_event(cwd, HOOK_NAME, "UserPromptSubmit", "injected", detail=f"{len(rules)} rule(s)")
        return 0
    except Exception:  # noqa: BLE001 - context injection must never block a prompt
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

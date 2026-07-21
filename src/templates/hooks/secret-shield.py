#!/usr/bin/env python3
"""Shared PreToolUse hook for supported Claude and Codex secret-access payloads."""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

from _hook_runtime import log_event

MAX_PAYLOAD_BYTES = 256 * 1024

SECRET_BASENAMES = {
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
}

SAFE_ENV_EXAMPLE_BASENAMES = {
    ".env.example",
    ".env.sample",
    ".env.template",
    ".env.defaults",
}


def redact_detail(text: str) -> str:
    """Short, value-free description of the denied input for the event log."""
    collapsed = re.sub(r"\s+", " ", text).strip()
    # Never persist anything that looks like an assignment's right-hand side.
    collapsed = re.sub(r"([A-Za-z_][A-Za-z0-9_]*)=(\S+)", r"\1=[REDACTED]", collapsed)
    return collapsed[:160]


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
        emit_deny("Blocked malformed PreToolUse input: payload exceeds 256 KiB. Retry the operation with a bounded tool payload.")
        sys.exit(0)
    if not raw.strip():
        emit_deny("Blocked malformed PreToolUse input: expected one JSON object. Retry the operation.")
        sys.exit(0)

    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, ValueError, RecursionError):
        emit_deny("Blocked malformed PreToolUse input. Retry without embedding secret material.")
        sys.exit(0)
    if not isinstance(payload, dict):
        emit_deny("Blocked malformed PreToolUse input: JSON root must be an object.")
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


def normalized_basename(path: str) -> str:
    return os.path.basename(path).strip().strip("\\\"\'`").rstrip(".,;:)]}").lower()


def is_secret_path(text: str) -> bool:
    normalized = text.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part]

    for part in parts:
        base = normalized_basename(part)
        # Glob forms like `.env*` or `*.key` reach the same files; match them
        # with the wildcard glyphs stripped (2026-07-21 eval: a Grep over
        # `.env*` with content output slipped past the literal matching).
        unglobbed = base.strip("*?")

        if base in SAFE_ENV_EXAMPLE_BASENAMES or unglobbed in SAFE_ENV_EXAMPLE_BASENAMES:
            continue

        if unglobbed == ".env" or unglobbed.startswith(".env."):
            return True

        if base in SECRET_BASENAMES or unglobbed in SECRET_BASENAMES:
            return True

        if unglobbed.endswith(".pem") or unglobbed.endswith(".key"):
            return True

    return False


def plausible_path_token(candidate: str) -> bool:
    """Regex fragments in commands (e.g. `ENV\\.key\\?`) are not paths.
    Windows-style backslash paths (backslash before a word character) are."""
    if any(ch in candidate for ch in "|()[]{}$^"):
        return False
    # Collapse shell-escaped doubled backslashes so Windows-style paths
    # (`.\\SSH\\id_ed25519`) survive the regex-escape test below.
    collapsed = candidate.replace("\\\\", "\\")
    return re.search(r"\\[^A-Za-z0-9_]", collapsed) is None


def looks_secretish(text: str) -> bool:
    # Path matching applies per whitespace-separated word. Matching a whole
    # command line as one path glues quoted arguments together and produced
    # false denials of example-file discovery commands (2026-07-21 round 2);
    # per-word matching still catches path arguments like nested/.env.local.
    for word in re.split(r"\s+", text):
        if word and plausible_path_token(word) and is_secret_path(word):
            return True

    token_pattern = re.compile(
        r"(^|[\s\"'])"
        r"(?P<candidate>"
        r"\.env(?:\.[^\s\"']*)?[*?]*"
        r"|id_rsa"
        r"|id_dsa"
        r"|id_ecdsa"
        r"|id_ed25519"
        r"|[^\s\"']+\.(?:pem|key)[*?]*"
        r")"
        r"($|[\s\"'])",
        re.IGNORECASE,
    )

    return any(
        plausible_path_token(match.group("candidate")) and is_secret_path(match.group("candidate"))
        for match in token_pattern.finditer(text)
    )


def should_deny(payload: dict[str, Any]) -> str | None:
    """The offending input text when the call must be denied, else None."""
    tool_name = payload.get("tool_name")
    tool_input = payload.get("tool_input", {})

    if tool_name not in {"Read", "Bash", "Grep"}:
        return None
    if payload.get("hook_event_name") != "PreToolUse" or not isinstance(tool_input, dict):
        return "<malformed payload>"

    for text in iter_strings(tool_input):
        if looks_secretish(text):
            return text

    return None


def main() -> int:
    payload = read_payload()
    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()
    tool_name = payload.get("tool_name")

    denied_text = should_deny(payload)
    if denied_text is not None:
        log_event(cwd, "secret-shield", "PreToolUse", "blocked", rule="secret-access", detail=redact_detail(denied_text))
        emit_deny(
            "Blocked secret access. Do not read real .env* files or private key material; tracked examples such as .env.example are allowed."
        )
    elif tool_name in {"Read", "Bash", "Grep"}:
        log_event(cwd, "secret-shield", "PreToolUse", "allowed")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Shared PreToolUse hook for supported Claude and Codex secret-access payloads."""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any

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

        if base in SAFE_ENV_EXAMPLE_BASENAMES:
            continue

        if base == ".env" or base.startswith(".env."):
            return True

        if base in SECRET_BASENAMES:
            return True

        if base.endswith(".pem") or base.endswith(".key"):
            return True

    return False


def looks_secretish(text: str) -> bool:
    if is_secret_path(text):
        return True

    token_pattern = re.compile(
        r"(^|[\s\"'])"
        r"(?P<candidate>"
        r"\.env(?:\.[^\s\"']*)?"
        r"|id_rsa"
        r"|id_dsa"
        r"|id_ecdsa"
        r"|id_ed25519"
        r"|[^\s\"']+\.(?:pem|key)"
        r")"
        r"($|[\s\"'])",
        re.IGNORECASE,
    )

    return any(
        is_secret_path(match.group("candidate"))
        for match in token_pattern.finditer(text)
    )


def should_deny(payload: dict[str, Any]) -> bool:
    tool_name = payload.get("tool_name")
    tool_input = payload.get("tool_input", {})

    if tool_name not in {"Read", "Bash", "Grep"}:
        return False
    if payload.get("hook_event_name") != "PreToolUse" or not isinstance(tool_input, dict):
        return True

    for text in iter_strings(tool_input):
        if looks_secretish(text):
            return True

    return False


def main() -> int:
    payload = read_payload()

    if should_deny(payload):
        emit_deny(
            "Blocked secret access. Do not read real .env* files or private key material; tracked examples such as .env.example are allowed."
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

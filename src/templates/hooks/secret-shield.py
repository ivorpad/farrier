#!/usr/bin/env python3
"""Claude Code PreToolUse hook that blocks reads of env files and private keys."""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any


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
        if looks_secretish(raw):
            emit_deny(
                "Blocked possible secret access. Do not read real .env* or private key files; use tracked examples or ask the user."
            )
            sys.exit(0)
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


def normalized_basename(path: str) -> str:
    return os.path.basename(path).rstrip(".,;:)]}")


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
        r"($|[\s\"'])"
    )

    return any(is_secret_path(match.group("candidate")) for match in token_pattern.finditer(text))


def should_deny(payload: dict[str, Any]) -> bool:
    tool_name = payload.get("tool_name")
    tool_input = payload.get("tool_input", {})

    if tool_name not in {"Read", "Bash", "Grep"}:
        return False

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

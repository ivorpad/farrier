#!/usr/bin/env python3
"""Shared PreToolUse hook that denies staging or committing oversized files.

Parameterized by `guards.largeFileCommit` in `.farrier.json`:
  maxBytes  positive integer size threshold (default 5 MiB)
  message   optional extra teaching line appended to the deny reason
  enabled   set false to turn the guard off without uninstalling it

The guard inspects only `git add` / `git commit` commands. Infrastructure
failures (git missing, repository unreadable, unparseable command) fail OPEN
with a logged event; malformed hook input fails closed like every other
PreToolUse blocker.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import stat
import sys
from typing import Any

from _hook_runtime import log_event, read_project_text, run_bounded_process

MAX_PAYLOAD_BYTES = 256 * 1024
MAX_MANIFEST_BYTES = 256 * 1024
MAX_GIT_OUTPUT_BYTES = 512 * 1024
GIT_TIMEOUT_SECONDS = 5.0
MAX_CANDIDATE_FILES = 2000
MAX_REPORTED_VIOLATIONS = 5
DEFAULT_MAX_BYTES = 5 * 1024 * 1024

REDACTION_PATTERNS = (
    (re.compile(r"-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----"), "[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"), "[REDACTED_TOKEN]"),
    (re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}"), "Bearer [REDACTED_TOKEN]"),
    (re.compile(r"(?i)\b([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})\b"), "[REDACTED_EMAIL]"),
    (re.compile(r"(?i)\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+"), r"\1=[REDACTED]"),
)

SEGMENT_SPLIT = re.compile(r"(?:\|\||&&|;|\||\n)")

HOOK_NAME = "large-file-commit-guard"


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


def load_config(cwd: str) -> dict[str, Any] | None:
    """Return guards.largeFileCommit or None when the manifest is unreadable."""
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
    config = guards.get("largeFileCommit") if isinstance(guards, dict) else None
    return config if isinstance(config, dict) else {}


def max_bytes_from(config: dict[str, Any]) -> int:
    value = config.get("maxBytes")
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return DEFAULT_MAX_BYTES
    return value


class GitInvocation:
    """One parsed `git add` / `git commit` from a shell command string."""

    def __init__(self, subcommand: str, run_dir: str) -> None:
        self.subcommand = subcommand
        self.run_dir = run_dir
        self.pathspecs: list[str] = []
        self.all_flag = False
        self.update_flag = False
        self.dry_run = False
        self.unparseable = False


def is_env_assignment(token: str) -> bool:
    return re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", token) is not None


def combined_short_flags(token: str) -> str:
    """The letters of a combined short option such as `-am` -> `am`."""
    if len(token) > 1 and token[0] == "-" and token[1] != "-":
        return token[1:]
    return ""


def parse_git_invocations(command: str, cwd: str) -> list[GitInvocation]:
    """Parse every `git add`/`git commit` in the command; unparseable segments
    yield an invocation flagged `unparseable` so the caller can fail open."""
    invocations: list[GitInvocation] = []

    for segment in SEGMENT_SPLIT.split(command):
        segment = segment.strip()
        if not segment or "git" not in segment:
            continue
        try:
            tokens = shlex.split(segment, posix=True)
        except ValueError:
            if re.search(r"\bgit\b", segment) and re.search(r"\b(add|commit)\b", segment):
                invocation = GitInvocation("add", cwd)
                invocation.unparseable = True
                invocations.append(invocation)
            continue

        index = 0
        while index < len(tokens) and is_env_assignment(tokens[index]):
            index += 1
        if index >= len(tokens) or os.path.basename(tokens[index]) != "git":
            continue
        index += 1

        run_dir = cwd
        subcommand: str | None = None
        exotic = False
        while index < len(tokens):
            token = tokens[index]
            if token == "-C" and index + 1 < len(tokens):
                run_dir = os.path.join(run_dir, tokens[index + 1])
                index += 2
                continue
            if token == "-c" and index + 1 < len(tokens):
                index += 2
                continue
            if token.startswith("--git-dir") or token.startswith("--work-tree"):
                exotic = True
                break
            if token.startswith("-"):
                index += 1
                continue
            subcommand = token
            index += 1
            break

        if subcommand not in {"add", "commit"}:
            continue

        invocation = GitInvocation(subcommand, run_dir)
        if exotic:
            invocation.unparseable = True
            invocations.append(invocation)
            continue

        after_separator = False
        while index < len(tokens):
            token = tokens[index]
            if after_separator:
                invocation.pathspecs.append(token)
                index += 1
                continue
            if token == "--":
                after_separator = True
                index += 1
                continue
            if token in {"--all", "--no-ignore-removal"}:
                invocation.all_flag = True
            elif token in {"--update"}:
                invocation.update_flag = True
            elif token == "--dry-run":
                invocation.dry_run = True
            elif token in {"--pathspec-from-file", "--pathspec-from-file=-"} or token.startswith("--pathspec-from-file"):
                invocation.unparseable = True
            elif token in {"-m", "--message", "-F", "--file", "--author", "--date", "-t", "--template", "--fixup", "--squash", "--chmod"}:
                index += 1  # consumes a value token
            elif token.startswith("--"):
                pass
            elif token.startswith("-"):
                flags = combined_short_flags(token)
                if "a" in flags:
                    invocation.all_flag = True
                if "u" in flags:
                    invocation.update_flag = True
                if "n" in flags and invocation.subcommand == "add":
                    invocation.dry_run = True
                if invocation.subcommand == "commit" and flags.endswith("m"):
                    index += 1  # `-m msg` / `-am msg`: the message is the next token
            else:
                invocation.pathspecs.append(token)
            index += 1

        invocations.append(invocation)

    return invocations


def git_lines(args: list[str], run_dir: str) -> list[str] | None:
    """Run one bounded NUL-separated git listing; None means fail open."""
    returncode, output, status, _ = run_bounded_process(
        args,
        cwd=run_dir,
        timeout_seconds=GIT_TIMEOUT_SECONDS,
        max_output_bytes=MAX_GIT_OUTPUT_BYTES,
    )
    if status != "ok" or returncode != 0:
        return None
    return [line for line in output.split("\0") if line]


def candidate_files(invocation: GitInvocation) -> list[tuple[str, str]] | None:
    """(base_dir, relative_path) pairs the command would introduce to history.

    None means the candidates could not be established (fail open).
    """
    run_dir = invocation.run_dir
    candidates: list[tuple[str, str]] = []

    if invocation.subcommand == "add":
        args = ["git", "ls-files", "-z", "--exclude-standard"]
        args.extend(["-m"] if invocation.update_flag and not invocation.all_flag and not invocation.pathspecs else ["-o", "-m"])
        if invocation.pathspecs:
            args.append("--")
            args.extend(invocation.pathspecs)
        elif not (invocation.all_flag or invocation.update_flag):
            # `git add` with no pathspec and no -A/-u stages nothing.
            return []
        listed = git_lines(args, run_dir)
        if listed is None:
            return None
        candidates.extend((run_dir, path) for path in listed)
        return candidates

    # commit: whatever is staged, plus tracked modifications swept in by
    # `-a` or an explicit pathspec.
    staged = git_lines(["git", "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], run_dir)
    if staged is None:
        return None
    root_lines = git_lines(["git", "rev-parse", "--show-toplevel"], run_dir)
    root = root_lines[0].strip() if root_lines and root_lines[0].strip() else None
    if root is None:
        return None
    candidates.extend((root, path.strip()) for path in staged)

    if invocation.all_flag or invocation.pathspecs:
        args = ["git", "diff", "--name-only", "-z", "--diff-filter=ACMR"]
        if invocation.pathspecs:
            args.append("--")
            args.extend(invocation.pathspecs)
        listed = git_lines(args, run_dir)
        if listed is None:
            return None
        # Diff output is repo-root-relative; resolve like the staged paths.
        candidates.extend((root, path.strip()) for path in listed)

    return candidates


def oversized(candidates: list[tuple[str, str]], limit: int) -> list[tuple[str, int]]:
    violations: list[tuple[str, int]] = []
    seen: set[str] = set()
    for base, path in candidates[:MAX_CANDIDATE_FILES]:
        absolute = os.path.join(base, path)
        if absolute in seen:
            continue
        seen.add(absolute)
        try:
            stats = os.lstat(absolute)
        except OSError:
            continue
        if not stat.S_ISREG(stats.st_mode):
            continue
        if stats.st_size > limit:
            violations.append((path, stats.st_size))
    return violations


def mib(size: int) -> str:
    return f"{size / (1024 * 1024):.1f} MiB"


def deny_reason(subcommand: str, violations: list[tuple[str, int]], limit: int, extra_message: str | None) -> str:
    lines = [
        f"Blocked `git {subcommand}`: {len(violations)} file(s) exceed the {mib(limit)} limit from guards.largeFileCommit.maxBytes in .farrier.json."
    ]
    for path, size in violations[:MAX_REPORTED_VIOLATIONS]:
        lines.append(f"- `{path}` ({mib(size)})")
    if len(violations) > MAX_REPORTED_VIOLATIONS:
        lines.append(f"- ...and {len(violations) - MAX_REPORTED_VIOLATIONS} more")
    lines.append(
        "Large artifacts in git history force history rewrites later. Add the file to .gitignore or use Git LFS; if it truly belongs in history, ask the user to raise guards.largeFileCommit.maxBytes."
    )
    if extra_message:
        lines.append(extra_message)
    return "\n".join(lines)


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

    invocations = parse_git_invocations(command, cwd)
    if not invocations:
        return 0

    config = load_config(cwd)
    if config is None:
        log_event(cwd, HOOK_NAME, "PreToolUse", "error:manifest-unreadable")
        return 0
    if config.get("enabled") is False:
        return 0
    limit = max_bytes_from(config)
    extra_message = config.get("message") if isinstance(config.get("message"), str) else None

    for invocation in invocations:
        if invocation.dry_run:
            continue
        if invocation.unparseable:
            log_event(cwd, HOOK_NAME, "PreToolUse", "error:unparseable-command", detail=redact_text(command)[:200])
            continue
        candidates = candidate_files(invocation)
        if candidates is None:
            log_event(cwd, HOOK_NAME, "PreToolUse", "error:git-listing-failed", rule=invocation.subcommand)
            continue
        violations = oversized(candidates, limit)
        if violations:
            detail = redact_text(", ".join(f"{path} ({size}B)" for path, size in violations[:MAX_REPORTED_VIOLATIONS]))
            log_event(cwd, HOOK_NAME, "PreToolUse", "blocked", rule=invocation.subcommand, detail=detail)
            emit_deny(deny_reason(invocation.subcommand, violations, limit, extra_message))
            return 0

    log_event(cwd, HOOK_NAME, "PreToolUse", "allowed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

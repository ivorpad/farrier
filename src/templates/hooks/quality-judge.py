#!/usr/bin/env python3
"""Shared PostToolUse hook for deterministic and optional LLM quality review."""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from typing import Any

from _hook_runtime import file_fingerprint, open_project_regular, read_project_text, run_bounded_process


EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"}
PATH_KEYS = {"file_path", "path", "notebook_path"}
PATCH_HEADER = re.compile(
    r"^\*\*\* (?:Update|Add|Delete) File: (?P<path>.+?)\s*$", re.MULTILINE
)
DEFAULT_MAX_FILE_LINES = 500
DEFAULT_TIMEOUT_MS = 15000
MAX_EMBEDDED_CONTENT_BYTES = 30 * 1024
MAX_PAYLOAD_BYTES = 256 * 1024
MAX_CONTEXT_BYTES = 16 * 1024
MAX_BACKEND_OUTPUT_BYTES = 64 * 1024
MAX_TIMEOUT_MS = 120000
MAX_COMBINED_PROMPT_BYTES = 64 * 1024
MAX_MANIFEST_BYTES = 256 * 1024
MAX_FILE_LINES = 100000
MAX_EDIT_SCAN_BYTES = 1024 * 1024

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

FALLBACK_PROMPT = """You are Farrier's per-edit semantic quality judge.

Review the edited file content and return JSON only with this exact shape:
{
  "severity": "pass | advisory | serious",
  "summary": "short summary",
  "findings": [
    {
      "path": "path",
      "message": "what is wrong",
      "suggestion": "what to do instead"
    }
  ]
}

Judge only gross issues: misplaced business logic, poor cohesion, obvious language-practice problems,
or changes that appear unrelated to the edited module. Avoid nitpicks. Use "serious" only when the
change is likely to cause real maintenance or correctness harm.
"""


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read(MAX_PAYLOAD_BYTES + 1)
    if len(raw.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        emit_posttool_context("quality hook input exceeded 256 KiB; deterministic feedback was skipped. Split the edit and run just check.")
        sys.exit(0)
    if not raw.strip():
        emit_posttool_context("quality hook received malformed empty input; run just check.")
        sys.exit(0)

    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, ValueError, RecursionError):
        emit_posttool_context("quality hook received malformed JSON; run just check.")
        sys.exit(0)
    if not isinstance(payload, dict):
        emit_posttool_context("quality hook JSON root must be an object; run just check.")
        sys.exit(0)
    return payload


def load_manifest(cwd: str) -> tuple[dict[str, Any], str | None]:
    text, error = read_project_text(cwd, ".farrier.json", MAX_MANIFEST_BYTES)
    if error is not None or text is None:
        return {}, error
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError, RecursionError):
        return {}, "contains invalid JSON"
    return (data, None) if isinstance(data, dict) else ({}, "root must be an object")


def int_from(value: Any, default: int) -> int:
    if isinstance(value, int) and value > 0:
        return value
    return default


def str_from(value: Any, default: str) -> str:
    if isinstance(value, str) and value.strip():
        return value
    return default


def iter_path_values(value: Any) -> list[str]:
    paths: list[str] = []

    if isinstance(value, dict):
        for key, item in value.items():
            if key in PATH_KEYS and isinstance(item, str):
                paths.append(item)
                continue

            if isinstance(item, (dict, list)):
                paths.extend(iter_path_values(item))

    elif isinstance(value, list):
        for item in value:
            if isinstance(item, (dict, list)):
                paths.extend(iter_path_values(item))

    return paths


def patch_paths(tool_input: dict[str, Any]) -> list[str]:
    command = tool_input.get("command")
    if not isinstance(command, str):
        return []
    return [match.group("path") for match in PATCH_HEADER.finditer(command)]


def normalize_project_path(path: str) -> str:
    normalized = path.replace("\\", "/").strip().strip("\"'")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def is_hook_path(path: str) -> bool:
    normalized = normalize_project_path(path)
    return normalized.startswith(".claude/hooks/") or "/.claude/hooks/" in normalized


def unique_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []

    for path in paths:
        normalized = normalize_project_path(path)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)

    return result


def capped_text(text: str, limit: int = MAX_EMBEDDED_CONTENT_BYTES) -> str:
    if not isinstance(limit, int) or isinstance(limit, bool) or limit <= 0:
        raise ValueError("text limit must be a positive integer")
    redacted = redact_text(text)
    encoded = redacted.encode("utf-8")
    if len(encoded) <= limit:
        return redacted
    marker = b"\n[truncated]"
    if limit <= len(marker):
        return encoded[:limit].decode("utf-8", errors="ignore")
    head = encoded[: limit - len(marker)].decode("utf-8", errors="ignore")
    return f"{head}\n[truncated]"


def max_file_lines(manifest: dict[str, Any]) -> tuple[int | None, str | None]:
    quality = manifest.get("quality")
    if not isinstance(quality, dict):
        return DEFAULT_MAX_FILE_LINES, None
    value = quality.get("maxFileLines", DEFAULT_MAX_FILE_LINES)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0 or value > MAX_FILE_LINES:
        return None, f"quality.maxFileLines must be an integer from 1 through {MAX_FILE_LINES}"
    return value, None


def per_edit_config(manifest: dict[str, Any]) -> dict[str, Any]:
    judge = manifest.get("judge")
    if not isinstance(judge, dict):
        return {}

    per_edit = judge.get("perEdit")
    return per_edit if isinstance(per_edit, dict) else {}


def validate_per_edit_config(config: dict[str, Any]) -> str | None:
    if config.get("enabled") is not True:
        return "judge.perEdit.enabled must be true or false"
    backend = config.get("backend")
    if backend is not None and backend not in {"claude", "codex"}:
        return 'judge.perEdit.backend must be "claude" or "codex"'
    model = config.get("model")
    if model is not None and (not isinstance(model, str) or not model.strip()):
        return "judge.perEdit.model must be a non-empty string"
    timeout = config.get("timeoutMs")
    if timeout is not None and (
        isinstance(timeout, bool)
        or not isinstance(timeout, (int, float))
        or timeout <= 0
        or timeout > MAX_TIMEOUT_MS
    ):
        return f"judge.perEdit.timeoutMs must be greater than zero and at most {MAX_TIMEOUT_MS}"
    prompt = config.get("prompt")
    if prompt is not None and (not isinstance(prompt, str) or not prompt.strip()):
        return "judge.perEdit.prompt must be a non-empty project-relative path"
    return None


def prompt_text(cwd: str, config: dict[str, Any]) -> tuple[str | None, str | None]:
    configured = config.get("prompt")
    if configured is None:
        return capped_text(FALLBACK_PROMPT), None
    assert isinstance(configured, str)
    text, error = read_project_text(cwd, configured, MAX_EMBEDDED_CONTENT_BYTES)
    if error is not None or text is None:
        if error == "is missing":
            error = "is missing or unreadable"
        return None, f"judge.perEdit.prompt {error}"
    if not text.strip():
        return None, "judge.perEdit.prompt must not be empty"
    return capped_text(text), None


def inspect_edited_file(cwd: str, path: str, max_lines: int) -> dict[str, Any]:
    descriptor, error = open_project_regular(cwd, path)
    if descriptor is None:
        if error == "is missing":
            return {"path": path, "missing": True}
        return {"path": path, "lineCount": 0, "content": "", "warning": error}
    prefix = bytearray()
    line_count = 0
    scanned = 0
    eof = False
    last_byte: int | None = None
    try:
        before = os.fstat(descriptor)
        initial_size = before.st_size
        while scanned < MAX_EDIT_SCAN_BYTES and line_count <= max_lines:
            chunk = os.read(descriptor, min(8192, MAX_EDIT_SCAN_BYTES - scanned))
            if not chunk:
                eof = True
                break
            scanned += len(chunk)
            last_byte = chunk[-1]
            line_count += chunk.count(b"\n")
            if len(prefix) < MAX_EMBEDDED_CONTENT_BYTES:
                prefix.extend(chunk[: MAX_EMBEDDED_CONTENT_BYTES - len(prefix)])
        after = os.fstat(descriptor)
        if file_fingerprint(before) != file_fingerprint(after):
            return {"path": path, "lineCount": 0, "content": "", "warning": "changed identity or contents while being read"}
    except OSError:
        return {"path": path, "lineCount": 0, "content": "", "warning": "could not be read safely"}
    finally:
        os.close(descriptor)
    if eof and scanned > 0 and last_byte != ord("\n"):
        line_count += 1
    content = prefix.decode("utf-8", errors="replace")
    if initial_size > len(prefix):
        content += "\n[truncated]"
    result: dict[str, Any] = {
        "path": capped_text(path, 1024),
        "lineCount": line_count,
        "content": capped_text(content),
    }
    if not eof and line_count <= max_lines:
        result["warning"] = f"file inspection stopped after {MAX_EDIT_SCAN_BYTES} bytes; line count is incomplete"
    return result


def edited_files(cwd: str, payload: dict[str, Any], max_lines: int) -> tuple[list[dict[str, Any]], str | None]:
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return [], "recognized edit tool_input must be an object"

    files: list[dict[str, Any]] = []
    paths = (
        patch_paths(tool_input)
        if payload.get("tool_name") == "apply_patch"
        else iter_path_values(tool_input)
    )
    normalized_paths = unique_paths(paths)
    if not normalized_paths:
        return [], "recognized edit payload did not contain an unambiguous file path"
    for path in normalized_paths:
        if is_hook_path(path):
            continue

        inspected = inspect_edited_file(cwd, path, max_lines)
        if not inspected.get("missing"):
            files.append(inspected)

    return files, None


def deterministic_findings(files: list[dict[str, Any]], max_lines: int) -> list[str]:
    findings: list[str] = []

    for file in files:
        warning = file.get("warning")
        if isinstance(warning, str):
            findings.append(f"{file.get('path')}: {warning}; verify the mutation target manually.")
            continue
        line_count = file.get("lineCount")
        path = file.get("path")

        if (
            isinstance(path, str)
            and isinstance(line_count, int)
            and line_count > max_lines
        ):
            findings.append(
                f"{path} is {line_count} lines, exceeding quality.maxFileLines={max_lines}. "
                "Split responsibilities or document the architectural reason for the larger file."
            )

    return findings


def build_combined_prompt(base_prompt: str, files: list[dict[str, Any]]) -> str:
    payload = {
        "event": "PostToolUse",
        "files": files,
    }

    combined = f"{capped_text(base_prompt).strip()}\n\nInput JSON:\n{json.dumps(payload, indent=2)}\n"
    return capped_text(combined, MAX_COMBINED_PROMPT_BYTES)


def backend_command(
    backend: str, model: str, prompt: str
) -> tuple[list[str], str | None] | None:
    if backend == "claude":
        if shutil.which("claude") is None:
            return None
        return (["claude", "-p", "--model", model], prompt)

    if backend == "codex":
        if shutil.which("codex") is None:
            return None
        return (["codex", "exec", "--model", model, prompt], None)

    return None


def run_backend(
    config: dict[str, Any], combined_prompt: str, cwd: str
) -> tuple[dict[str, Any] | None, str | None]:
    if config.get("enabled") is not True:
        return None

    backend = str_from(config.get("backend"), "claude")
    model = str_from(config.get("model"), "haiku")
    timeout_ms = min(int_from(config.get("timeoutMs"), DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS)

    command = backend_command(backend, model, combined_prompt)
    if command is None:
        return None, "semantic quality backend is unavailable"

    args, stdin_text = command

    returncode, output, status = run_bounded_process(
        args,
        cwd=cwd,
        timeout_seconds=timeout_ms / 1000,
        max_output_bytes=MAX_BACKEND_OUTPUT_BYTES,
        stdin_text=stdin_text,
    )
    if status == "overflow":
        return None, f"semantic quality backend output exceeded {MAX_BACKEND_OUTPUT_BYTES} bytes and was terminated"
    if status == "timeout":
        return None, "semantic quality backend timed out and was terminated"
    if status != "ok" or returncode != 0:
        return None, None

    try:
        data = json.loads(output)
    except (json.JSONDecodeError, ValueError, RecursionError):
        return None, None

    return (data, None) if isinstance(data, dict) else (None, None)


def valid_judgement(data: dict[str, Any] | None) -> dict[str, Any] | None:
    if data is None:
        return None

    severity = data.get("severity")
    if severity not in {"pass", "advisory", "serious"}:
        return None

    summary = data.get("summary")
    if not isinstance(summary, str):
        return None

    findings = data.get("findings")
    if not isinstance(findings, list):
        return None

    return data


def judgement_context(judgement: dict[str, Any]) -> str | None:
    severity = judgement.get("severity")
    if severity == "pass":
        return None

    summary = judgement.get("summary")
    if not isinstance(summary, str):
        return None

    lines = [f"semantic quality judge ({severity}): {summary}"]

    findings = judgement.get("findings")
    if isinstance(findings, list):
        for finding in findings:
            if not isinstance(finding, dict):
                continue

            path = finding.get("path")
            message = finding.get("message")
            suggestion = finding.get("suggestion")

            if isinstance(path, str) and isinstance(message, str):
                line = f"- {path}: {message}"
                if isinstance(suggestion, str) and suggestion.strip():
                    line = f"{line} Suggestion: {suggestion}"
                lines.append(line)

    return "\n".join(lines)


def emit_posttool_context(context: str) -> None:
    context = redact_text(context).encode("utf-8")[:MAX_CONTEXT_BYTES].decode("utf-8", errors="ignore")
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": context,
                }
            }
        )
    )


def main() -> int:
    payload = read_payload()

    if payload.get("hook_event_name") != "PostToolUse":
        return 0

    if payload.get("tool_name") not in EDIT_TOOLS:
        return 0

    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else os.getcwd()
    manifest, manifest_error = load_manifest(cwd)
    if not manifest or not isinstance(manifest.get("judge"), dict) or not isinstance(manifest.get("judge", {}).get("perEdit"), dict):
        detail = f": {manifest_error}" if manifest_error else ""
        emit_posttool_context(f"quality hook configuration is missing or malformed{detail}; run farrier doctor and just check.")
        return 0
    max_lines, max_lines_error = max_file_lines(manifest)
    if max_lines_error is not None or max_lines is None:
        emit_posttool_context(f"quality hook configuration is malformed: {max_lines_error}. Run farrier doctor and farrier update --yes.")
        return 0
    files, input_error = edited_files(cwd, payload, max_lines)
    if input_error is not None:
        emit_posttool_context(f"quality hook received malformed or ambiguous input: {input_error}. Run just check manually.")
        return 0

    contexts = deterministic_findings(files, max_lines)

    config = per_edit_config(manifest)
    if config.get("enabled") is not False:
        config_error = validate_per_edit_config(config)
        base_prompt, prompt_error = prompt_text(cwd, config) if config_error is None else (None, None)
        error = config_error or prompt_error
        if error is not None:
            contexts.append(f"quality hook configuration is malformed: {error}. Run farrier doctor and farrier update --yes.")
        elif files and base_prompt is not None:
            backend_result, backend_error = run_backend(config, build_combined_prompt(base_prompt, files), cwd)
            if backend_error is not None:
                contexts.append(f"{backend_error}. Run the generated check manually or disable judge.perEdit explicitly.")
            judgement = valid_judgement(backend_result)
            context = judgement_context(judgement) if judgement is not None else None
            if context is not None:
                contexts.append(context)

    if contexts:
        emit_posttool_context("\n\n".join(contexts))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

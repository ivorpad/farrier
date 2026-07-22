from __future__ import annotations

import json
import os
import selectors
import signal
import stat
import subprocess
import time
from pathlib import Path, PurePosixPath
from typing import Any, NamedTuple

EVENT_LOG_RELATIVE_PARTS = (".farrier", "runtime", "events.jsonl")
MAX_EVENT_LOG_BYTES = 1024 * 1024
MAX_EVENT_DETAIL_CHARS = 2000
STDERR_TAIL_BYTES = 2048


def log_event(
    cwd: str,
    hook: str,
    event: str,
    result: str,
    rule: str | None = None,
    detail: str | None = None,
    usage: dict[str, int] | None = None,
) -> None:
    """Append one JSONL runtime event; never raises so logging cannot break a hook.

    Rotates the previous log aside once it exceeds MAX_EVENT_LOG_BYTES.
    `detail` carries a caller-redacted description (e.g. the denied target or a
    bounded backend-stderr tail) so blocked or failed events are auditable after
    the fact. `usage` records provider-reported token counts for judge events
    (null for the codex backend, which does not surface usage from hooks).
    """
    try:
        directory = os.path.join(cwd, *EVENT_LOG_RELATIVE_PARTS[:-1])
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, EVENT_LOG_RELATIVE_PARTS[-1])
        try:
            if os.path.getsize(path) > MAX_EVENT_LOG_BYTES:
                os.replace(path, f"{path}.1")
        except OSError:
            pass
        entry: dict[str, Any] = {"hook": hook, "event": event, "result": result}
        if rule is not None:
            entry["rule"] = rule
        if detail is not None:
            entry["detail"] = detail[:MAX_EVENT_DETAIL_CHARS]
        if usage is not None:
            entry["usage"] = usage
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def terminate_process(proc: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        try:
            proc.kill()
        except OSError:
            pass


def _close_registered(selector: selectors.BaseSelector, fileobj: object) -> None:
    try:
        selector.unregister(fileobj)
    except (KeyError, ValueError):
        pass
    try:
        fileobj.close()  # type: ignore[attr-defined]
    except OSError:
        pass


def run_bounded_process(
    args: list[str],
    *,
    cwd: str,
    timeout_seconds: float,
    max_output_bytes: int,
    stdin_text: str | None = None,
    merge_stderr: bool = False,
    capture_stderr: bool = False,
) -> tuple[int | None, str, str, str]:
    """Run a bounded child process. Returns (returncode, stdout, status, stderr_tail).

    `stderr_tail` is the last STDERR_TAIL_BYTES of the child's stderr, decoded
    leniently, and is populated only when `capture_stderr` is set and stderr is
    not merged into stdout; otherwise it is "". stderr bytes never count toward
    the stdout `max_output_bytes` overflow bound.
    """
    if timeout_seconds <= 0 or max_output_bytes <= 0:
        return None, "", "error", ""

    if merge_stderr:
        stderr_dest: int = subprocess.STDOUT
    elif capture_stderr:
        stderr_dest = subprocess.PIPE
    else:
        stderr_dest = subprocess.DEVNULL

    started = time.monotonic()
    try:
        proc = subprocess.Popen(
            args,
            cwd=cwd,
            stdin=subprocess.PIPE if stdin_text is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=stderr_dest,
            start_new_session=True,
        )
    except OSError:
        return None, "", "error", ""

    assert proc.stdout is not None
    selector = selectors.DefaultSelector()
    os.set_blocking(proc.stdout.fileno(), False)
    selector.register(proc.stdout, selectors.EVENT_READ, "stdout")

    stderr_buf = bytearray()
    if capture_stderr and not merge_stderr and proc.stderr is not None:
        os.set_blocking(proc.stderr.fileno(), False)
        selector.register(proc.stderr, selectors.EVENT_READ, "stderr")

    pending = stdin_text.encode("utf-8") if stdin_text is not None else b""
    written = 0
    if proc.stdin is not None:
        os.set_blocking(proc.stdin.fileno(), False)
        if pending:
            selector.register(proc.stdin, selectors.EVENT_WRITE, "stdin")
        else:
            proc.stdin.close()

    output = bytearray()
    deadline = started + timeout_seconds
    status = "ok"
    while selector.get_map():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            status = "timeout"
            terminate_process(proc)
            break
        events = selector.select(min(remaining, 0.1))
        if not events:
            if proc.poll() is not None:
                for key in list(selector.get_map().values()):
                    _close_registered(selector, key.fileobj)
            continue
        for key, _ in events:
            if key.data == "stdin":
                try:
                    count = os.write(key.fileobj.fileno(), pending[written : written + 65536])
                except BlockingIOError:
                    continue
                except (BrokenPipeError, OSError):
                    status = "error"
                    terminate_process(proc)
                    break
                written += count
                if written >= len(pending):
                    _close_registered(selector, key.fileobj)
                continue

            if key.data == "stderr":
                # Bounded tail capture only; a stderr read failure never aborts
                # the run and stderr bytes never trip the stdout overflow bound.
                try:
                    chunk = os.read(key.fileobj.fileno(), 4096)
                except BlockingIOError:
                    continue
                except OSError:
                    _close_registered(selector, key.fileobj)
                    continue
                if not chunk:
                    _close_registered(selector, key.fileobj)
                    continue
                stderr_buf.extend(chunk)
                if len(stderr_buf) > STDERR_TAIL_BYTES:
                    del stderr_buf[:-STDERR_TAIL_BYTES]
                continue

            try:
                chunk = os.read(key.fileobj.fileno(), 4096)
            except BlockingIOError:
                continue
            except OSError:
                status = "error"
                terminate_process(proc)
                break
            if not chunk:
                _close_registered(selector, key.fileobj)
                continue
            output.extend(chunk)
            if len(output) > max_output_bytes:
                status = "overflow"
                terminate_process(proc)
                break
        if status != "ok":
            break

    for key in list(selector.get_map().values()):
        _close_registered(selector, key.fileobj)
    selector.close()
    try:
        returncode = proc.wait(timeout=1)
    except subprocess.TimeoutExpired:
        terminate_process(proc)
        returncode = proc.wait()
    bounded = bytes(output[:max_output_bytes]).decode("utf-8", errors="ignore")
    stderr_tail = bytes(stderr_buf).decode("utf-8", errors="ignore")
    return returncode, bounded, status, stderr_tail


def _path_parts(relative: str) -> tuple[list[str] | None, str | None]:
    raw = relative.replace("\\", "/")
    path = PurePosixPath(raw)
    if path.is_absolute() or not raw or any(part in {"", ".", ".."} for part in raw.split("/")):
        return None, "must be a normalized project-relative path without . or .. segments"
    return list(path.parts), None


def open_project_regular(
    root: str | Path, path: str, *, strict_relative: bool = False
) -> tuple[int | None, str | None]:
    root_path = os.path.abspath(os.fspath(root))
    if strict_relative:
        parts, error = _path_parts(path)
        if error is not None:
            return None, error
    else:
        candidate = path if os.path.isabs(path) else os.path.join(root_path, path)
        relative = os.path.relpath(os.path.normpath(candidate), root_path).replace("\\", "/")
        if relative == ".." or relative.startswith("../"):
            return None, "resolves outside the project root"
        parts = list(PurePosixPath(relative).parts)
    assert parts

    nofollow = getattr(os, "O_NOFOLLOW", 0)
    directory = getattr(os, "O_DIRECTORY", 0)
    opened: list[int] = []
    try:
        current = os.open(root_path, os.O_RDONLY | directory | nofollow)
        opened.append(current)
        for part in parts[:-1]:
            current = os.open(part, os.O_RDONLY | directory | nofollow, dir_fd=current)
            opened.append(current)
        target = os.open(parts[-1], os.O_RDONLY | nofollow, dir_fd=current)
        before = os.fstat(target)
        if not stat.S_ISREG(before.st_mode):
            os.close(target)
            return None, "must be a regular non-symlink file"
        return target, None
    except FileNotFoundError:
        return None, "is missing"
    except OSError:
        return None, "is missing, unreadable, or traverses a symlink"
    finally:
        for descriptor in reversed(opened):
            try:
                os.close(descriptor)
            except OSError:
                pass


def read_project_text(
    root: str | Path, relative: str, max_bytes: int
) -> tuple[str | None, str | None]:
    if max_bytes <= 0:
        return None, "has an invalid byte limit"
    descriptor, error = open_project_regular(root, relative, strict_relative=True)
    if descriptor is None:
        return None, error
    try:
        before = os.fstat(descriptor)
        if before.st_size > max_bytes:
            return None, f"exceeds {max_bytes} bytes"
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        after = os.fstat(descriptor)
        if file_fingerprint(before) != file_fingerprint(after) or not stat.S_ISREG(after.st_mode):
            return None, "changed identity or contents while being read"
        data = b"".join(chunks)
        if len(data) > max_bytes or after.st_size > max_bytes:
            return None, f"exceeds {max_bytes} bytes"
        if len(data) != after.st_size:
            return None, "changed size while being read"
        try:
            return data.decode("utf-8"), None
        except UnicodeDecodeError:
            return None, "must contain valid UTF-8"
    except OSError:
        return None, "could not be read safely"
    finally:
        os.close(descriptor)
def file_fingerprint(stats: os.stat_result) -> tuple[int, int, int, int, int]:
    return (stats.st_dev, stats.st_ino, stats.st_size, stats.st_mtime_ns, stats.st_ctime_ns)


REPO_MAP_BEGIN_MARKER = "<!-- farrier:repo-map:begin -->"
REPO_MAP_END_MARKER = "<!-- farrier:repo-map:end -->"
MAX_AGENTS_MD_BYTES = 256 * 1024


def read_repo_map(root: str | Path) -> str | None:
    """Return the generated repo-map section of AGENTS.md, or None when absent.

    Callers bound and redact the returned text before embedding it anywhere.
    """
    text, error = read_project_text(root, "AGENTS.md", MAX_AGENTS_MD_BYTES)
    if error is not None or text is None:
        return None
    start = text.find(REPO_MAP_BEGIN_MARKER)
    if start < 0:
        return None
    start += len(REPO_MAP_BEGIN_MARKER)
    end = text.find(REPO_MAP_END_MARKER, start)
    if end < 0:
        return None
    section = text[start:end].strip()
    return section or None


CLAUDE_USAGE_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)


class BackendResult(NamedTuple):
    """Outcome of one judge backend call.

    judgement: the parsed verdict dict (not yet schema-validated) or None on any
        failure.
    error: a short failure category or None on success. One of "timeout",
        "overflow", "error", "not-found", "invalid-json", or "exit-<code>".
    usage: normalized Claude token counts, or None (always None for codex and
        for failures before a parseable envelope).
    stderr_tail: bounded, unredacted tail of the child's stderr; the caller
        redacts it before logging and never surfaces it to the agent.
    """

    judgement: dict[str, Any] | None
    error: str | None
    usage: dict[str, int] | None
    stderr_tail: str


def strip_code_fence(text: str) -> str:
    """Unwrap a ```json ... ``` fenced response; models add fences despite instructions."""
    stripped = text.strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        first_newline = stripped.find("\n")
        if first_newline >= 0:
            return stripped[first_newline + 1 : -3].strip()
    return stripped


def normalize_usage(usage: Any) -> dict[str, int] | None:
    """Keep only present, non-negative integer token fields; None when empty."""
    if not isinstance(usage, dict):
        return None
    normalized: dict[str, int] = {}
    for field in CLAUDE_USAGE_FIELDS:
        value = usage.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            continue
        normalized[field] = value
    return normalized or None


def parse_claude_result_envelope(output: str) -> tuple[str | None, dict[str, int] | None]:
    """Parse a `claude -p --output-format json` result envelope.

    Returns (result_text, usage). result_text is the assistant's text (the
    envelope's `result` field) or None when the output is not a JSON object with
    a string `result`. usage is the normalized token dict or None.
    """
    try:
        envelope = json.loads(output)
    except (json.JSONDecodeError, ValueError, RecursionError):
        return None, None
    if not isinstance(envelope, dict):
        return None, None
    usage = normalize_usage(envelope.get("usage"))
    result = envelope.get("result")
    if not isinstance(result, str):
        return None, usage
    return result, usage


def interpret_backend_output(
    backend: str,
    returncode: int | None,
    output: str,
    status: str,
    stderr_tail: str,
) -> BackendResult:
    """Categorize a bounded backend run into a verdict dict or a failure category.

    For the claude backend the stdout is the `--output-format json` envelope; the
    verdict is parsed from its `result` field (a code fence is tolerated) and the
    token usage is captured. For codex the stdout is the verdict text directly and
    usage is always None.
    """
    if status == "timeout":
        return BackendResult(None, "timeout", None, stderr_tail)
    if status == "overflow":
        return BackendResult(None, "overflow", None, stderr_tail)
    if status != "ok" or returncode is None:
        return BackendResult(None, "error", None, stderr_tail)
    if returncode != 0:
        return BackendResult(None, f"exit-{returncode}", None, stderr_tail)

    if backend == "claude":
        body, usage = parse_claude_result_envelope(output)
        if body is None:
            return BackendResult(None, "invalid-json", usage, stderr_tail)
    else:
        body, usage = output, None

    try:
        data = json.loads(strip_code_fence(body))
    except (json.JSONDecodeError, ValueError, RecursionError):
        return BackendResult(None, "invalid-json", usage, stderr_tail)
    if not isinstance(data, dict):
        return BackendResult(None, "invalid-json", usage, stderr_tail)
    return BackendResult(data, None, usage, stderr_tail)


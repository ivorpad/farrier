from __future__ import annotations

import os
import selectors
import signal
import stat
import subprocess
import time
from pathlib import Path, PurePosixPath


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
) -> tuple[int | None, str, str]:
    if timeout_seconds <= 0 or max_output_bytes <= 0:
        return None, "", "error"

    started = time.monotonic()
    try:
        proc = subprocess.Popen(
            args,
            cwd=cwd,
            stdin=subprocess.PIPE if stdin_text is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT if merge_stderr else subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError:
        return None, "", "error"

    assert proc.stdout is not None
    selector = selectors.DefaultSelector()
    os.set_blocking(proc.stdout.fileno(), False)
    selector.register(proc.stdout, selectors.EVENT_READ, "stdout")

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
    return returncode, bounded, status


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


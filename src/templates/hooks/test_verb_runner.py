from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

import _hook_runtime
from _hook_runtime import run_bounded_process


HOOK = Path(__file__).with_name("verb-runner.py")


def make_fake_just(tmp_path: Path, body: str) -> Path:
    fake = tmp_path / "just"
    fake.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    return fake


def write_justfile(tmp_path: Path, content: str) -> None:
    (tmp_path / "justfile").write_text(content, encoding="utf-8")


def run_hook(payload: dict, tmp_path: Path, just_body: str) -> tuple[int, str, str]:
    make_fake_just(tmp_path, just_body)
    env = os.environ.copy()
    env["PATH"] = f"{tmp_path}{os.pathsep}{env.get('PATH', '')}"

    proc = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )

    return proc.returncode, proc.stdout, proc.stderr


def post_payload(
    tmp_path: Path, tool_name: str = "Edit", tool_input: dict | None = None
) -> dict:
    return {
        "session_id": "test",
        "transcript_path": "/tmp/transcript.jsonl",
        "cwd": str(tmp_path),
        "hook_event_name": "PostToolUse",
        "tool_name": tool_name,
        "tool_input": tool_input or {"file_path": "src/app.py"},
        "tool_response": {"ok": True},
    }


def stop_payload(tmp_path: Path, active: bool = False) -> dict:
    return {
        "session_id": "test",
        "transcript_path": "/tmp/transcript.jsonl",
        "cwd": str(tmp_path),
        "hook_event_name": "Stop",
        "stop_hook_active": active,
    }


def test_posttool_runs_just_check_and_is_silent_on_success(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(
        post_payload(tmp_path), tmp_path, 'test "$1" = "check" || exit 7\nexit 0'
    )

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_codex_apply_patch_runs_just_check(tmp_path: Path) -> None:
    payload = post_payload(
        tmp_path,
        tool_name="apply_patch",
        tool_input={
            "command": "*** Begin Patch\n*** Update File: src/app.py\n*** End Patch"
        },
    )

    code, stdout, stderr = run_hook(
        payload, tmp_path, 'test "$1" = "check" || exit 7\nexit 0'
    )

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_posttool_emits_context_when_check_fails(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(
        post_payload(tmp_path),
        tmp_path,
        'test "$1" = "check" || exit 7\necho "ruff failed"\nexit 1',
    )

    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    output = data["hookSpecificOutput"]
    assert output["hookEventName"] == "PostToolUse"
    assert "just check failed" in output["additionalContext"]
    assert "ruff failed" in output["additionalContext"]



def test_command_output_overflow_terminates_process_and_emits_bounded_redacted_feedback(
    tmp_path: Path,
) -> None:
    code, stdout, stderr = run_hook(
        post_payload(tmp_path),
        tmp_path,
        "head -c 20000 /dev/zero | tr '\\0' x\necho token=raw-tail-secret\nexit 1",
    )

    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)["hookSpecificOutput"]["additionalContext"]
    assert "output exceeded" in data
    assert "raw-tail-secret" not in data
    assert len(data.encode("utf-8")) <= 16 * 1024 + 64


def test_stop_runs_konsistent_and_blocks_on_failure(tmp_path: Path) -> None:
    write_justfile(
        tmp_path,
        """check:
  echo check

konsistent:
  echo konsistent
""",
    )

    code, stdout, stderr = run_hook(
        stop_payload(tmp_path),
        tmp_path,
        'test "$1" = "konsistent" || exit 7\necho "drift found"\nexit 1',
    )

    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    assert data["decision"] == "block"
    assert "konsistent check failed" in data["reason"]
    assert "drift found" in data["reason"]


def test_stop_runs_konpy_and_blocks_on_failure(tmp_path: Path) -> None:
    write_justfile(
        tmp_path,
        """check:
  echo check

konpy:
  echo konpy
""",
    )

    code, stdout, stderr = run_hook(
        stop_payload(tmp_path),
        tmp_path,
        'test "$1" = "konpy" || exit 7\necho "drift found"\nexit 1',
    )

    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    assert data["decision"] == "block"
    assert "konpy check failed" in data["reason"]
    assert "drift found" in data["reason"]


def test_stop_blocks_when_generated_structure_recipe_is_missing(tmp_path: Path) -> None:
    write_justfile(
        tmp_path,
        """check:
  echo check

test:
  echo test

fmt:
  echo fmt
""",
    )

    code, stdout, stderr = run_hook(
        stop_payload(tmp_path),
        tmp_path,
        'echo "just should not have been called"\nexit 9',
    )

    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    assert data["decision"] == "block"
    assert "Required generated structure recipe is missing" in data["reason"]


def test_stop_hook_active_prevents_recursive_block(tmp_path: Path) -> None:
    write_justfile(
        tmp_path,
        """konsistent:
  echo konsistent
""",
    )

    code, stdout, stderr = run_hook(
        stop_payload(tmp_path, active=True),
        tmp_path,
        'echo "should not run"\nexit 1',
    )

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_ignores_unrelated_tool_event(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(
        post_payload(
            tmp_path, tool_name="Read", tool_input={"file_path": "src/app.py"}
        ),
        tmp_path,
        'echo "should not run"\nexit 1',
    )

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_skips_edits_inside_claude_hooks_to_avoid_recursion(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(
        post_payload(
            tmp_path, tool_input={"file_path": ".claude/hooks/verb-runner.py"}
        ),
        tmp_path,
        'echo "should not run"\nexit 1',
    )

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_backend_stdin_delivery_is_covered_by_timeout(tmp_path: Path) -> None:
    started = time.monotonic()
    returncode, output, status = run_bounded_process(
        [sys.executable, "-c", "import time; time.sleep(5)"],
        cwd=str(tmp_path),
        timeout_seconds=0.05,
        max_output_bytes=1024,
        stdin_text="x" * (64 * 1024),
    )

    assert status == "timeout"
    assert returncode is not None
    assert output == ""
    assert time.monotonic() - started < 1


def test_safe_text_read_rejects_changed_fingerprint(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "stable.txt").write_text("stable", encoding="utf-8")
    original = _hook_runtime.file_fingerprint
    calls = 0

    def changed(stats):
        nonlocal calls
        calls += 1
        fingerprint = original(stats)
        return fingerprint if calls == 1 else (*fingerprint[:-1], fingerprint[-1] + 1)

    monkeypatch.setattr(_hook_runtime, "file_fingerprint", changed)
    text, error = _hook_runtime.read_project_text(tmp_path, "stable.txt", 1024)

    assert text is None
    assert error == "changed identity or contents while being read"


def test_oversized_and_symlink_justfiles_block_recipe_discovery(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.write_text("konsistent:\n  echo unsafe\n", encoding="utf-8")
    for name in ("oversized", "symlink"):
        case_dir = tmp_path / name
        case_dir.mkdir()
        justfile = case_dir / "justfile"
        if name == "oversized":
            justfile.write_text("x" * (257 * 1024), encoding="utf-8")
        else:
            justfile.symlink_to(outside)
        code, stdout, stderr = run_hook(stop_payload(case_dir), case_dir, "exit 9")
        assert code == 0
        assert stderr == ""
        data = json.loads(stdout)
        assert data["decision"] == "block"
        assert "safely discover" in data["reason"]

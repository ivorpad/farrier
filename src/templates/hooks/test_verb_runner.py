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


def test_posttool_runs_just_check_fast_and_is_silent_on_success(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(
        post_payload(tmp_path), tmp_path, 'test "$1" = "check-fast" || exit 7\nexit 0'
    )

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_posttool_passes_related_test_files_to_check_fast(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app.py").write_text("x = 1\n", encoding="utf-8")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_app.py").write_text("def test_x(): pass\n", encoding="utf-8")

    code, stdout, stderr = run_hook(
        post_payload(tmp_path),
        tmp_path,
        f'echo "$@" > {tmp_path}/just-args.txt\nexit 0',
    )

    assert code == 0
    assert stdout == ""
    assert stderr == ""
    recorded = (tmp_path / "just-args.txt").read_text(encoding="utf-8").strip()
    assert recorded == "check-fast tests/test_app.py"


def test_posttool_passes_edited_test_file_itself(tmp_path: Path) -> None:
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_app.py").write_text("def test_x(): pass\n", encoding="utf-8")

    code, stdout, stderr = run_hook(
        post_payload(tmp_path, tool_input={"file_path": "tests/test_app.py"}),
        tmp_path,
        f'echo "$@" > {tmp_path}/just-args.txt\nexit 0',
    )

    assert code == 0
    recorded = (tmp_path / "just-args.txt").read_text(encoding="utf-8").strip()
    assert recorded == "check-fast tests/test_app.py"


def test_codex_apply_patch_runs_just_check_fast(tmp_path: Path) -> None:
    payload = post_payload(
        tmp_path,
        tool_name="apply_patch",
        tool_input={
            "command": "*** Begin Patch\n*** Update File: src/app.py\n*** End Patch"
        },
    )

    code, stdout, stderr = run_hook(
        payload, tmp_path, 'test "$1" = "check-fast" || exit 7\nexit 0'
    )

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_posttool_emits_context_when_check_fails(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(
        post_payload(tmp_path),
        tmp_path,
        'test "$1" = "check-fast" || exit 7\necho "ruff failed"\nexit 1',
    )

    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    output = data["hookSpecificOutput"]
    assert output["hookEventName"] == "PostToolUse"
    assert "just check-fast failed" in output["additionalContext"]
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
        'test "$1" = "check-full" && exit 0\ntest "$1" = "konsistent" || exit 7\necho "drift found"\nexit 1',
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
        'test "$1" = "check-full" && exit 0\ntest "$1" = "konpy" || exit 7\necho "drift found"\nexit 1',
    )

    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    assert data["decision"] == "block"
    assert "konpy check failed" in data["reason"]
    assert "drift found" in data["reason"]


def test_stop_skips_structure_check_when_pack_ships_no_recipe(tmp_path: Path) -> None:
    # Packs without a structure linter (rails) generate no konpy/konsistent
    # recipe; the Stop gate must not demand one (2026-07-21 round 2: it
    # blocked every rails stop). Drift detection belongs to doctor/update.
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
        'test "$1" = "check-full" && exit 0\necho "structure should not have been called"\nexit 9',
    )

    assert code == 0
    assert stderr == ""
    assert stdout == ""
    events = (tmp_path / ".farrier" / "runtime" / "events.jsonl").read_text(encoding="utf-8")
    assert "skipped-no-structure-recipe" in events


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
            tmp_path, tool_input={"file_path": ".farrier/hooks/verb-runner.py"}
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
        code, stdout, stderr = run_hook(
            stop_payload(case_dir), case_dir, 'test "$1" = "check-full" && exit 0\nexit 9'
        )
        assert code == 0
        assert stderr == ""
        data = json.loads(stdout)
        assert data["decision"] == "block"
        assert "safely discover" in data["reason"]

STRUCTURE_OK_JUSTFILE = """check-full:
  echo full

konsistent:
  echo konsistent
"""


def stop_with_full_failure(tmp_path: Path, message: str) -> tuple[int, str, str]:
    return run_hook(
        stop_payload(tmp_path),
        tmp_path,
        f'test "$1" = "check-full" || exit 0\necho "{message}"\nexit 1',
    )


def test_stop_blocks_once_then_allows_identical_check_full_failure(tmp_path: Path) -> None:
    write_justfile(tmp_path, STRUCTURE_OK_JUSTFILE)

    code, stdout, stderr = stop_with_full_failure(tmp_path, "loopback bind failed")
    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    assert data["decision"] == "block"
    assert "loopback bind failed" in data["reason"]
    assert "predates your changes" in data["reason"]
    assert (tmp_path / ".farrier" / "runtime" / "verify-state.json").is_file()

    code, stdout, stderr = stop_with_full_failure(tmp_path, "loopback bind failed")
    assert code == 0
    assert stderr == ""
    assert stdout == ""


def record_source_edit(tmp_path: Path) -> None:
    """Register a hook-visible source edit so the next Stop re-verifies."""
    (tmp_path / "src").mkdir(exist_ok=True)
    code, _, stderr = run_hook(post_payload(tmp_path), tmp_path, 'test "$1" = "check-fast" || exit 7\nexit 0')
    assert code == 0
    assert stderr == ""


def test_posttool_docs_only_edit_skips_check_fast(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(
        post_payload(tmp_path, tool_name="Write", tool_input={"file_path": "docs/notes.md"}),
        tmp_path,
        "exit 9",  # any just invocation would fail loudly
    )
    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_stop_after_docs_only_session_runs_fast_gate_not_full(tmp_path: Path) -> None:
    write_justfile(tmp_path, STRUCTURE_OK_JUSTFILE)

    code, _, _ = run_hook(
        post_payload(tmp_path, tool_name="Write", tool_input={"file_path": "README.md"}),
        tmp_path,
        "exit 9",
    )
    assert code == 0

    code, stdout, stderr = run_hook(
        stop_payload(tmp_path),
        tmp_path,
        'test "$1" = "check-full" && exit 9\nexit 0',
    )
    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_stop_blocks_again_when_failure_changes_after_an_edit(tmp_path: Path) -> None:
    write_justfile(tmp_path, STRUCTURE_OK_JUSTFILE)

    stop_with_full_failure(tmp_path, "first failure")
    record_source_edit(tmp_path)
    code, stdout, _ = stop_with_full_failure(tmp_path, "second different failure")

    assert code == 0
    data = json.loads(stdout)
    assert data["decision"] == "block"
    assert "second different failure" in data["reason"]


def test_stop_without_edits_skips_the_redundant_rerun(tmp_path: Path) -> None:
    write_justfile(tmp_path, STRUCTURE_OK_JUSTFILE)

    stop_with_full_failure(tmp_path, "known failure")

    # No edit since the block: even a would-be-different failure is not
    # re-observed; the stop is allowed without running check-full again.
    code, stdout, stderr = stop_with_full_failure(tmp_path, "would be different now")
    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_check_full_success_after_edit_clears_recorded_baseline_failure(tmp_path: Path) -> None:
    write_justfile(tmp_path, STRUCTURE_OK_JUSTFILE)

    stop_with_full_failure(tmp_path, "flaky failure")
    record_source_edit(tmp_path)

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path, "exit 0")
    assert code == 0
    assert stdout == ""
    assert stderr == ""
    state = json.loads((tmp_path / ".farrier" / "runtime" / "verify-state.json").read_text(encoding="utf-8"))
    assert "checkFullFailure" not in state

    record_source_edit(tmp_path)
    code, stdout, _ = stop_with_full_failure(tmp_path, "flaky failure")
    data = json.loads(stdout)
    assert data["decision"] == "block"


def test_failure_fingerprint_ignores_paths_durations_and_ansi(tmp_path: Path) -> None:
    write_justfile(tmp_path, STRUCTURE_OK_JUSTFILE)

    first = f'\x1b[31mFAIL\x1b[0m {tmp_path}/tests/test_app.py took 1.23s at 10:00:01'
    second = f'FAIL {tmp_path}/tests/test_app.py took 4.56s at 11:22:33'

    code, stdout, _ = run_hook(
        stop_payload(tmp_path),
        tmp_path,
        f'test "$1" = "check-full" || exit 0\nprintf "%s" "{first}"\nexit 1',
    )
    assert json.loads(stdout)["decision"] == "block"

    code, stdout, stderr = run_hook(
        stop_payload(tmp_path),
        tmp_path,
        f'test "$1" = "check-full" || exit 0\nprintf "%s" "{second}"\nexit 1',
    )
    assert code == 0
    assert stdout == ""
    assert stderr == ""

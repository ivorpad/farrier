from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

import _hook_runtime
from _hook_runtime import (
    STDERR_TAIL_BYTES,
    interpret_backend_output,
    parse_claude_result_envelope,
    run_bounded_process,
)

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
        capture_output=True,
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

    code, _stdout, _stderr = run_hook(
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


def test_stop_hook_active_prevents_recursive_block(tmp_path: Path) -> None:
    write_justfile(tmp_path, "check-full:\n  echo full\n")

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
    returncode, output, status, _ = run_bounded_process(
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


def test_capture_stderr_returns_bounded_tail_without_touching_stdout(tmp_path: Path) -> None:
    returncode, output, status, stderr_tail = run_bounded_process(
        [
            sys.executable,
            "-c",
            "import sys; sys.stdout.write('OUT'); sys.stderr.write('E' * 5000)",
        ],
        cwd=str(tmp_path),
        timeout_seconds=5,
        max_output_bytes=1024,
        capture_stderr=True,
    )

    assert status == "ok"
    assert returncode == 0
    assert output == "OUT"
    # Only the last STDERR_TAIL_BYTES are kept; stdout is unaffected.
    assert stderr_tail == "E" * STDERR_TAIL_BYTES


def test_stderr_tail_is_empty_when_not_captured(tmp_path: Path) -> None:
    _returncode, output, status, stderr_tail = run_bounded_process(
        [sys.executable, "-c", "import sys; sys.stderr.write('boom'); sys.stdout.write('ok')"],
        cwd=str(tmp_path),
        timeout_seconds=5,
        max_output_bytes=1024,
    )

    assert status == "ok"
    assert output == "ok"
    assert stderr_tail == ""


def test_parse_claude_result_envelope_extracts_result_and_usage() -> None:
    envelope = json.dumps(
        {
            "type": "result",
            "result": "{\"severity\":\"pass\"}",
            "usage": {"input_tokens": 12, "output_tokens": 3, "cache_read_input_tokens": 40, "ignored": 9},
        }
    )
    body, usage = parse_claude_result_envelope(envelope)

    assert body == '{"severity":"pass"}'
    assert usage == {"input_tokens": 12, "output_tokens": 3, "cache_read_input_tokens": 40}


def test_parse_claude_result_envelope_rejects_non_envelope() -> None:
    assert parse_claude_result_envelope("not json") == (None, None)
    assert parse_claude_result_envelope(json.dumps({"usage": {"input_tokens": 5}})) == (None, {"input_tokens": 5})


def test_interpret_backend_output_categories() -> None:
    assert interpret_backend_output("claude", None, "", "timeout", "tail").error == "timeout"
    assert interpret_backend_output("claude", None, "", "overflow", "").error == "overflow"
    assert interpret_backend_output("claude", 7, "envelope", "ok", "").error == "exit-7"
    assert interpret_backend_output("claude", 0, "not-json", "ok", "").error == "invalid-json"
    good = interpret_backend_output(
        "claude", 0, json.dumps({"result": "{\"severity\":\"pass\"}", "usage": {"output_tokens": 2}}), "ok", ""
    )
    assert good.error is None
    assert good.judgement == {"severity": "pass"}
    assert good.usage == {"output_tokens": 2}
    codex = interpret_backend_output("codex", 0, '{"severity":"serious"}', "ok", "")
    assert codex.judgement == {"severity": "serious"}
    assert codex.usage is None


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


STRUCTURE_OK_JUSTFILE = """check-full:
  echo full
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


def test_redaction_patterns_cover_provider_credentials_and_spare_ordinary_text() -> None:
    """Positive/negative contract for the shared REDACTION_PATTERNS tuple.

    Fixtures are assembled from parts so no token-shaped literal lands in the
    repo. Prose PII (names, addresses, secrets written as free text) is out of
    scope for these deterministic patterns by design.
    """
    spec = importlib.util.spec_from_file_location("hook_redaction_under_test", HOOK)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    redacted_values = [
        "".join(("AK", "IA", "7" * 16)),
        "".join(("AS", "IA", "8" * 16)),
        "_".join(("ghp", "a" * 36)),
        "_".join(("ghs", "a" * 36)),
        "_".join(("github", "pat", "b" * 24)),
        "-".join(("xoxb", "1" * 10, "c" * 12)),
        "".join(("AIza", "SyA", "d" * 32)),
        "_".join(("npm", "e" * 36)),
        "-".join(("sk", "f" * 20)),
        "-".join(("sk", "ant", "api03", "g" * 24)),
        ".".join(("eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "h" * 12)),
        "Bearer " + "i" * 16,
        "dev@example.com",
        "-----BEGIN RSA PRIVATE KEY-----\nseeded\n-----END RSA PRIVATE KEY-----",
    ]
    for value in redacted_values:
        assert "REDACTED" in module.redact_text(value), value

    secret = "j" * 30
    for assignment in (
        "aws_secret_access_key = " + secret,
        "GITHUB_TOKEN=" + secret,
        '"password": "' + secret + '"',
        "signing_key: '" + secret + "'",
    ):
        redacted = module.redact_text(assignment)
        assert secret not in redacted, assignment
        assert "=[REDACTED]" in redacted, assignment

    untouched = (
        "commit " + "3f78" * 10 + " tagged for release",
        "deploy_commit = " + "ab12" * 10,
        "the task-scheduler and risk-assessment jobs run nightly",
        "https://github.com/owner/repo/pull/42",
        '"integrity": "sha512-C7x8CXm9E6vXjMLC0Ap5nqWaEzFJ9lKAJgtcQPP=="',
        "max_tokens: 4096",
        "sort_key=lambda item: item.name",
        "short id ab12cd",
    )
    for text in untouched:
        assert module.redact_text(text) == text, text


def test_stop_skips_when_the_harness_generates_no_gate(tmp_path: Path) -> None:
    # An evidence-gated harness on a repository with no linter and no test
    # runner has no check-full recipe. Demanding one would block every stop on
    # exactly those projects.
    write_justfile(tmp_path, "fmt:\n  echo fmt\n")

    code, stdout, stderr = run_hook(
        stop_payload(tmp_path), tmp_path, 'echo "gate should not have run"\nexit 9'
    )

    assert code == 0
    assert stdout == ""
    assert stderr == ""
    events = (tmp_path / ".farrier" / "runtime" / "events.jsonl").read_text(encoding="utf-8")
    assert "skipped-no-recipe" in events

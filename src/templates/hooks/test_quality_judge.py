from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).with_name("quality-judge.py")


def write_manifest(tmp_path: Path, manifest: dict) -> None:
    (tmp_path / ".farrier.json").write_text(json.dumps(manifest), encoding="utf-8")
    prompt = manifest.get("judge", {}).get("perEdit", {}).get("prompt")
    if prompt == ".claude/hooks/prompts/quality-judge-v1.txt":
        path = tmp_path / prompt
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("QUALITY PROMPT", encoding="utf-8")


def manifest(
    *,
    enabled: bool = False,
    backend: str = "claude",
    model: str = "haiku",
    timeout_ms: int = 15000,
    prompt: str = ".claude/hooks/prompts/quality-judge-v1.txt",
    max_lines: int = 500,
) -> dict:
    return {
        "judge": {
            "perEdit": {
                "enabled": enabled,
                "backend": backend,
                "model": model,
                "timeoutMs": timeout_ms,
                "prompt": prompt,
            }
        },
        "quality": {
            "maxFileLines": max_lines,
        },
    }


def make_fake_executable(tmp_path: Path, name: str, body: str) -> Path:
    fake = tmp_path / name
    fake.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    return fake


def run_hook(
    payload: dict, tmp_path: Path, extra_path: Path | None = None
) -> tuple[int, str, str]:
    env = os.environ.copy()
    if extra_path is not None:
        env["PATH"] = f"{extra_path}{os.pathsep}{env.get('PATH', '')}"

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
    tmp_path: Path, tool_input: dict | None = None, tool_name: str = "Write"
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


def parse_stdout(stdout: str) -> dict:
    assert stdout.strip()
    return json.loads(stdout)


def assert_allowed(stdout: str, stderr: str) -> None:
    assert stdout == ""
    assert stderr == ""


def assert_post_context(stdout: str, expected: str) -> None:
    data = parse_stdout(stdout)
    output = data["hookSpecificOutput"]
    assert output["hookEventName"] == "PostToolUse"
    assert expected in output["additionalContext"]


def test_over_limit_file_emits_posttool_context(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=2))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("one\ntwo\nthree\n", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "exceeding quality.maxFileLines=2")


def test_final_unterminated_line_counts_toward_max_file_lines(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=2))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("one\ntwo\nthree", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "src/app.py is 3 lines")


def test_under_limit_file_passes_silently(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=10))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("one\ntwo\n", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_codex_apply_patch_extracts_every_changed_path_header(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=2))
    source = tmp_path / "src"
    source.mkdir()
    (source / "small.py").write_text("one\n", encoding="utf-8")
    (source / "large.py").write_text("one\ntwo\nthree\n", encoding="utf-8")
    patch = """*** Begin Patch
*** Update File: src/small.py
*** Add File: src/large.py
*** Delete File: src/deleted.py
*** End Patch"""

    code, stdout, stderr = run_hook(
        post_payload(tmp_path, {"command": patch}, tool_name="apply_patch"),
        tmp_path,
    )

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "src/large.py is 3 lines")


def test_missing_file_passes_silently(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=1))

    code, stdout, stderr = run_hook(
        post_payload(tmp_path, {"file_path": "src/missing.py"}), tmp_path
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_disabled_llm_does_not_call_backend(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=False, max_lines=100))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(tmp_path, "claude", "echo called > called.txt\nexit 0")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert not (tmp_path / "called.txt").exists()


def test_enabled_fake_claude_advisory_emits_context_and_reads_prompt_from_stdin(
    tmp_path: Path,
) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude", model="haiku"))
    prompt_dir = tmp_path / ".claude" / "hooks" / "prompts"
    prompt_dir.mkdir(parents=True, exist_ok=True)
    (prompt_dir / "quality-judge-v1.txt").write_text(
        "CUSTOM QUALITY PROMPT", encoding="utf-8"
    )

    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        """
test "$1" = "-p" || exit 7
test "$2" = "--model" || exit 7
test "$3" = "haiku" || exit 7
cat > prompt.txt
grep -q "CUSTOM QUALITY PROMPT" prompt.txt || exit 8
printf '{"severity":"advisory","summary":"move logic closer to domain","findings":[{"path":"src/app.py","message":"thin cohesion","suggestion":"extract a service"}]}'
""",
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "semantic quality judge (advisory)")
    assert_post_context(stdout, "move logic closer to domain")
    assert (
        (tmp_path / "prompt.txt")
        .read_text(encoding="utf-8")
        .startswith("CUSTOM QUALITY PROMPT")
    )


def test_enabled_fake_codex_serious_emits_context_and_prompt_is_single_argument(
    tmp_path: Path,
) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="codex", model="gpt-5.5"))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "codex",
        """
test "$1" = "exec" || exit 7
test "$2" = "--model" || exit 7
test "$3" = "gpt-5.5" || exit 7
printf "%s" "$4" > prompt.txt
grep -q "src/app.py" prompt.txt || exit 8
printf '{"severity":"serious","summary":"business logic dumped into CLI","findings":[{"path":"src/app.py","message":"wrong layer","suggestion":"move into core"}]}'
""",
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "semantic quality judge (serious)")
    assert_post_context(stdout, "business logic dumped into CLI")


def test_backend_garbage_response_passes_silently(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude"))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(tmp_path, "claude", "echo not-json")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_backend_timeout_passes_silently(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude", timeout_ms=50))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(tmp_path, "claude", "sleep 1\necho never")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "timed out and was terminated")


def test_invalid_configured_prompt_emits_actionable_feedback(tmp_path: Path) -> None:
    write_manifest(
        tmp_path,
        manifest(
            enabled=True, backend="claude", prompt=".claude/hooks/prompts/missing.txt"
        ),
    )
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        """
cat > prompt.txt
grep -q "Farrier's per-edit semantic quality judge" prompt.txt || exit 8
printf '{"severity":"pass","summary":"ok","findings":[]}'
""",
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "prompt is missing or unreadable")
    assert not (tmp_path / "prompt.txt").exists()


def test_large_file_content_is_capped_with_truncated_marker(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude", max_lines=100000))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("x" * (40 * 1024), encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        """
cat > prompt.txt
grep -q "\\[truncated\\]" prompt.txt || exit 8
bytes=$(wc -c < prompt.txt)
test "$bytes" -lt 40000 || exit 9
printf '{"severity":"pass","summary":"ok","findings":[]}'
""",
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)



def test_final_backend_prompt_and_feedback_redact_under_limit_and_truncated_evidence(
    tmp_path: Path,
) -> None:
    for label, padding in (("short", ""), ("truncated", "x" * (40 * 1024))):
        case_dir = tmp_path / label
        case_dir.mkdir()
        config = manifest(enabled=True, backend="claude", max_lines=100000)
        write_manifest(case_dir, config)
        prompt_path = case_dir / config["judge"]["perEdit"]["prompt"]
        prompt_path.write_text(
            "configured token=prompt-secret prompt@example.com", encoding="utf-8"
        )
        source = case_dir / "src"
        source.mkdir()
        (source / "app.py").write_text(
            f"token=seeded-secret dev@example.com {padding}", encoding="utf-8"
        )
        make_fake_executable(
            case_dir,
            "claude",
            """
cat > prompt.txt
printf '{"severity":"advisory","summary":"token=feedback-secret feedback@example.com","findings":[]}'
""",
        )

        code, stdout, stderr = run_hook(
            post_payload(case_dir), case_dir, case_dir
        )

        assert code == 0
        assert stderr == ""
        final_prompt = (case_dir / "prompt.txt").read_text(encoding="utf-8")
        combined = final_prompt + stdout
        for secret in (
            "prompt-secret",
            "prompt@example.com",
            "seeded-secret",
            "dev@example.com",
            "feedback-secret",
            "feedback@example.com",
        ):
            assert secret not in combined
        if label == "truncated":
            assert "[truncated]" in final_prompt


def test_backend_output_overflow_is_terminated_with_bounded_feedback(
    tmp_path: Path,
) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude"))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("ok\n", encoding="utf-8")
    make_fake_executable(
        tmp_path,
        "claude",
        "head -c 70000 /dev/zero | tr '\\0' x\necho token=raw-tail-secret",
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "output exceeded")
    assert "raw-tail-secret" not in stdout
    assert len(stdout.encode("utf-8")) < 20 * 1024


def test_malformed_enabled_config_fields_emit_feedback_while_disabled_is_inert(
    tmp_path: Path,
) -> None:
    invalid = [
        ("enabled", "yes"),
        ("backend", "other"),
        ("model", ""),
        ("timeoutMs", 0),
        ("timeoutMs", 120001),
        ("prompt", ""),
    ]
    for index, (field, value) in enumerate(invalid):
        case_dir = tmp_path / str(index)
        case_dir.mkdir()
        config = manifest(enabled=True)
        config["judge"]["perEdit"][field] = value
        write_manifest(case_dir, config)
        source = case_dir / "src"
        source.mkdir()
        (source / "app.py").write_text("ok\n", encoding="utf-8")
        code, stdout, stderr = run_hook(post_payload(case_dir), case_dir)
        assert code == 0
        assert stderr == ""
        assert_post_context(stdout, "configuration is malformed")

    disabled_dir = tmp_path / "disabled"
    disabled_dir.mkdir()
    config = manifest(enabled=False)
    config["judge"]["perEdit"]["backend"] = "invalid"
    write_manifest(disabled_dir, config)
    source = disabled_dir / "src"
    source.mkdir()
    (source / "app.py").write_text("ok\n", encoding="utf-8")
    code, stdout, stderr = run_hook(post_payload(disabled_dir), disabled_dir)
    assert code == 0
    assert_allowed(stdout, stderr)


def test_invalid_max_file_lines_and_ambiguous_recognized_edits_emit_feedback(tmp_path: Path) -> None:
    for index, value in enumerate((0, 100001, "500", True)):
        case_dir = tmp_path / f"limit-{index}"
        case_dir.mkdir()
        config = manifest(enabled=False)
        config["quality"]["maxFileLines"] = value
        write_manifest(case_dir, config)
        code, stdout, stderr = run_hook(post_payload(case_dir), case_dir)
        assert code == 0
        assert stderr == ""
        assert_post_context(stdout, "quality.maxFileLines")

    case_dir = tmp_path / "ambiguous"
    case_dir.mkdir()
    write_manifest(case_dir, manifest(enabled=False))
    for tool_input in (None, {}, {"file_path": 7}):
        payload = post_payload(case_dir)
        payload["tool_input"] = tool_input
        code, stdout, stderr = run_hook(payload, case_dir)
        assert code == 0
        assert stderr == ""
        assert_post_context(stdout, "malformed or ambiguous input")


def test_manifest_prompt_and_edited_file_safe_read_failures_emit_bounded_feedback(tmp_path: Path) -> None:
    oversized = tmp_path / "oversized-manifest"
    oversized.mkdir()
    (oversized / ".farrier.json").write_text("x" * (257 * 1024), encoding="utf-8")
    code, stdout, stderr = run_hook(post_payload(oversized), oversized)
    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "exceeds 262144 bytes")

    dotted = tmp_path / "dotted-prompt"
    dotted.mkdir()
    write_manifest(dotted, manifest(enabled=True, prompt="./prompt.txt"))
    source = dotted / "src"
    source.mkdir()
    (source / "app.py").write_text("ok\n", encoding="utf-8")
    code, stdout, stderr = run_hook(post_payload(dotted), dotted)
    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "without . or .. segments")

    linked = tmp_path / "linked-edit"
    linked.mkdir()
    write_manifest(linked, manifest(enabled=False))
    outside = tmp_path / "outside.py"
    outside.write_text("token=outside-secret\n", encoding="utf-8")
    source = linked / "src"
    source.mkdir()
    (source / "app.py").symlink_to(outside)
    code, stdout, stderr = run_hook(post_payload(linked), linked)
    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "traverses a symlink")
    assert "outside-secret" not in stdout


def test_skips_hook_files_to_avoid_recursion(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=1))
    hooks = tmp_path / ".claude" / "hooks"
    hooks.mkdir(parents=True, exist_ok=True)
    (hooks / "quality-judge.py").write_text("one\ntwo\nthree\n", encoding="utf-8")

    code, stdout, stderr = run_hook(
        post_payload(tmp_path, {"file_path": ".claude/hooks/quality-judge.py"}),
        tmp_path,
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_ignores_unrelated_tool(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=1))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("one\ntwo\nthree\n", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path, tool_name="Read"), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)

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


def run_hook(payload: dict, tmp_path: Path, extra_path: Path | None = None) -> tuple[int, str, str]:
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


def post_payload(tmp_path: Path, tool_input: dict | None = None, tool_name: str = "Write") -> dict:
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


def test_under_limit_file_passes_silently(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=10))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("one\ntwo\n", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_missing_file_passes_silently(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=1))

    code, stdout, stderr = run_hook(post_payload(tmp_path, {"file_path": "src/missing.py"}), tmp_path)

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


def test_enabled_fake_claude_advisory_emits_context_and_reads_prompt_from_stdin(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude", model="haiku"))
    prompt_dir = tmp_path / ".claude" / "hooks" / "prompts"
    prompt_dir.mkdir(parents=True)
    (prompt_dir / "quality-judge-v1.txt").write_text("CUSTOM QUALITY PROMPT", encoding="utf-8")

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
    assert (tmp_path / "prompt.txt").read_text(encoding="utf-8").startswith("CUSTOM QUALITY PROMPT")


def test_enabled_fake_codex_serious_emits_context_and_prompt_is_single_argument(tmp_path: Path) -> None:
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
    assert_allowed(stdout, stderr)


def test_missing_prompt_uses_embedded_fallback(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude", prompt=".claude/hooks/prompts/missing.txt"))
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
    assert_allowed(stdout, stderr)
    assert "Farrier's per-edit semantic quality judge" in (tmp_path / "prompt.txt").read_text(encoding="utf-8")


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


def test_skips_hook_files_to_avoid_recursion(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=1))
    hooks = tmp_path / ".claude" / "hooks"
    hooks.mkdir(parents=True)
    (hooks / "quality-judge.py").write_text("one\ntwo\nthree\n", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path, {"file_path": ".claude/hooks/quality-judge.py"}), tmp_path)

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

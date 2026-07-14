from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).with_name("stop-judge.py")


def write_manifest(
    tmp_path: Path,
    *,
    enabled: bool = True,
    backend: str = "claude",
    model: str = "sonnet",
    timeout_ms: int = 30000,
    prompt: str = ".claude/hooks/prompts/stop-judge-v1.txt",
    max_diff_bytes: int = 120000,
    max_untracked_files: int = 50,
) -> None:
    (tmp_path / ".farrier.json").write_text(
        json.dumps(
            {
                "judge": {
                    "stop": {
                        "enabled": enabled,
                        "backend": backend,
                        "model": model,
                        "timeoutMs": timeout_ms,
                        "prompt": prompt,
                        "maxDiffBytes": max_diff_bytes,
                        "maxUntrackedFiles": max_untracked_files,
                    }
                }
            }
        ),
        encoding="utf-8",
    )


def make_fake_executable(tmp_path: Path, name: str, body: str) -> Path:
    fake = tmp_path / name
    fake.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    return fake


def run_hook(payload: dict, extra_path: Path | None = None) -> tuple[int, str, str]:
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


def stop_payload(tmp_path: Path, *, active: bool = False) -> dict:
    return {
        "session_id": "test",
        "transcript_path": "/tmp/transcript.jsonl",
        "cwd": str(tmp_path),
        "hook_event_name": "Stop",
        "stop_hook_active": active,
    }


def git(tmp_path: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args],
        cwd=tmp_path,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=True,
    )


def init_repo_with_head(tmp_path: Path) -> None:
    git(tmp_path, "init")
    (tmp_path / "README.md").write_text("initial\n", encoding="utf-8")
    git(tmp_path, "add", "README.md")
    git(
        tmp_path,
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test User",
        "commit",
        "-m",
        "initial",
    )


def parse_stdout(stdout: str) -> dict:
    assert stdout.strip()
    return json.loads(stdout)


def assert_allowed(stdout: str, stderr: str) -> None:
    assert stdout == ""
    assert stderr == ""


def test_stop_hook_active_passes_without_backend_call(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")
    make_fake_executable(tmp_path, "claude", "echo called > called.txt\nexit 1")

    code, stdout, stderr = run_hook(stop_payload(tmp_path, active=True), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert not (tmp_path / "called.txt").exists()


def test_codex_stop_payload_is_accepted(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=False)
    payload = stop_payload(tmp_path)
    payload.update(
        {
            "turn_id": "turn-1",
            "model": "gpt-codex",
            "permission_mode": "default",
            "last_assistant_message": "done",
        }
    )

    code, stdout, stderr = run_hook(payload)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_disabled_judge_passes_silently(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=False)
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")
    make_fake_executable(tmp_path, "claude", "echo called > called.txt\nexit 1")

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert not (tmp_path / "called.txt").exists()


def test_no_valid_head_passes_silently(tmp_path: Path) -> None:
    git(tmp_path, "init")
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("uncommitted\n", encoding="utf-8")
    make_fake_executable(tmp_path, "claude", "echo called > called.txt\nexit 1")

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert not (tmp_path / "called.txt").exists()


def test_fake_claude_serious_blocks(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True, backend="claude", model="sonnet")
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        """
test "$1" = "-p" || exit 7
test "$2" = "--model" || exit 7
test "$3" = "sonnet" || exit 7
cat > prompt.txt
grep -q "diff --git" prompt.txt || exit 8
printf '{"severity":"serious","summary":"secret-like config added","findings":[{"path":"README.md","message":"serious issue","suggestion":"fix before stopping"}]}'
""",
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    data = parse_stdout(stdout)
    assert data["decision"] == "block"
    assert "semantic stop judge blocked stop" in data["reason"]
    assert "secret-like config added" in data["reason"]
    assert "README.md" in data["reason"]


def test_fake_codex_serious_blocks_with_prompt_as_single_argument(
    tmp_path: Path,
) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True, backend="codex", model="gpt-5.5")
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "codex",
        """
test "$1" = "exec" || exit 7
test "$2" = "--model" || exit 7
test "$3" = "gpt-5.5" || exit 7
printf "%s" "$4" > prompt.txt
grep -q "diff --git" prompt.txt || exit 8
printf '{"severity":"serious","summary":"broken architecture","findings":[{"path":"README.md","message":"wrong layer","suggestion":"move it"}]}'
""",
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    data = parse_stdout(stdout)
    assert data["decision"] == "block"
    assert "broken architecture" in data["reason"]


def test_fake_backend_advisory_passes_silently(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        """printf '{"severity":"advisory","summary":"minor cleanup","findings":[{"path":"README.md","message":"minor","suggestion":"later"}]}'""",
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_fake_backend_garbage_passes_silently(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")
    make_fake_executable(tmp_path, "claude", "echo not-json")

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_backend_timeout_passes_silently(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True, timeout_ms=50)
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")
    make_fake_executable(tmp_path, "claude", "sleep 1\necho never")

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_untracked_paths_are_included_in_prompt_payload(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "new_module.py").write_text("print('new')\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        """
cat > prompt.txt
grep -q "new_module.py" prompt.txt || exit 8
printf '{"severity":"pass","summary":"ok","findings":[]}'
""",
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert "new_module.py" in (tmp_path / "prompt.txt").read_text(encoding="utf-8")


def test_large_diff_is_capped_with_truncated_marker(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("x" * (40 * 1024), encoding="utf-8")

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

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_no_changes_passes_without_backend_call(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    make_fake_executable(tmp_path, "claude", "echo called > called.txt\nexit 1")
    # Commit the setup files so the worktree is genuinely clean (no diff, no untracked).
    git(tmp_path, "add", "-A")
    git(
        tmp_path,
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test User",
        "commit",
        "-m",
        "setup",
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert not (tmp_path / "called.txt").exists()

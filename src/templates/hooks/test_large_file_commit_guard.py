from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).with_name("large-file-commit-guard.py")


def run_hook(payload: dict, *, raw: str | None = None) -> tuple[int, str, str]:
    proc = subprocess.run(
        [sys.executable, str(HOOK)],
        input=raw if raw is not None else json.dumps(payload),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    return proc.returncode, proc.stdout, proc.stderr


def bash_payload(cwd: Path, command: str) -> dict:
    return {
        "session_id": "test",
        "transcript_path": "/tmp/transcript.jsonl",
        "cwd": str(cwd),
        "hook_event_name": "PreToolUse",
        "tool_name": "Bash",
        "tool_input": {"command": command},
    }


def assert_denied(stdout: str, expected: str) -> None:
    data = json.loads(stdout)
    output = data["hookSpecificOutput"]
    assert output["hookEventName"] == "PreToolUse"
    assert output["permissionDecision"] == "deny"
    assert expected in output["permissionDecisionReason"]


def assert_allowed(stdout: str, stderr: str) -> None:
    assert stdout == ""
    assert stderr == ""


def git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def init_repo(tmp_path: Path, *, max_bytes: int | None = 1000, config: dict | None = None) -> Path:
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "Test")
    guard_config = config if config is not None else {}
    if max_bytes is not None and "maxBytes" not in guard_config:
        guard_config["maxBytes"] = max_bytes
    manifest = {"packIds": ["generic"], "guards": {"largeFileCommit": guard_config}}
    (tmp_path / ".farrier.json").write_text(json.dumps(manifest), encoding="utf-8")
    return tmp_path


def write_file(repo: Path, name: str, size: int) -> Path:
    path = repo / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    return path


def events(repo: Path) -> list[dict]:
    path = repo / ".farrier" / "runtime" / "events.jsonl"
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_non_git_commands_pass_silently(tmp_path: Path) -> None:
    repo = init_repo(tmp_path)
    code, stdout, stderr = run_hook(bash_payload(repo, "ls -la && bun test"))
    assert code == 0
    assert_allowed(stdout, stderr)


def test_git_add_of_oversized_file_is_denied_with_teaching_message(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, max_bytes=1000)
    write_file(repo, "big.bin", 2000)

    code, stdout, stderr = run_hook(bash_payload(repo, "git add big.bin"))

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "big.bin")
    assert_denied(stdout, "guards.largeFileCommit.maxBytes")
    assert_denied(stdout, ".gitignore")
    blocked = [event for event in events(repo) if event["result"] == "blocked"]
    assert blocked and blocked[0]["hook"] == "large-file-commit-guard"
    assert blocked[0]["rule"] == "add"


def test_git_add_of_small_files_is_allowed_and_logged(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, max_bytes=1000)
    write_file(repo, "small.txt", 10)

    code, stdout, stderr = run_hook(bash_payload(repo, "git add small.txt"))

    assert code == 0
    assert_allowed(stdout, stderr)
    assert any(event["result"] == "allowed" for event in events(repo))


def test_git_add_capital_a_catches_untracked_oversized_file(tmp_path: Path) -> None:
    # 2026-07-22 guard outcome eval, offline finding: `-A` (capital) was not
    # recognized, so a single-call `git add -A && git commit` passed unchecked.
    repo = init_repo(tmp_path, max_bytes=1000)
    write_file(repo, "big.bin", 2000)

    code, stdout, _ = run_hook(bash_payload(repo, "git add -A"))

    assert code == 0
    assert_denied(stdout, "big.bin")


def test_single_call_add_all_and_commit_is_denied(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, max_bytes=1000)
    write_file(repo, "big.bin", 2000)

    code, stdout, _ = run_hook(bash_payload(repo, 'git add -A && git commit -m "sweep"'))

    assert code == 0
    assert_denied(stdout, "big.bin")


def test_git_add_dot_catches_untracked_oversized_file(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, max_bytes=1000)
    write_file(repo, "small.txt", 10)
    write_file(repo, "assets/huge.dat", 5000)

    code, stdout, _ = run_hook(bash_payload(repo, "git add ."))

    assert code == 0
    assert_denied(stdout, "assets/huge.dat")


def test_git_commit_checks_only_staged_files(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, max_bytes=1000)
    write_file(repo, "small.txt", 10)
    write_file(repo, "big.bin", 2000)
    git(repo, "add", "small.txt")

    code, stdout, stderr = run_hook(bash_payload(repo, 'git commit -m "small only"'))

    assert code == 0
    assert_allowed(stdout, stderr)


def test_git_commit_with_oversized_staged_file_is_denied(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, max_bytes=1000)
    write_file(repo, "big.bin", 2000)
    git(repo, "add", "-f", "big.bin")

    code, stdout, _ = run_hook(bash_payload(repo, 'git commit -m "sneak it in"'))

    assert code == 0
    assert_denied(stdout, "big.bin")
    assert_denied(stdout, "git commit")


def test_git_commit_all_flag_sweeps_in_oversized_tracked_modification(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, max_bytes=1000)
    write_file(repo, "data.txt", 10)
    git(repo, "add", "data.txt")
    git(repo, "commit", "-q", "-m", "seed")
    write_file(repo, "data.txt", 3000)

    code, stdout, _ = run_hook(bash_payload(repo, 'git commit -am "grew"'))

    assert code == 0
    assert_denied(stdout, "data.txt")


def test_chained_command_still_checks_the_git_segment(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, max_bytes=1000)
    write_file(repo, "big.bin", 2000)

    code, stdout, _ = run_hook(bash_payload(repo, "echo start && git add big.bin && echo done"))

    assert code == 0
    assert_denied(stdout, "big.bin")


def test_dry_run_add_is_never_blocked(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, max_bytes=1000)
    write_file(repo, "big.bin", 2000)

    code, stdout, stderr = run_hook(bash_payload(repo, "git add --dry-run big.bin"))

    assert code == 0
    assert_allowed(stdout, stderr)


def test_configured_message_is_appended_to_the_deny_reason(tmp_path: Path) -> None:
    repo = init_repo(
        tmp_path,
        config={"maxBytes": 1000, "message": "Seen 3x in sessions: large blobs forced git history rewrites."},
    )
    write_file(repo, "big.bin", 2000)

    code, stdout, _ = run_hook(bash_payload(repo, "git add big.bin"))

    assert code == 0
    assert_denied(stdout, "Seen 3x in sessions")


def test_enabled_false_disables_the_guard(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, config={"maxBytes": 1000, "enabled": False})
    write_file(repo, "big.bin", 2000)

    code, stdout, stderr = run_hook(bash_payload(repo, "git add big.bin"))

    assert code == 0
    assert_allowed(stdout, stderr)


def test_missing_manifest_fails_open_with_logged_event(tmp_path: Path) -> None:
    git(tmp_path, "init", "-q")
    write_file(tmp_path, "big.bin", 20_000_000)

    code, stdout, stderr = run_hook(bash_payload(tmp_path, "git add big.bin"))

    assert code == 0
    assert_allowed(stdout, stderr)
    assert any(event["result"] == "error:manifest-unreadable" for event in events(tmp_path))


def test_default_threshold_applies_when_config_has_no_max_bytes(tmp_path: Path) -> None:
    repo = init_repo(tmp_path, max_bytes=None, config={})
    big = repo / "big.bin"
    with big.open("wb") as handle:
        handle.seek(6 * 1024 * 1024 - 1)
        handle.write(b"0")

    code, stdout, _ = run_hook(bash_payload(repo, "git add big.bin"))

    assert code == 0
    assert_denied(stdout, "big.bin")


def test_outside_a_git_repository_fails_open(tmp_path: Path) -> None:
    (tmp_path / ".farrier.json").write_text(
        json.dumps({"packIds": ["generic"], "guards": {"largeFileCommit": {"maxBytes": 10}}}),
        encoding="utf-8",
    )
    write_file(tmp_path, "big.bin", 2000)

    code, stdout, stderr = run_hook(bash_payload(tmp_path, "git add big.bin"))

    assert code == 0
    assert_allowed(stdout, stderr)
    assert any(event["result"].startswith("error:") for event in events(tmp_path))


def test_malformed_payload_fails_closed() -> None:
    code, stdout, stderr = run_hook({}, raw="{not-json")
    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    assert data["hookSpecificOutput"]["permissionDecision"] == "deny"


def test_non_bash_tools_are_ignored(tmp_path: Path) -> None:
    payload = bash_payload(tmp_path, "git add big.bin")
    payload["tool_name"] = "Edit"
    code, stdout, stderr = run_hook(payload)
    assert code == 0
    assert_allowed(stdout, stderr)

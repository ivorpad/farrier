from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).with_name("secret-shield.py")


def run_hook(payload: dict) -> tuple[int, str, str]:
    proc = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return proc.returncode, proc.stdout, proc.stderr


def pretool_payload(tool_name: str, tool_input: dict) -> dict:
    return {
        "session_id": "test",
        "transcript_path": "/tmp/transcript.jsonl",
        "cwd": "/tmp/project",
        "hook_event_name": "PreToolUse",
        "tool_name": tool_name,
        "tool_input": tool_input,
    }


def parse_stdout(stdout: str) -> dict:
    assert stdout.strip()
    return json.loads(stdout)


def assert_denied(stdout: str) -> None:
    data = parse_stdout(stdout)
    output = data["hookSpecificOutput"]
    assert output["hookEventName"] == "PreToolUse"
    assert output["permissionDecision"] == "deny"
    assert (
        "Do not read" in output["permissionDecisionReason"]
        or "Blocked" in output["permissionDecisionReason"]
    )


def assert_allowed(stdout: str, stderr: str) -> None:
    assert stdout == ""
    assert stderr == ""


def test_denies_read_env_file() -> None:
    code, stdout, stderr = run_hook(pretool_payload("Read", {"file_path": ".env"}))

    assert code == 0
    assert stderr == ""
    assert_denied(stdout)


def test_denies_read_env_local_file() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Read", {"file_path": "/repo/.env.local"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout)


def test_denies_bash_cat_env() -> None:
    code, stdout, stderr = run_hook(pretool_payload("Bash", {"command": "cat .env"}))

    assert code == 0
    assert stderr == ""
    assert_denied(stdout)


def test_denies_codex_simple_bash_payload() -> None:
    payload = pretool_payload("Bash", {"command": "sed -n '1,5p' .env.production"})
    payload.update(
        {
            "turn_id": "turn-1",
            "tool_use_id": "call-1",
            "model": "gpt-codex",
            "permission_mode": "default",
        }
    )

    code, stdout, stderr = run_hook(payload)

    assert code == 0
    assert stderr == ""
    assert_denied(stdout)


def test_allows_env_example_file() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Read", {"file_path": ".env.example"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_allows_env_sample_file() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Bash", {"command": "cat .env.sample"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_allows_env_template_file() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Grep", {"pattern": "API_URL", "path": ".env.template"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_allows_env_defaults_file() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Read", {"file_path": "/repo/.env.defaults"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_denies_private_key_path() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Read", {"file_path": "/home/me/.ssh/id_ed25519"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout)


def test_denies_pem_file() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Read", {"file_path": "certs/private.pem"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout)


def test_denies_key_file() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Bash", {"command": "cat secrets/service.key"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout)


def test_denies_env_glob_in_grep_tool() -> None:
    # 2026-07-21 eval: content-mode Grep over `.env*` slipped past literal
    # matching and pulled canary values into context.
    code, stdout, stderr = run_hook(
        pretool_payload("Grep", {"pattern": "FARRIER", "glob": ".env*", "output_mode": "content"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout)


def test_denies_env_glob_in_bash_command() -> None:
    code, stdout, stderr = run_hook(pretool_payload("Bash", {"command": "rg SECRET .env*"}))

    assert code == 0
    assert stderr == ""
    assert_denied(stdout)


def test_allows_env_example_glob() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Grep", {"pattern": "X", "glob": ".env.example*"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_allows_example_discovery_command_with_env_prefixed_glob() -> None:
    # 2026-07-21 round 3: `.env.*.example` starts with `.env.` but is plainly
    # an example glob; the suffix allowlist must let it through.
    code, stdout, stderr = run_hook(
        pretool_payload("Bash", {"command": "rg --files -g '.env.example' -g '.env.*.example'"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_denies_broad_env_glob_that_matches_real_env() -> None:
    code, stdout, stderr = run_hook(pretool_payload("Bash", {"command": "rg --files -g '.env*'"}))

    assert code == 0
    assert_denied(stdout)


def test_denies_key_glob() -> None:
    code, stdout, stderr = run_hook(pretool_payload("Bash", {"command": "cat secrets/*.key*"}))

    assert code == 0
    assert stderr == ""
    assert_denied(stdout)


def test_blocked_event_records_redacted_detail(tmp_path_factory) -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as cwd:
        payload = pretool_payload("Bash", {"command": "cat .env"})
        payload["cwd"] = cwd
        code, stdout, stderr = run_hook(payload)
        assert code == 0
        assert_denied(stdout)
        events = (Path(cwd) / ".farrier" / "runtime" / "events.jsonl").read_text(encoding="utf-8")
        entry = json.loads(events.strip().splitlines()[-1])
        assert entry["result"] == "blocked"
        assert entry["detail"] == "cat .env"


def test_allows_normal_source_file() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Read", {"file_path": "src/app/main.py"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)

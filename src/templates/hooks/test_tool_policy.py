from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).with_name("tool-policy.py")


def write_rules(tmp_path: Path, rules: list[dict]) -> None:
    rules_dir = tmp_path / ".claude" / "hooks"
    rules_dir.mkdir(parents=True)
    (rules_dir / "tool-policy-rules.json").write_text(
        json.dumps(
            {
                "version": 1,
                "rules": rules,
            }
        ),
        encoding="utf-8",
    )


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


def pretool_payload(tmp_path: Path, tool_name: str, tool_input: dict) -> dict:
    return {
        "session_id": "test",
        "transcript_path": "/tmp/transcript.jsonl",
        "cwd": str(tmp_path),
        "hook_event_name": "PreToolUse",
        "tool_name": tool_name,
        "tool_input": tool_input,
    }


def python_rules() -> list[dict]:
    return [
        {
            "id": "python-use-uv-not-python-m-pip",
            "description": "Python projects managed by uv must not install dependencies with python -m pip.",
            "tool": "Bash",
            "commandPattern": r"(^|[;&|()\s])python3?\s+-m\s+pip\b",
            "flags": "i",
            "message": "Do not use python -m pip in this uv-managed project.",
            "redirect": "Use `uv add <package>` for project dependencies, or `uv run --with <package> <command>` for one-off tools.",
        },
        {
            "id": "python-use-uv-not-pip-install",
            "description": "Python projects managed by uv must not install dependencies with pip or pip3.",
            "tool": "Bash",
            "commandPattern": r"(^|[;&|()\s])pip3?\s+install\b",
            "flags": "i",
            "message": "Do not use pip or pip3 install in this uv-managed project.",
            "redirect": "Use `uv add <package>` for project dependencies, or `uv run --with <package> <command>` for one-off tools.",
        },
    ]


def parse_stdout(stdout: str) -> dict:
    assert stdout.strip()
    return json.loads(stdout)


def assert_denied(stdout: str, rule_id: str) -> None:
    data = parse_stdout(stdout)
    output = data["hookSpecificOutput"]
    assert output["hookEventName"] == "PreToolUse"
    assert output["permissionDecision"] == "deny"
    assert rule_id in output["permissionDecisionReason"]
    assert "Redirect:" in output["permissionDecisionReason"]


def assert_allowed(stdout: str, stderr: str) -> None:
    assert stdout == ""
    assert stderr == ""


def test_missing_rules_file_passes_silently(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Bash", {"command": "pip install requests"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_denies_pip_install(tmp_path: Path) -> None:
    write_rules(tmp_path, python_rules())

    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Bash", {"command": "pip install requests"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "python-use-uv-not-pip-install")


def test_denies_codex_bash_payload_using_canonical_rules_file(tmp_path: Path) -> None:
    write_rules(tmp_path, python_rules())
    payload = pretool_payload(tmp_path, "Bash", {"command": "pip install requests"})
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
    assert_denied(stdout, "python-use-uv-not-pip-install")


def test_denies_pip3_install_case_insensitive(tmp_path: Path) -> None:
    write_rules(tmp_path, python_rules())

    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Bash", {"command": "PIP3 install fastapi"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "python-use-uv-not-pip-install")


def test_denies_python_m_pip(tmp_path: Path) -> None:
    write_rules(tmp_path, python_rules())

    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Bash", {"command": "python -m pip install pytest"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "python-use-uv-not-python-m-pip")


def test_denies_python3_m_pip_after_shell_separator(tmp_path: Path) -> None:
    write_rules(tmp_path, python_rules())

    code, stdout, stderr = run_hook(
        pretool_payload(
            tmp_path, "Bash", {"command": "echo ok && python3 -m pip install pytest"}
        )
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "python-use-uv-not-python-m-pip")


def test_allows_uv_add(tmp_path: Path) -> None:
    write_rules(tmp_path, python_rules())

    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Bash", {"command": "uv add requests"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_ignores_non_bash_tool(tmp_path: Path) -> None:
    write_rules(tmp_path, python_rules())

    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Read", {"file_path": "pip install requests"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_malformed_rules_file_passes_silently(tmp_path: Path) -> None:
    rules_dir = tmp_path / ".claude" / "hooks"
    rules_dir.mkdir(parents=True)
    (rules_dir / "tool-policy-rules.json").write_text("{not json", encoding="utf-8")

    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Bash", {"command": "pip install requests"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_invalid_regex_rule_is_skipped(tmp_path: Path) -> None:
    write_rules(
        tmp_path,
        [
            {
                "id": "broken",
                "description": "broken",
                "tool": "Bash",
                "commandPattern": "[",
                "message": "broken",
                "redirect": "broken",
            }
        ],
    )

    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Bash", {"command": "pip install requests"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)

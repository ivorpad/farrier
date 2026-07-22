from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).with_name("tool-policy.py")


def write_rules(tmp_path: Path, rules: list[dict]) -> None:
    rules_dir = tmp_path / ".farrier" / "hooks"
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


def assert_blocked(stdout: str, expected: str) -> None:
    output = parse_stdout(stdout)["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    assert expected in output["permissionDecisionReason"]


def assert_allowed(stdout: str, stderr: str) -> None:
    assert stdout == ""
    assert stderr == ""


def test_missing_rules_file_fails_closed(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Bash", {"command": "pip install requests"})
    )

    assert code == 0
    assert stderr == ""
    assert_blocked(stdout, "missing, unreadable, or invalid JSON")


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


def test_malformed_rules_file_fails_closed(tmp_path: Path) -> None:
    rules_dir = tmp_path / ".farrier" / "hooks"
    rules_dir.mkdir(parents=True)
    (rules_dir / "tool-policy-rules.json").write_text("{not json", encoding="utf-8")

    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Bash", {"command": "pip install requests"})
    )

    assert code == 0
    assert stderr == ""
    assert_blocked(stdout, "missing, unreadable, or invalid JSON")



def test_every_malformed_selected_rule_shape_fails_closed(tmp_path: Path) -> None:
    valid = python_rules()[0]
    malformed_documents: list[tuple[str, object]] = [
        ("missing-version", {"rules": [valid]}),
        ("wrong-version", {"version": 2, "rules": [valid]}),
        ("root-array", []),
        ("rules-object", {"version": 1, "rules": {}}),
        ("rule-scalar", {"version": 1, "rules": ["bad"]}),
        ("wrong-tool", {"version": 1, "rules": [{**valid, "tool": "Read"}]}),
        ("invalid-id", {"version": 1, "rules": [{**valid, "id": "Not_Kebab"}]}),
        ("empty-flags", {"version": 1, "rules": [{**valid, "flags": ""}]}),
        ("invalid-flags", {"version": 1, "rules": [{**valid, "flags": "x"}]}),
        ("duplicate-flags", {"version": 1, "rules": [{**valid, "flags": "ii"}]}),
        ("non-string-flags", {"version": 1, "rules": [{**valid, "flags": 1}]}),
        ("duplicate-id", {"version": 1, "rules": [valid, dict(valid)]}),
        ("invalid-regex", {"version": 1, "rules": [{**valid, "commandPattern": "["}]}),
    ]
    for field in ("id", "description", "tool", "commandPattern", "message", "redirect"):
        malformed_documents.append(
            (f"missing-{field}", {"version": 1, "rules": [{key: value for key, value in valid.items() if key != field}]})
        )
        malformed_documents.append(
            (f"empty-{field}", {"version": 1, "rules": [{**valid, field: ""}]})
        )

    for name, document in malformed_documents:
        case_dir = tmp_path / name
        rules_dir = case_dir / ".farrier" / "hooks"
        rules_dir.mkdir(parents=True)
        (rules_dir / "tool-policy-rules.json").write_text(json.dumps(document), encoding="utf-8")
        code, stdout, stderr = run_hook(
            pretool_payload(case_dir, "Bash", {"command": "echo safe"})
        )
        assert code == 0
        assert stderr == ""
        assert_blocked(stdout, ".farrier/hooks/tool-policy-rules.json")


def test_invalid_regex_rule_fails_closed(tmp_path: Path) -> None:
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
    assert stderr == ""
    assert_blocked(stdout, "commandPattern is invalid")


def test_matching_rule_deny_reason_is_redacted_and_bounded(tmp_path: Path) -> None:
    rule = python_rules()[1]
    rule["message"] = "token=seeded-secret dev@example.com"
    rule["redirect"] = "Bearer abcdefghijklmnop"
    write_rules(tmp_path, [rule])

    code, stdout, stderr = run_hook(
        pretool_payload(tmp_path, "Bash", {"command": "pip install requests"})
    )

    assert code == 0
    assert stderr == ""
    assert_blocked(stdout, "[REDACTED]")
    assert "seeded-secret" not in stdout
    assert "dev@example.com" not in stdout
    assert "abcdefghijklmnop" not in stdout
    assert len(stdout.encode("utf-8")) < 2500


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

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).with_name("taste-guard.py")


def run_hook(payload: dict, *, raw: str | None = None) -> tuple[int, str, str]:
    proc = subprocess.run(
        [sys.executable, str(HOOK)],
        input=raw if raw is not None else json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    return proc.returncode, proc.stdout, proc.stderr


def edit_payload(cwd: Path, new_string: str, *, tool: str = "Edit") -> dict:
    tool_input = {"content": new_string} if tool == "Write" else {"new_string": new_string, "old_string": ""}
    return {
        "session_id": "test",
        "transcript_path": "/tmp/transcript.jsonl",
        "cwd": str(cwd),
        "hook_event_name": "PreToolUse",
        "tool_name": tool,
        "tool_input": tool_input,
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


def write_manifest(cwd: Path, guard: dict | None) -> None:
    manifest: dict = {"packIds": ["generic"]}
    if guard is not None:
        manifest["guards"] = {"tasteGuard": guard}
    (cwd / ".farrier.json").write_text(json.dumps(manifest), encoding="utf-8")


def events(cwd: Path) -> list[dict]:
    path = cwd / ".farrier" / "runtime" / "events.jsonl"
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


INLINE_IMPORT_RULE = {
    "ruleId": "no-inline-imports",
    "patterns": [r"def \w+\([^)]*\):\n(?:\s*#.*\n)*\s+import \w"],
    "message": "Seen 4x in sessions: put imports at module top, not inside functions.",
}


def test_matching_edit_is_denied_and_cites_the_rule(tmp_path: Path) -> None:
    write_manifest(tmp_path, {"rules": [INLINE_IMPORT_RULE]})

    code, stdout, stderr = run_hook(edit_payload(tmp_path, "def handler(event):\n    import os\n    return os"))

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "no-inline-imports")
    assert_denied(stdout, "imports at module top")
    blocked = [event for event in events(tmp_path) if event["result"] == "blocked"]
    assert blocked and blocked[0]["hook"] == "taste-guard"
    assert blocked[0]["rule"] == "no-inline-imports"


def test_clean_edit_is_allowed_and_logged(tmp_path: Path) -> None:
    write_manifest(tmp_path, {"rules": [INLINE_IMPORT_RULE]})

    code, stdout, stderr = run_hook(edit_payload(tmp_path, "import os\n\ndef handler(event):\n    return os"))

    assert code == 0
    assert_allowed(stdout, stderr)
    assert any(event["result"] == "allowed" for event in events(tmp_path))


def test_write_tool_content_is_checked(tmp_path: Path) -> None:
    write_manifest(tmp_path, {"rules": [INLINE_IMPORT_RULE]})

    code, stdout, _ = run_hook(edit_payload(tmp_path, "def f(x):\n    import sys\n    return sys", tool="Write"))

    assert code == 0
    assert_denied(stdout, "no-inline-imports")


def test_uncompilable_pattern_never_blocks_and_fails_open(tmp_path: Path) -> None:
    write_manifest(tmp_path, {"rules": [{"ruleId": "broken", "patterns": ["([unterminated"], "message": "x"}]})

    code, stdout, stderr = run_hook(edit_payload(tmp_path, "def handler(event):\n    import os"))

    assert code == 0
    assert_allowed(stdout, stderr)


def test_missing_manifest_fails_open_with_logged_event(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(edit_payload(tmp_path, "def handler(event):\n    import os"))

    assert code == 0
    assert_allowed(stdout, stderr)
    assert any(event["result"] == "error:manifest-unreadable" for event in events(tmp_path))


def test_enabled_false_disables_the_guard(tmp_path: Path) -> None:
    write_manifest(tmp_path, {"enabled": False, "rules": [INLINE_IMPORT_RULE]})

    code, stdout, stderr = run_hook(edit_payload(tmp_path, "def handler(event):\n    import os"))

    assert code == 0
    assert_allowed(stdout, stderr)


def test_empty_rules_allows(tmp_path: Path) -> None:
    write_manifest(tmp_path, {"rules": []})

    code, stdout, stderr = run_hook(edit_payload(tmp_path, "def handler(event):\n    import os"))

    assert code == 0
    assert_allowed(stdout, stderr)


def test_non_edit_tools_are_ignored(tmp_path: Path) -> None:
    write_manifest(tmp_path, {"rules": [INLINE_IMPORT_RULE]})
    payload = edit_payload(tmp_path, "def handler(event):\n    import os")
    payload["tool_name"] = "Bash"
    payload["tool_input"] = {"command": "def handler(event):\n    import os"}

    code, stdout, stderr = run_hook(payload)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_malformed_payload_fails_closed() -> None:
    code, stdout, stderr = run_hook({}, raw="{not-json")
    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    assert data["hookSpecificOutput"]["permissionDecision"] == "deny"

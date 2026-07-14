from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).with_name("write-guard.py")


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


def assert_denied(stdout: str, expected: str) -> None:
    data = parse_stdout(stdout)
    output = data["hookSpecificOutput"]
    assert output["hookEventName"] == "PreToolUse"
    assert output["permissionDecision"] == "deny"
    assert expected in output["permissionDecisionReason"]


def assert_allowed(stdout: str, stderr: str) -> None:
    assert stdout == ""
    assert stderr == ""


def test_denies_git_directory_write() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Write", {"file_path": ".git/config", "content": "x"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "git commands")


def test_denies_nested_git_directory_write() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Edit", {"file_path": "/repo/.git/refs/heads/main"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "out-of-root")


def test_denies_skills_lock_write() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Write", {"file_path": "skills-lock.json", "content": "{}"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "skills CLI")


def test_denies_farrier_manifest_write() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload(
            "Edit", {"file_path": ".farrier.json", "old_string": "x", "new_string": "y"}
        )
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "farrier update")


def test_denies_lockfile_write() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Write", {"file_path": "uv.lock", "content": "lock"})
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "Lockfiles are owned by their package manager")


def test_denies_lockfile_write_in_subdirectory() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload(
            "MultiEdit", {"file_path": "frontend/pnpm-lock.yaml", "edits": []}
        )
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "Lockfiles are owned by their package manager")


def test_denies_notebook_path_lockfile() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload(
            "NotebookEdit", {"notebook_path": "package-lock.json", "cell_id": "1"}
        )
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "Lockfiles are owned by their package manager")


def test_allows_normal_source_write() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Write", {"file_path": "src/app.py", "content": "print('ok')"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_content_only_mention_does_not_deny() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload(
            "Write",
            {
                "file_path": "src/docs.py",
                "content": "Mention uv.lock, .farrier.json, skills-lock.json, and .git/config in documentation.",
            },
        )
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_ignores_unrelated_tool() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload("Read", {"file_path": ".farrier.json"})
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_recursively_finds_path_like_fields_only() -> None:
    code, stdout, stderr = run_hook(
        pretool_payload(
            "MultiEdit",
            {
                "edits": [
                    {
                        "path": "src/app.py",
                        "new_string": "ok",
                    },
                    {
                        "path": ".git/index",
                        "new_string": "bad",
                    },
                ]
            },
        )
    )

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "git commands")


def test_codex_apply_patch_checks_update_add_and_delete_headers() -> None:
    patch = """*** Begin Patch
*** Update File: src/app.py
@@
-old
+new
*** Add File: docs/note.md
+note
*** Delete File: nested/.farrier.json
*** End Patch"""

    code, stdout, stderr = run_hook(pretool_payload("apply_patch", {"command": patch}))

    assert code == 0
    assert stderr == ""
    assert_denied(stdout, "farrier update")


def test_codex_apply_patch_allows_unprotected_headers() -> None:
    patch = """*** Begin Patch
*** Update File: src/app.py
*** Add File: docs/note.md
*** Delete File: src/old.py
*** End Patch"""

    code, stdout, stderr = run_hook(pretool_payload("apply_patch", {"command": patch}))

    assert code == 0
    assert_allowed(stdout, stderr)

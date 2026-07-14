from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).parent


def run(name: str, payload: object, *, raw: str | None = None) -> dict | None:
    proc = subprocess.run(
        [sys.executable, str(ROOT / name)],
        input=raw if raw is not None else json.dumps(payload),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=3,
        check=False,
    )
    assert proc.returncode == 0
    assert proc.stderr == ""
    return json.loads(proc.stdout) if proc.stdout.strip() else None


def pretool(tmp_path: Path, tool: str, tool_input: object) -> dict:
    return {
        "hook_event_name": "PreToolUse",
        "cwd": str(tmp_path),
        "tool_name": tool,
        "tool_input": tool_input,
    }


def denied(output: dict | None) -> bool:
    return bool(output and output.get("hookSpecificOutput", {}).get("permissionDecision") == "deny")


def test_seeded_secret_corpus_has_zero_escape_and_safe_examples_do_not_false_block(tmp_path: Path) -> None:
    adversarial = [
        pretool(tmp_path, "Read", {"file_path": ".env"}),
        pretool(tmp_path, "Bash", {"command": "sed -n 1p nested/.env.production"}),
        pretool(tmp_path, "Grep", {"path": ".ssh/id_ed25519", "pattern": "BEGIN"}),
        pretool(tmp_path, "Read", {"file_path": "cert/private.pem"}),
        pretool(tmp_path, "Read", {"file_path": "\'.ENV.PRODUCTION\'"}),
        pretool(tmp_path, "Grep", {"path": ".\\\\SSH\\\\ID_ED25519", "pattern": "BEGIN"}),
        pretool(tmp_path, "Bash", {"command": "cat \"./nested/../nested/SECRET.KEY\""}),
    ]
    safe = [
        pretool(tmp_path, "Read", {"file_path": ".env.example"}),
        pretool(tmp_path, "Grep", {"path": ".env.template", "pattern": "URL"}),
        pretool(tmp_path, "Read", {"file_path": "src/main.py"}),
    ]
    assert all(denied(run("secret-shield.py", item)) for item in adversarial)
    assert not any(denied(run("secret-shield.py", item)) for item in safe)


def test_out_of_root_and_ambiguous_recognized_mutations_fail_closed(tmp_path: Path) -> None:
    adversarial = [
        pretool(tmp_path, "Write", {"file_path": "../escape.txt"}),
        pretool(tmp_path, "Edit", {"file_path": str(tmp_path.parent / "escape.txt")}),
        pretool(tmp_path, "apply_patch", {"command": "*** Begin Patch\n*** End Patch"}),
        pretool(tmp_path, "MultiEdit", {"edits": [{"new_string": "ambiguous"}]}),
    ]
    safe = [
        pretool(tmp_path, "Write", {"file_path": "src/app.py"}),
        pretool(tmp_path, "Edit", {"file_path": "docs/note.md"}),
    ]
    assert all(denied(run("write-guard.py", item)) for item in adversarial)
    assert not any(denied(run("write-guard.py", item)) for item in safe)


def test_blocking_hooks_reject_malformed_and_oversize_payloads() -> None:
    for hook in ("secret-shield.py", "tool-policy.py", "write-guard.py"):
        assert denied(run(hook, {}, raw="{not-json"))
        assert denied(run(hook, {}, raw=json.dumps({"padding": "x" * (257 * 1024)})))


def test_every_hook_handles_huge_integer_json_as_bounded_malformed_input() -> None:
    raw = '{"value":' + ("9" * 10_000) + "}"
    for hook in ("secret-shield.py", "tool-policy.py", "write-guard.py"):
        output = run(hook, {}, raw=raw)
        assert denied(output)
        assert "9" * 100 not in json.dumps(output)

    stop = run("stop-judge.py", {}, raw=raw)
    assert stop and stop.get("decision") == "block"
    assert "9" * 100 not in json.dumps(stop)

    for hook in ("quality-judge.py", "verb-runner.py"):
        output = run(hook, {}, raw=raw)
        context = output and output.get("hookSpecificOutput", {}).get("additionalContext")
        assert isinstance(context, str) and context
        assert "9" * 100 not in json.dumps(output)

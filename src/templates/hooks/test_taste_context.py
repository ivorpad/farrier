from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


HOOK = Path(__file__).with_name("taste-context.py")


def run_hook(payload: dict | None, *, raw: str | None = None) -> tuple[int, str, str]:
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


def prompt_payload(cwd: Path, prompt: str = "do the thing") -> dict:
    return {
        "session_id": "test",
        "cwd": str(cwd),
        "hook_event_name": "UserPromptSubmit",
        "prompt": prompt,
    }


def write_kb(cwd: Path, rules: list[dict], *, version: object = 1) -> None:
    (cwd / ".farrier").mkdir(parents=True, exist_ok=True)
    (cwd / ".farrier" / "preferences.json").write_text(json.dumps({"version": version, "rules": rules}), encoding="utf-8")


def rule(rule_id: str, sentence: str, tier: str = "declarative") -> dict:
    return {"id": rule_id, "rule": sentence, "tier": tier, "evidence": ["steer 1"], "addedAt": "2026-07-27"}


def injected_context(stdout: str) -> str:
    return json.loads(stdout)["hookSpecificOutput"]["additionalContext"]


def test_rules_are_injected_as_additional_context(tmp_path: Path) -> None:
    write_kb(tmp_path, [rule("a", "Keep functions short."), rule("b", "Name booleans as predicates.")])

    code, stdout, stderr = run_hook(prompt_payload(tmp_path))

    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    assert data["hookSpecificOutput"]["hookEventName"] == "UserPromptSubmit"
    context = injected_context(stdout)
    assert "reviewed team preferences" in context
    assert "- Keep functions short." in context
    assert "- Name booleans as predicates." in context


def test_injection_is_bounded_to_twenty_rules(tmp_path: Path) -> None:
    write_kb(tmp_path, [rule(f"r{index}", f"Rule number {index}.") for index in range(30)])

    code, stdout, _ = run_hook(prompt_payload(tmp_path))

    assert code == 0
    context = injected_context(stdout)
    assert context.count("\n- ") == 20


def test_empty_kb_injects_nothing(tmp_path: Path) -> None:
    write_kb(tmp_path, [])

    code, stdout, stderr = run_hook(prompt_payload(tmp_path))

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_missing_kb_fails_open(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(prompt_payload(tmp_path))

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_malformed_kb_fails_open_with_no_output(tmp_path: Path) -> None:
    (tmp_path / ".farrier").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".farrier" / "preferences.json").write_text("{not json", encoding="utf-8")

    code, stdout, stderr = run_hook(prompt_payload(tmp_path))

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_wrong_kb_version_injects_nothing(tmp_path: Path) -> None:
    write_kb(tmp_path, [rule("a", "Keep functions short.")], version=2)

    code, stdout, _ = run_hook(prompt_payload(tmp_path))

    assert code == 0
    assert stdout == ""


def test_malformed_payload_fails_open(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(None, raw="{not-json")
    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_non_prompt_events_are_ignored(tmp_path: Path) -> None:
    write_kb(tmp_path, [rule("a", "Keep functions short.")])
    payload = prompt_payload(tmp_path)
    payload["hook_event_name"] = "PreToolUse"

    code, stdout, _ = run_hook(payload)

    assert code == 0
    assert stdout == ""

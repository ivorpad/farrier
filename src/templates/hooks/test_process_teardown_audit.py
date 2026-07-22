from __future__ import annotations

import json
import subprocess
import sys
import uuid
from pathlib import Path

import pytest


HOOK = Path(__file__).with_name("process-teardown-audit.py")


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


def stop_payload(cwd: Path, *, stop_hook_active: object = False) -> dict:
    return {
        "session_id": "test",
        "transcript_path": "/tmp/transcript.jsonl",
        "cwd": str(cwd),
        "hook_event_name": "Stop",
        "stop_hook_active": stop_hook_active,
    }


def write_manifest(cwd: Path, teardown_config: object) -> None:
    manifest = {"packIds": ["generic"], "guards": {"processTeardown": teardown_config}}
    (cwd / ".farrier.json").write_text(json.dumps(manifest), encoding="utf-8")


def events(cwd: Path) -> list[dict]:
    path = cwd / ".farrier" / "runtime" / "events.jsonl"
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


@pytest.fixture
def marker_process():
    """A live process with a unique marker in its command line."""
    marker = f"farrier-teardown-test-{uuid.uuid4().hex}"
    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(60)", marker],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        yield marker, proc.pid
    finally:
        proc.kill()
        proc.wait()


def test_leftover_matching_process_blocks_stop_once_with_the_listing(tmp_path: Path, marker_process) -> None:
    marker, pid = marker_process
    write_manifest(tmp_path, {"patterns": [marker]})

    code, stdout, stderr = run_hook(stop_payload(tmp_path))

    assert code == 0
    assert stderr == ""
    data = json.loads(stdout)
    assert data["decision"] == "block"
    assert f"PID {pid}" in data["reason"]
    assert "guards.processTeardown" in data["reason"]
    assert "kill" in data["reason"]
    advisory = [event for event in events(tmp_path) if event["result"] == "advisory"]
    assert advisory and advisory[0]["hook"] == "process-teardown-audit"


def test_second_stop_after_the_advisory_always_passes(tmp_path: Path, marker_process) -> None:
    marker, _ = marker_process
    write_manifest(tmp_path, {"patterns": [marker]})

    code, stdout, stderr = run_hook(stop_payload(tmp_path, stop_hook_active=True))

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_clean_process_table_passes_and_logs(tmp_path: Path) -> None:
    write_manifest(tmp_path, {"patterns": [f"no-such-process-{uuid.uuid4().hex}"]})

    code, stdout, stderr = run_hook(stop_payload(tmp_path))

    assert code == 0
    assert stdout == ""
    assert stderr == ""
    assert any(event["result"] == "clean" for event in events(tmp_path))


def test_no_patterns_configured_is_inert(tmp_path: Path) -> None:
    write_manifest(tmp_path, {})

    code, stdout, stderr = run_hook(stop_payload(tmp_path))

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_configured_message_is_appended(tmp_path: Path, marker_process) -> None:
    marker, _ = marker_process
    write_manifest(
        tmp_path,
        {"patterns": [marker], "message": "Seen 2x: orphaned Electron test runners kept ports busy."},
    )

    code, stdout, _ = run_hook(stop_payload(tmp_path))

    assert code == 0
    assert "orphaned Electron test runners" in json.loads(stdout)["reason"]


def test_enabled_false_disables_the_audit(tmp_path: Path, marker_process) -> None:
    marker, _ = marker_process
    write_manifest(tmp_path, {"patterns": [marker], "enabled": False})

    code, stdout, stderr = run_hook(stop_payload(tmp_path))

    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_malformed_patterns_fail_open_with_logged_event(tmp_path: Path) -> None:
    for bad in ("not-a-list", ["("], [""], [123]):
        write_manifest(tmp_path, {"patterns": bad})
        code, stdout, stderr = run_hook(stop_payload(tmp_path))
        assert code == 0
        assert stdout == ""
        assert stderr == ""
    assert any(event["result"] == "error:malformed-patterns" for event in events(tmp_path))


def test_missing_manifest_fails_open_with_logged_event(tmp_path: Path) -> None:
    code, stdout, stderr = run_hook(stop_payload(tmp_path))

    assert code == 0
    assert stdout == ""
    assert stderr == ""
    assert any(event["result"] == "error:manifest-unreadable" for event in events(tmp_path))


def test_malformed_payload_fails_open() -> None:
    code, stdout, stderr = run_hook({}, raw="{not-json")
    assert code == 0
    assert stdout == ""
    assert stderr == ""


def test_wrong_event_passes_silently(tmp_path: Path) -> None:
    payload = stop_payload(tmp_path)
    payload["hook_event_name"] = "PreToolUse"
    code, stdout, stderr = run_hook(payload)
    assert code == 0
    assert stdout == ""
    assert stderr == ""

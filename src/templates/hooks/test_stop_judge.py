from __future__ import annotations

import importlib.util
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
    prompt: str = ".farrier/hooks/prompts/stop-judge-v1.txt",
    max_diff_bytes: int = 120000,
    max_untracked_files: int = 50,
) -> None:
    prompt_path = tmp_path / prompt
    if prompt == ".farrier/hooks/prompts/stop-judge-v1.txt":
        prompt_path.parent.mkdir(parents=True, exist_ok=True)
        prompt_path.write_text("STOP PROMPT", encoding="utf-8")
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


CLAUDE_ARG_CHECKS = (
    'test "$1" = "-p" || exit 7\n'
    'test "$2" = "--output-format" || exit 7\n'
    'test "$3" = "json" || exit 7\n'
    'test "$4" = "--model" || exit 7\n'
)


def claude_envelope_body(
    verdict: dict, *, usage: dict | None = None, checks: str = "", fenced: bool = False
) -> str:
    """Shell body that emits a `claude -p --output-format json` result envelope.

    The verdict JSON is embedded as the envelope's `result` string, mirroring the
    real Claude Code print-mode output the stop judge now parses. When `fenced`
    the verdict is wrapped in a ```json code fence inside `result`.
    """
    result_text = json.dumps(verdict)
    if fenced:
        result_text = f"```json\n{result_text}\n```"
    envelope: dict = {"type": "result", "subtype": "success", "is_error": False, "result": result_text}
    if usage is not None:
        envelope["usage"] = usage
    literal = json.dumps(envelope).replace("'", "'\\''")
    return f"{checks}printf '%s' '{literal}'\n"


def read_events(tmp_path: Path) -> list[dict]:
    text = (tmp_path / ".farrier" / "runtime" / "events.jsonl").read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


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


def test_no_valid_head_blocks_with_remediation(tmp_path: Path) -> None:
    git(tmp_path, "init")
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("uncommitted\n", encoding="utf-8")
    make_fake_executable(tmp_path, "claude", "echo called > called.txt\nexit 1")

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    assert parse_stdout(stdout)["decision"] == "block"
    assert not (tmp_path / "called.txt").exists()


def test_fake_claude_serious_blocks(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True, backend="claude", model="sonnet")
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        claude_envelope_body(
            {
                "severity": "serious",
                "summary": "secret-like config added",
                "findings": [{"path": "README.md", "message": "serious issue", "suggestion": "fix before stopping"}],
            },
            usage={"input_tokens": 321, "output_tokens": 44, "cache_read_input_tokens": 100},
            checks=(
                CLAUDE_ARG_CHECKS
                + 'test "$5" = "sonnet" || exit 7\n'
                + "cat > prompt.txt\n"
                + 'grep -q "diff --git" prompt.txt || exit 8\n'
            ),
        ),
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    data = parse_stdout(stdout)
    assert data["decision"] == "block"
    assert "semantic stop judge blocked stop" in data["reason"]
    assert "secret-like config added" in data["reason"]
    assert "README.md" in data["reason"]
    event = read_events(tmp_path)[-1]
    assert event["result"] == "serious"
    assert event["usage"] == {"input_tokens": 321, "output_tokens": 44, "cache_read_input_tokens": 100}


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
        claude_envelope_body(
            {
                "severity": "advisory",
                "summary": "minor cleanup",
                "findings": [{"path": "README.md", "message": "minor", "suggestion": "later"}],
            }
        ),
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    event = read_events(tmp_path)[-1]
    assert event["result"] == "advisory"
    assert "usage" not in event


def test_fake_backend_garbage_fails_open_and_logs_invalid_json(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")
    make_fake_executable(tmp_path, "claude", "echo not-json")

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert read_events(tmp_path)[-1]["result"] == "backend-error:invalid-json"


def test_backend_timeout_fails_open_and_logs_timeout(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True, timeout_ms=50)
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")
    make_fake_executable(tmp_path, "claude", "sleep 1\necho never")

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert read_events(tmp_path)[-1]["result"] == "backend-error:timeout"


def test_untracked_paths_are_included_in_prompt_payload(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "new_module.py").write_text("print('new')\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        claude_envelope_body(
            {"severity": "pass", "summary": "ok", "findings": []},
            checks=("cat > prompt.txt\n" + 'grep -q "new_module.py" prompt.txt || exit 8\n'),
        ),
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert "new_module.py" in (tmp_path / "prompt.txt").read_text(encoding="utf-8")


def test_oversize_evidence_fails_open_without_backend_call(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("x" * (70 * 1024) + "SERIOUS_BEYOND_64K", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        "echo called > called.txt\nprintf '{\"severity\":\"pass\",\"summary\":\"ok\",\"findings\":[]}'",
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert not (tmp_path / "called.txt").exists()
    assert read_events(tmp_path)[-1]["result"] == "evidence-oversize"



def test_final_prompt_redacts_short_and_truncated_diff_prompt_and_untracked_names(
    tmp_path: Path,
) -> None:
    for label, padding in (("short", ""), ("truncated", "x" * (140 * 1024))):
        case_dir = tmp_path / label
        case_dir.mkdir()
        init_repo_with_head(case_dir)
        write_manifest(case_dir, enabled=True)
        prompt_path = case_dir / ".farrier/hooks/prompts/stop-judge-v1.txt"
        prompt_path.write_text(
            "configured token=prompt-secret prompt@example.com", encoding="utf-8"
        )
        (case_dir / "README.md").write_text(
            f"token=seeded-secret dev@example.com {padding}", encoding="utf-8"
        )
        (case_dir / "token=filename-secret-dev@example.com.txt").write_text(
            "new\n", encoding="utf-8"
        )
        make_fake_executable(
            case_dir,
            "claude",
            claude_envelope_body(
                {"severity": "pass", "summary": "ok", "findings": []},
                checks="cat > prompt.txt\n",
            ),
        )

        code, stdout, stderr = run_hook(stop_payload(case_dir), case_dir)

        assert code == 0
        assert_allowed(stdout, stderr)
        final_prompt = (case_dir / "prompt.txt").read_text(encoding="utf-8") if label == "short" else ""
        if label == "truncated":
            # Oversize evidence fails open: the backend is never invoked.
            assert not (case_dir / "prompt.txt").exists()
        for secret in (
            "prompt-secret",
            "prompt@example.com",
            "seeded-secret",
            "dev@example.com",
            "filename-secret",
        ):
            assert secret not in final_prompt
        if label == "truncated":
            assert "seeded-secret" not in stdout


def test_backend_output_overflow_fails_open_without_leaking_raw_tail(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")
    make_fake_executable(
        tmp_path,
        "claude",
        "head -c 70000 /dev/zero | tr '\\0' x\necho token=raw-tail-secret",
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert "raw-tail-secret" not in stdout
    assert read_events(tmp_path)[-1]["result"] == "backend-error:overflow"


def test_backend_stderr_tail_is_captured_redacted_in_event_never_agent_facing(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")
    # Non-zero exit with a secret-bearing stderr line and no usable stdout.
    make_fake_executable(
        tmp_path,
        "claude",
        "echo 'boom token=stderr-secret dev@example.com' 1>&2\nexit 3",
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    event = read_events(tmp_path)[-1]
    assert event["result"] == "backend-error:exit-3"
    assert "boom" in event["detail"]
    assert "stderr-secret" not in event["detail"]
    assert "dev@example.com" not in event["detail"]


def test_malformed_enabled_config_fields_block_while_disabled_is_inert(
    tmp_path: Path,
) -> None:
    invalid = [
        ("enabled", "yes"),
        ("backend", "other"),
        ("model", ""),
        ("timeoutMs", 0),
        ("timeoutMs", 120001),
        ("prompt", ""),
        ("maxDiffBytes", 0),
        ("maxDiffBytes", 120001),
        ("maxUntrackedFiles", 0),
        ("maxUntrackedFiles", 1001),
    ]
    for index, (field, value) in enumerate(invalid):
        case_dir = tmp_path / str(index)
        case_dir.mkdir()
        init_repo_with_head(case_dir)
        write_manifest(case_dir, enabled=True)
        data = json.loads((case_dir / ".farrier.json").read_text(encoding="utf-8"))
        data["judge"]["stop"][field] = value
        (case_dir / ".farrier.json").write_text(json.dumps(data), encoding="utf-8")
        code, stdout, stderr = run_hook(stop_payload(case_dir), case_dir)
        assert code == 0
        assert stderr == ""
        assert parse_stdout(stdout)["decision"] == "block"
        assert "configuration is malformed" in stdout

    disabled_dir = tmp_path / "disabled"
    disabled_dir.mkdir()
    init_repo_with_head(disabled_dir)
    write_manifest(disabled_dir, enabled=False, backend="invalid")
    code, stdout, stderr = run_hook(stop_payload(disabled_dir), disabled_dir)
    assert code == 0
    assert_allowed(stdout, stderr)


def test_invalid_configured_prompt_path_shapes_block(tmp_path: Path) -> None:
    outside = tmp_path / "outside.txt"
    outside.write_text("outside", encoding="utf-8")
    for label, prompt in (
        ("out-root", "../outside.txt"),
        ("dot-segment", "./prompt.txt"),
        ("missing", "missing.txt"),
        ("oversized", "oversized.txt"),
        ("symlink", "linked.txt"),
    ):
        case_dir = tmp_path / label
        case_dir.mkdir()
        init_repo_with_head(case_dir)
        if label == "oversized":
            (case_dir / prompt).write_text("x" * (31 * 1024), encoding="utf-8")
        if label == "symlink":
            (case_dir / prompt).symlink_to(outside)
        write_manifest(case_dir, enabled=True, prompt=prompt)
        code, stdout, stderr = run_hook(stop_payload(case_dir), case_dir)
        assert code == 0
        assert stderr == ""
        assert parse_stdout(stdout)["decision"] == "block"
        assert "configuration is malformed" in stdout


def test_malformed_stop_active_and_unsafe_manifest_reads_block(tmp_path: Path) -> None:
    active_dir = tmp_path / "active"
    active_dir.mkdir()
    payload = stop_payload(active_dir)
    payload["stop_hook_active"] = "false"
    code, stdout, stderr = run_hook(payload)
    assert code == 0
    assert stderr == ""
    assert parse_stdout(stdout)["decision"] == "block"
    assert "malformed stop_hook_active" in stdout

    oversized = tmp_path / "oversized-manifest"
    oversized.mkdir()
    (oversized / ".farrier.json").write_text("x" * (257 * 1024), encoding="utf-8")
    code, stdout, stderr = run_hook(stop_payload(oversized))
    assert code == 0
    assert stderr == ""
    assert parse_stdout(stdout)["decision"] == "block"
    assert "exceeds 262144 bytes" in stdout

    linked = tmp_path / "linked-manifest"
    linked.mkdir()
    outside = tmp_path / "manifest.json"
    outside.write_text("{}", encoding="utf-8")
    (linked / ".farrier.json").symlink_to(outside)
    code, stdout, stderr = run_hook(stop_payload(linked))
    assert code == 0
    assert stderr == ""
    assert parse_stdout(stdout)["decision"] == "block"
    assert "symlink" in stdout


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


def set_manifest_extras(tmp_path: Path, *, quality: dict | None = None, include_repo_map: bool | str | None = None) -> None:
    path = tmp_path / ".farrier.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if quality is not None:
        data["quality"] = quality
    if include_repo_map is not None:
        data["judge"]["stop"]["includeRepoMap"] = include_repo_map
    path.write_text(json.dumps(data), encoding="utf-8")


def test_project_rules_and_repo_map_reach_backend_prompt(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    set_manifest_extras(tmp_path, quality={"rules": ["Never recreate helpers that utils_module already provides"]})
    (tmp_path / "AGENTS.md").write_text(
        "<!-- farrier:repo-map:begin -->\n## Layout\n- src/ (12 files)\n<!-- farrier:repo-map:end -->\n",
        encoding="utf-8",
    )
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        claude_envelope_body(
            {"severity": "pass", "summary": "ok", "findings": []},
            checks=(
                "cat > prompt.txt\n"
                + 'grep -q "projectRules" prompt.txt || exit 8\n'
                + 'grep -q "utils_module already provides" prompt.txt || exit 8\n'
                + 'grep -q "repoMap" prompt.txt || exit 8\n'
                + 'grep -q "12 files" prompt.txt || exit 8\n'
            ),
        ),
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert "projectRules" in (tmp_path / "prompt.txt").read_text(encoding="utf-8")
    event = read_events(tmp_path)[-1]
    assert event["hook"] == "stop-judge"
    assert event["result"] == "pass"


def test_include_repo_map_false_omits_map_from_backend_prompt(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    set_manifest_extras(tmp_path, include_repo_map=False)
    (tmp_path / "AGENTS.md").write_text(
        "<!-- farrier:repo-map:begin -->\nMAP-SENTINEL-CONTENT\n<!-- farrier:repo-map:end -->\n",
        encoding="utf-8",
    )
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        claude_envelope_body(
            {"severity": "pass", "summary": "ok", "findings": []},
            checks=("cat > prompt.txt\n" + 'grep -q "MAP-SENTINEL-CONTENT" prompt.txt && exit 8\n'),
        ),
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_invalid_quality_rules_block_without_backend_call(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    set_manifest_extras(tmp_path, quality={"rules": "reuse things"})
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")
    make_fake_executable(tmp_path, "claude", "echo called > called.txt\nexit 0")

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    data = parse_stdout(stdout)
    assert data["decision"] == "block"
    assert "quality.rules must be an array of non-empty strings" in data["reason"]
    assert not (tmp_path / "called.txt").exists()


def test_invalid_include_repo_map_blocks(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    set_manifest_extras(tmp_path, include_repo_map="yes")
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")

    code, stdout, stderr = run_hook(stop_payload(tmp_path))

    assert code == 0
    assert stderr == ""
    data = parse_stdout(stdout)
    assert data["decision"] == "block"
    assert "judge.stop.includeRepoMap must be a boolean" in data["reason"]


def test_fenced_backend_json_is_accepted(tmp_path: Path) -> None:
    init_repo_with_head(tmp_path)
    write_manifest(tmp_path, enabled=True)
    (tmp_path / "README.md").write_text("changed\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        claude_envelope_body(
            {"severity": "serious", "summary": "fenced block", "findings": []},
            checks="cat > /dev/null\n",
            fenced=True,
        ),
    )

    code, stdout, stderr = run_hook(stop_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    data = parse_stdout(stdout)
    assert data["decision"] == "block"
    assert "fenced block" in data["reason"]


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

from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).with_name("quality-judge.py")


def write_manifest(tmp_path: Path, manifest: dict) -> None:
    (tmp_path / ".farrier.json").write_text(json.dumps(manifest), encoding="utf-8")
    prompt = manifest.get("judge", {}).get("perEdit", {}).get("prompt")
    if prompt == ".farrier/hooks/prompts/quality-judge-v1.txt":
        path = tmp_path / prompt
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("QUALITY PROMPT", encoding="utf-8")


def manifest(
    *,
    enabled: bool = False,
    backend: str = "claude",
    model: str = "haiku",
    timeout_ms: int = 15000,
    prompt: str = ".farrier/hooks/prompts/quality-judge-v1.txt",
    max_lines: int = 500,
) -> dict:
    return {
        "judge": {
            "perEdit": {
                "enabled": enabled,
                "backend": backend,
                "model": model,
                "timeoutMs": timeout_ms,
                "prompt": prompt,
            }
        },
        "quality": {
            "maxFileLines": max_lines,
        },
    }


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
    """Shell body emitting a `claude -p --output-format json` result envelope.

    The verdict JSON is embedded as the envelope's `result` string, mirroring the
    real Claude Code print-mode output the quality judge now parses. When `fenced`
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


def run_hook(
    payload: dict, tmp_path: Path, extra_path: Path | None = None
) -> tuple[int, str, str]:
    env = os.environ.copy()
    if extra_path is not None:
        env["PATH"] = f"{extra_path}{os.pathsep}{env.get('PATH', '')}"

    proc = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    return proc.returncode, proc.stdout, proc.stderr


def post_payload(
    tmp_path: Path, tool_input: dict | None = None, tool_name: str = "Write"
) -> dict:
    return {
        "session_id": "test",
        "transcript_path": "/tmp/transcript.jsonl",
        "cwd": str(tmp_path),
        "hook_event_name": "PostToolUse",
        "tool_name": tool_name,
        "tool_input": tool_input or {"file_path": "src/app.py"},
        "tool_response": {"ok": True},
    }


def parse_stdout(stdout: str) -> dict:
    assert stdout.strip()
    return json.loads(stdout)


def assert_allowed(stdout: str, stderr: str) -> None:
    assert stdout == ""
    assert stderr == ""


def assert_post_context(stdout: str, expected: str) -> None:
    data = parse_stdout(stdout)
    output = data["hookSpecificOutput"]
    assert output["hookEventName"] == "PostToolUse"
    assert expected in output["additionalContext"]


def test_over_limit_file_emits_posttool_context(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=2))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("one\ntwo\nthree\n", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "exceeding quality.maxFileLines=2")


def test_final_unterminated_line_counts_toward_max_file_lines(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=2))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("one\ntwo\nthree", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "src/app.py is 3 lines")


def test_under_limit_file_passes_silently(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=10))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("one\ntwo\n", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_codex_apply_patch_extracts_every_changed_path_header(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=2))
    source = tmp_path / "src"
    source.mkdir()
    (source / "small.py").write_text("one\n", encoding="utf-8")
    (source / "large.py").write_text("one\ntwo\nthree\n", encoding="utf-8")
    patch = """*** Begin Patch
*** Update File: src/small.py
*** Add File: src/large.py
*** Delete File: src/deleted.py
*** End Patch"""

    code, stdout, stderr = run_hook(
        post_payload(tmp_path, {"command": patch}, tool_name="apply_patch"),
        tmp_path,
    )

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "src/large.py is 3 lines")


def test_missing_file_passes_silently(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=1))

    code, stdout, stderr = run_hook(
        post_payload(tmp_path, {"file_path": "src/missing.py"}), tmp_path
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_disabled_llm_does_not_call_backend(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=False, max_lines=100))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(tmp_path, "claude", "echo called > called.txt\nexit 0")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert not (tmp_path / "called.txt").exists()


def test_enabled_fake_claude_advisory_emits_context_and_reads_prompt_from_stdin(
    tmp_path: Path,
) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude", model="haiku"))
    prompt_dir = tmp_path / ".farrier" / "hooks" / "prompts"
    prompt_dir.mkdir(parents=True, exist_ok=True)
    (prompt_dir / "quality-judge-v1.txt").write_text(
        "CUSTOM QUALITY PROMPT", encoding="utf-8"
    )

    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        claude_envelope_body(
            {
                "severity": "advisory",
                "summary": "move logic closer to domain",
                "findings": [{"path": "src/app.py", "message": "thin cohesion", "suggestion": "extract a service"}],
            },
            usage={"input_tokens": 210, "output_tokens": 33},
            checks=(
                CLAUDE_ARG_CHECKS
                + 'test "$5" = "haiku" || exit 7\n'
                + "cat > prompt.txt\n"
                + 'grep -q "CUSTOM QUALITY PROMPT" prompt.txt || exit 8\n'
            ),
        ),
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "semantic quality judge (advisory)")
    assert_post_context(stdout, "move logic closer to domain")
    assert (
        (tmp_path / "prompt.txt")
        .read_text(encoding="utf-8")
        .startswith("CUSTOM QUALITY PROMPT")
    )
    event = read_events(tmp_path)[-1]
    assert event["result"] == "advisory"
    assert event["usage"] == {"input_tokens": 210, "output_tokens": 33}


def test_enabled_fake_codex_serious_emits_context_and_prompt_is_single_argument(
    tmp_path: Path,
) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="codex", model="gpt-5.5"))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "codex",
        """
test "$1" = "exec" || exit 7
test "$2" = "--model" || exit 7
test "$3" = "gpt-5.5" || exit 7
printf "%s" "$4" > prompt.txt
grep -q "src/app.py" prompt.txt || exit 8
printf '{"severity":"serious","summary":"business logic dumped into CLI","findings":[{"path":"src/app.py","message":"wrong layer","suggestion":"move into core"}]}'
""",
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "semantic quality judge (serious)")
    assert_post_context(stdout, "business logic dumped into CLI")


def test_backend_garbage_response_is_silent_to_agent_but_logs_invalid_json(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude"))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(tmp_path, "claude", "echo not-json")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert read_events(tmp_path)[-1]["result"] == "backend-error:invalid-json"


def test_backend_timeout_emits_context_and_logs_timeout(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude", timeout_ms=50))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(tmp_path, "claude", "sleep 1\necho never")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "timed out and was terminated")
    assert read_events(tmp_path)[-1]["result"] == "backend-error:timeout"


def test_invalid_configured_prompt_emits_actionable_feedback(tmp_path: Path) -> None:
    write_manifest(
        tmp_path,
        manifest(
            enabled=True, backend="claude", prompt=".farrier/hooks/prompts/missing.txt"
        ),
    )
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        """
cat > prompt.txt
grep -q "Farrier's per-edit semantic quality judge" prompt.txt || exit 8
printf '{"severity":"pass","summary":"ok","findings":[]}'
""",
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "prompt is missing or unreadable")
    assert not (tmp_path / "prompt.txt").exists()


def test_large_file_content_is_capped_with_truncated_marker(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude", max_lines=100000))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("x" * (40 * 1024), encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        claude_envelope_body(
            {"severity": "pass", "summary": "ok", "findings": []},
            checks=(
                "cat > prompt.txt\n"
                + 'grep -q "\\[truncated\\]" prompt.txt || exit 8\n'
                + "bytes=$(wc -c < prompt.txt)\n"
                + 'test "$bytes" -lt 40000 || exit 9\n'
            ),
        ),
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)



def test_final_backend_prompt_and_feedback_redact_under_limit_and_truncated_evidence(
    tmp_path: Path,
) -> None:
    for label, padding in (("short", ""), ("truncated", "x" * (40 * 1024))):
        case_dir = tmp_path / label
        case_dir.mkdir()
        config = manifest(enabled=True, backend="claude", max_lines=100000)
        write_manifest(case_dir, config)
        prompt_path = case_dir / config["judge"]["perEdit"]["prompt"]
        prompt_path.write_text(
            "configured token=prompt-secret prompt@example.com", encoding="utf-8"
        )
        source = case_dir / "src"
        source.mkdir()
        (source / "app.py").write_text(
            f"token=seeded-secret dev@example.com {padding}", encoding="utf-8"
        )
        make_fake_executable(
            case_dir,
            "claude",
            claude_envelope_body(
                {
                    "severity": "advisory",
                    "summary": "token=feedback-secret feedback@example.com",
                    "findings": [],
                },
                checks="cat > prompt.txt\n",
            ),
        )

        code, stdout, stderr = run_hook(
            post_payload(case_dir), case_dir, case_dir
        )

        assert code == 0
        assert stderr == ""
        final_prompt = (case_dir / "prompt.txt").read_text(encoding="utf-8")
        combined = final_prompt + stdout
        for secret in (
            "prompt-secret",
            "prompt@example.com",
            "seeded-secret",
            "dev@example.com",
            "feedback-secret",
            "feedback@example.com",
        ):
            assert secret not in combined
        if label == "truncated":
            assert "[truncated]" in final_prompt


def test_backend_output_overflow_is_terminated_with_bounded_feedback(
    tmp_path: Path,
) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude"))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("ok\n", encoding="utf-8")
    make_fake_executable(
        tmp_path,
        "claude",
        "head -c 70000 /dev/zero | tr '\\0' x\necho token=raw-tail-secret",
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "output exceeded")
    assert "raw-tail-secret" not in stdout
    assert len(stdout.encode("utf-8")) < 20 * 1024
    assert read_events(tmp_path)[-1]["result"] == "backend-error:overflow"


def test_backend_nonzero_exit_logs_category_with_redacted_stderr_and_stays_silent(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=True, backend="claude"))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("ok\n", encoding="utf-8")
    # Exit non-zero with a secret-bearing stderr line and no usable stdout.
    make_fake_executable(
        tmp_path,
        "claude",
        "echo 'boom token=stderr-secret dev@example.com' 1>&2\nexit 5",
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    # exit-<code> failures are logged but not surfaced inline to the agent.
    assert_allowed(stdout, stderr)
    event = read_events(tmp_path)[-1]
    assert event["result"] == "backend-error:exit-5"
    assert "boom" in event["detail"]
    assert "stderr-secret" not in event["detail"]
    assert "dev@example.com" not in event["detail"]


def test_malformed_enabled_config_fields_emit_feedback_while_disabled_is_inert(
    tmp_path: Path,
) -> None:
    invalid = [
        ("enabled", "yes"),
        ("backend", "other"),
        ("model", ""),
        ("timeoutMs", 0),
        ("timeoutMs", 120001),
        ("prompt", ""),
    ]
    for index, (field, value) in enumerate(invalid):
        case_dir = tmp_path / str(index)
        case_dir.mkdir()
        config = manifest(enabled=True)
        config["judge"]["perEdit"][field] = value
        write_manifest(case_dir, config)
        source = case_dir / "src"
        source.mkdir()
        (source / "app.py").write_text("ok\n", encoding="utf-8")
        code, stdout, stderr = run_hook(post_payload(case_dir), case_dir)
        assert code == 0
        assert stderr == ""
        assert_post_context(stdout, "configuration is malformed")

    disabled_dir = tmp_path / "disabled"
    disabled_dir.mkdir()
    config = manifest(enabled=False)
    config["judge"]["perEdit"]["backend"] = "invalid"
    write_manifest(disabled_dir, config)
    source = disabled_dir / "src"
    source.mkdir()
    (source / "app.py").write_text("ok\n", encoding="utf-8")
    code, stdout, stderr = run_hook(post_payload(disabled_dir), disabled_dir)
    assert code == 0
    assert_allowed(stdout, stderr)


def test_invalid_max_file_lines_and_ambiguous_recognized_edits_emit_feedback(tmp_path: Path) -> None:
    for index, value in enumerate((0, 100001, "500", True)):
        case_dir = tmp_path / f"limit-{index}"
        case_dir.mkdir()
        config = manifest(enabled=False)
        config["quality"]["maxFileLines"] = value
        write_manifest(case_dir, config)
        code, stdout, stderr = run_hook(post_payload(case_dir), case_dir)
        assert code == 0
        assert stderr == ""
        assert_post_context(stdout, "quality.maxFileLines")

    case_dir = tmp_path / "ambiguous"
    case_dir.mkdir()
    write_manifest(case_dir, manifest(enabled=False))
    for tool_input in (None, {}, {"file_path": 7}):
        payload = post_payload(case_dir)
        payload["tool_input"] = tool_input
        code, stdout, stderr = run_hook(payload, case_dir)
        assert code == 0
        assert stderr == ""
        assert_post_context(stdout, "malformed or ambiguous input")


def test_manifest_prompt_and_edited_file_safe_read_failures_emit_bounded_feedback(tmp_path: Path) -> None:
    oversized = tmp_path / "oversized-manifest"
    oversized.mkdir()
    (oversized / ".farrier.json").write_text("x" * (257 * 1024), encoding="utf-8")
    code, stdout, stderr = run_hook(post_payload(oversized), oversized)
    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "exceeds 262144 bytes")

    dotted = tmp_path / "dotted-prompt"
    dotted.mkdir()
    write_manifest(dotted, manifest(enabled=True, prompt="./prompt.txt"))
    source = dotted / "src"
    source.mkdir()
    (source / "app.py").write_text("ok\n", encoding="utf-8")
    code, stdout, stderr = run_hook(post_payload(dotted), dotted)
    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "without . or .. segments")

    linked = tmp_path / "linked-edit"
    linked.mkdir()
    write_manifest(linked, manifest(enabled=False))
    outside = tmp_path / "outside.py"
    outside.write_text("token=outside-secret\n", encoding="utf-8")
    source = linked / "src"
    source.mkdir()
    (source / "app.py").symlink_to(outside)
    code, stdout, stderr = run_hook(post_payload(linked), linked)
    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "traverses a symlink")
    assert "outside-secret" not in stdout


def test_skips_hook_files_to_avoid_recursion(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=1))
    hooks = tmp_path / ".farrier" / "hooks"
    hooks.mkdir(parents=True, exist_ok=True)
    (hooks / "quality-judge.py").write_text("one\ntwo\nthree\n", encoding="utf-8")

    code, stdout, stderr = run_hook(
        post_payload(tmp_path, {"file_path": ".farrier/hooks/quality-judge.py"}),
        tmp_path,
    )

    assert code == 0
    assert_allowed(stdout, stderr)


def test_ignores_unrelated_tool(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(max_lines=1))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("one\ntwo\nthree\n", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path, tool_name="Read"), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_null_max_file_lines_disables_length_finding(tmp_path: Path) -> None:
    data = manifest(enabled=False)
    data["quality"]["maxFileLines"] = None
    write_manifest(tmp_path, data)
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("line\n" * 600, encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_project_rules_and_repo_map_reach_backend_prompt(tmp_path: Path) -> None:
    data = manifest(enabled=True)
    data["quality"]["rules"] = ["Never recreate helpers that utils_module already provides"]
    write_manifest(tmp_path, data)
    (tmp_path / "AGENTS.md").write_text(
        "# Project\n\n<!-- farrier:repo-map:begin -->\n## Layout\n- src/ (12 files)\n<!-- farrier:repo-map:end -->\n",
        encoding="utf-8",
    )
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

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

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)
    assert "projectRules" in (tmp_path / "prompt.txt").read_text(encoding="utf-8")
    event = read_events(tmp_path)[-1]
    assert event["hook"] == "quality-judge"
    assert event["result"] == "pass"


def test_include_repo_map_false_omits_map_from_backend_prompt(tmp_path: Path) -> None:
    data = manifest(enabled=True)
    data["judge"]["perEdit"]["includeRepoMap"] = False
    write_manifest(tmp_path, data)
    (tmp_path / "AGENTS.md").write_text(
        "<!-- farrier:repo-map:begin -->\nMAP-SENTINEL-CONTENT\n<!-- farrier:repo-map:end -->\n",
        encoding="utf-8",
    )
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        claude_envelope_body(
            {"severity": "pass", "summary": "ok", "findings": []},
            checks=("cat > prompt.txt\n" + 'grep -q "MAP-SENTINEL-CONTENT" prompt.txt && exit 8\n'),
        ),
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert_allowed(stdout, stderr)


def test_invalid_quality_rules_emit_config_context_without_backend_call(tmp_path: Path) -> None:
    data = manifest(enabled=True)
    data["quality"]["rules"] = ["fine", ""]
    write_manifest(tmp_path, data)
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")
    make_fake_executable(tmp_path, "claude", "echo called > called.txt\nexit 0")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "quality.rules must be an array of non-empty strings")
    assert not (tmp_path / "called.txt").exists()


def test_invalid_include_repo_map_emits_config_context(tmp_path: Path) -> None:
    data = manifest(enabled=True)
    data["judge"]["perEdit"]["includeRepoMap"] = "yes"
    write_manifest(tmp_path, data)
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "judge.perEdit.includeRepoMap must be a boolean")


def test_fenced_backend_json_is_accepted(tmp_path: Path) -> None:
    write_manifest(tmp_path, manifest(enabled=True))
    source = tmp_path / "src"
    source.mkdir()
    (source / "app.py").write_text("print('ok')\n", encoding="utf-8")

    make_fake_executable(
        tmp_path,
        "claude",
        claude_envelope_body(
            {"severity": "advisory", "summary": "fenced finding", "findings": []},
            checks="cat > /dev/null\n",
            fenced=True,
        ),
    )

    code, stdout, stderr = run_hook(post_payload(tmp_path), tmp_path, tmp_path)

    assert code == 0
    assert stderr == ""
    assert_post_context(stdout, "fenced finding")


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

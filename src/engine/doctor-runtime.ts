import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EnforcementAgent } from "./agent-selection";
import type { DoctorProblem } from "./doctor";
import { readManifest } from "./manifest";
import { hooksDirectory } from "./render";
import { builtinCatalog, type PackCatalog } from "../registry/catalog";

/**
 * Runtime hook verification: execute the exact binding commands from the
 * installed agent configuration against fixture payloads and prove they deny
 * what they must deny, allow what they must allow, and write the JSONL event
 * log. This is what separates a working hook from dead generated code.
 */

export type RuntimeProbe = {
  id: string;
  description: string;
  expectation: "deny" | "allow";
  agent: EnforcementAgent;
  ok: boolean;
  detail?: string;
};

export type RuntimeReport = {
  targetDir: string;
  healthy: boolean;
  probes: RuntimeProbe[];
  problems: DoctorProblem[];
  notes: string[];
};

type HookBinding = {
  agent: EnforcementAgent;
  event: string;
  matcher?: string;
  command: string;
};

export type BindingCommandRunner = (input: {
  command: string;
  targetDir: string;
  stdin: string;
  timeoutMs: number;
}) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;

const defaultTimeoutMs = 30_000;
const checkCommandTimeoutMs = 180_000;
const eventsRelativePath = ".farrier/runtime/events.jsonl";

export const defaultBindingCommandRunner: BindingCommandRunner = async (input) => {
  const proc = Bun.spawn({
    cmd: ["sh", "-c", input.command],
    cwd: input.targetDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: input.targetDir },
    stdin: new TextEncoder().encode(input.stdin),
    stdout: "pipe",
    stderr: "pipe"
  });

  const timeout = setTimeout(() => proc.kill(), input.timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text()
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function parseBindings(agent: EnforcementAgent, raw: unknown): HookBinding[] {
  if (!isRecord(raw) || !isRecord(raw.hooks)) {
    return [];
  }

  const bindings: HookBinding[] = [];
  for (const [event, entries] of Object.entries(raw.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) continue;
      for (const handler of entry.hooks) {
        if (isRecord(handler) && typeof handler.command === "string") {
          bindings.push({
            agent,
            event,
            matcher: typeof entry.matcher === "string" ? entry.matcher : undefined,
            command: handler.command
          });
        }
      }
    }
  }
  return bindings;
}

function matcherMatches(matcher: string | undefined, toolName: string): boolean {
  if (matcher === undefined) {
    return true;
  }
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return false;
  }
}

function decisionFromStdout(stdout: string): "deny" | "none" {
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        isRecord(parsed) &&
        isRecord(parsed.hookSpecificOutput) &&
        parsed.hookSpecificOutput.permissionDecision === "deny"
      ) {
        return "deny";
      }
    } catch {
      // Non-JSON output lines are ignored; hooks may print nothing on allow.
    }
  }
  return "none";
}

type Fixture = {
  id: string;
  description: string;
  toolName: string;
  expectation: "deny" | "allow";
  /** Substring the deny reason must contain to credit the right hook. */
  expectedReason?: string;
  payload: (targetDir: string) => Record<string, unknown>;
};

function bashPayload(targetDir: string, command: string, toolName = "Bash"): Record<string, unknown> {
  return {
    session_id: "farrier-doctor",
    transcript_path: "/dev/null",
    cwd: targetDir,
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { command }
  };
}

function editPayload(targetDir: string, filePath: string): Record<string, unknown> {
  return {
    session_id: "farrier-doctor",
    transcript_path: "/dev/null",
    cwd: targetDir,
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: "a", new_string: "b" }
  };
}

function applyPatchPayload(targetDir: string, filePath: string): Record<string, unknown> {
  return {
    session_id: "farrier-doctor",
    transcript_path: "/dev/null",
    cwd: targetDir,
    hook_event_name: "PreToolUse",
    tool_name: "apply_patch",
    tool_input: {
      command: `*** Begin Patch\n*** Update File: ${filePath}\n*** End Patch`
    }
  };
}

async function toolPolicyProbeRules(targetDir: string): Promise<Array<{ id: string; probe: string }>> {
  const raw = await readJson(join(targetDir, hooksDirectory, "tool-policy-rules.json"));
  if (!isRecord(raw) || !Array.isArray(raw.rules)) {
    return [];
  }
  return raw.rules.flatMap((rule) =>
    isRecord(rule) && typeof rule.id === "string" && typeof rule.probe === "string"
      ? [{ id: rule.id, probe: rule.probe }]
      : []
  );
}

async function readEventLines(targetDir: string): Promise<Array<Record<string, unknown>>> {
  try {
    const text = await readFile(join(targetDir, eventsRelativePath), "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line);
          return isRecord(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export async function createRuntimeReport(input: {
  targetDir: string;
  catalog?: PackCatalog;
  runner?: BindingCommandRunner;
  /** Run the generated hook pytest suite (slow; needs uv). Defaults to true. */
  includeHookTests?: boolean;
}): Promise<RuntimeReport> {
  const targetDir = input.targetDir;
  const catalog = input.catalog ?? builtinCatalog();
  const runner = input.runner ?? defaultBindingCommandRunner;
  const includeHookTests = input.includeHookTests ?? true;
  const probes: RuntimeProbe[] = [];
  const problems: DoctorProblem[] = [];
  const notes: string[] = [
    "Runtime probes execute the installed binding commands against fixture payloads; nothing is sent to a model."
  ];

  const manifest = await readManifest({ targetDir, catalog });

  // Required executables.
  const pack = catalog.resolvePack(manifest.currentPackId);
  const runtimeBinaries = new Set(["python3", "just"]);
  const firstToken = pack.verbs.test.split(/\s+/)[0];
  if (firstToken && firstToken !== "echo") {
    runtimeBinaries.add(firstToken);
  }
  for (const binary of runtimeBinaries) {
    if (!Bun.which(binary)) {
      problems.push({
        group: "runtime",
        severity: "error",
        id: `executable:${binary}`,
        message: `Required executable '${binary}' is not on PATH`,
        remediation: `Install ${binary}; generated hooks and recipes depend on it.`
      });
    }
  }

  // Bindings from the actual agent configuration files.
  const bindings: HookBinding[] = [];
  if (manifest.agents.includes("claude")) {
    const raw = await readJson(join(targetDir, ".claude", "settings.json"));
    const parsed = raw === undefined ? [] : parseBindings("claude", raw);
    if (parsed.length === 0) {
      problems.push({
        group: "runtime",
        severity: "error",
        path: ".claude/settings.json",
        message: "No hook bindings could be parsed from the Claude settings file",
        remediation: "Run farrier update --yes to restore the generated binding."
      });
    }
    bindings.push(...parsed);
  }
  if (manifest.agents.includes("codex")) {
    const raw = await readJson(join(targetDir, ".codex", "hooks.json"));
    const parsed = raw === undefined ? [] : parseBindings("codex", raw);
    if (parsed.length === 0) {
      problems.push({
        group: "runtime",
        severity: "error",
        path: ".codex/hooks.json",
        message: "No hook bindings could be parsed from the Codex hooks file",
        remediation: "Run farrier update --yes to restore the generated binding."
      });
    }
    bindings.push(...parsed);
  }

  // Fixtures derived from the installed configuration.
  const fixtures: Fixture[] = [];
  if (manifest.hookIds.includes("tool-policy")) {
    for (const rule of (await toolPolicyProbeRules(targetDir)).slice(0, 3)) {
      fixtures.push({
        id: `tool-policy:${rule.id}`,
        description: `tool-policy denies \`${rule.probe}\``,
        toolName: "Bash",
        expectation: "deny",
        expectedReason: rule.id,
        payload: (dir) => bashPayload(dir, rule.probe)
      });
    }
  }
  if (manifest.hookIds.includes("secret-shield")) {
    fixtures.push({
      id: "secret-shield:env-read",
      description: "secret-shield denies reading .env",
      toolName: "Bash",
      expectation: "deny",
      expectedReason: "secret",
      payload: (dir) => bashPayload(dir, "cat .env")
    });
  }
  if (manifest.hookIds.includes("write-guard")) {
    fixtures.push({
      id: "write-guard:protected-file",
      description: "write-guard denies editing .farrier.json",
      toolName: "Edit",
      expectation: "deny",
      expectedReason: ".farrier.json",
      payload: (dir) => editPayload(dir, ".farrier.json")
    });
    fixtures.push({
      id: "write-guard:protected-file-apply-patch",
      description: "write-guard denies an apply_patch to .farrier.json",
      toolName: "apply_patch",
      expectation: "deny",
      expectedReason: ".farrier.json",
      payload: (dir) => applyPatchPayload(dir, ".farrier.json")
    });
  }
  fixtures.push({
    id: "allow:benign-command",
    description: "a harmless command passes every Bash guard",
    toolName: "Bash",
    expectation: "allow",
    payload: (dir) => bashPayload(dir, "echo farrier doctor probe")
  });

  const preToolUseBindings = bindings.filter(
    (binding) => binding.event === "PreToolUse" && !binding.command.includes("verb-runner.py")
  );

  const eventsBefore = (await readEventLines(targetDir)).length;

  for (const fixture of fixtures) {
    const matching = preToolUseBindings.filter((binding) => matcherMatches(binding.matcher, fixture.toolName));

    if (matching.length === 0) {
      // Codex, for example, has no Edit-matched bindings; skip fixtures with
      // no reachable binding rather than reporting a false failure.
      continue;
    }

    let denied = false;
    let deniedWithReason = false;
    let failure: string | undefined;
    const stdin = JSON.stringify(fixture.payload(targetDir));

    // Probe bindings are independent verifications of the same payload; run
    // them concurrently and fold the ordered results back into the exact
    // sequential outcome (last non-zero exit wins, any deny sets the flags).
    const results = await Promise.all(
      matching.map((binding) => runner({ command: binding.command, targetDir, stdin, timeoutMs: defaultTimeoutMs }))
    );

    for (const [index, result] of results.entries()) {
      const binding = matching[index]!;
      if (result.exitCode !== 0) {
        failure = `binding exited with code ${result.exitCode}: ${binding.command}\n${result.stderr.trim()}`.trim();
        continue;
      }
      if (decisionFromStdout(result.stdout) === "deny") {
        denied = true;
        if (!fixture.expectedReason || result.stdout.includes(fixture.expectedReason)) {
          deniedWithReason = true;
        }
      }
    }

    const ok = fixture.expectation === "deny" ? deniedWithReason : !denied && failure === undefined;
    probes.push({
      id: fixture.id,
      description: fixture.description,
      expectation: fixture.expectation,
      agent: matching[0]!.agent,
      ok,
      detail: ok
        ? undefined
        : failure ??
          (fixture.expectation === "deny"
            ? denied
              ? "denied, but not by the expected rule"
              : "fixture was not denied by any installed binding"
            : "harmless fixture was denied")
    });

    if (!ok) {
      problems.push({
        group: "runtime",
        severity: "error",
        id: fixture.id,
        message: `Runtime probe failed: ${fixture.description} (${probes.at(-1)?.detail ?? "unknown"})`,
        remediation: "Run farrier update --yes, then farrier doctor again; inspect the binding command manually if it persists."
      });
    }
  }

  // Hook output must reach the event log.
  const events = await readEventLines(targetDir);
  const appended = events.slice(eventsBefore);
  const ranDenyProbe = probes.some((probe) => probe.expectation === "deny" && probe.ok);
  if (ranDenyProbe && !appended.some((event) => event.result === "blocked")) {
    problems.push({
      group: "runtime",
      severity: "error",
      path: eventsRelativePath,
      message: "Probes were denied but no blocked event reached the runtime event log",
      remediation: "Regenerate hooks with farrier update --yes; the installed hook scripts may predate event logging."
    });
  } else if (ranDenyProbe) {
    notes.push(`Event log verified: ${appended.length} probe event(s) appended to ${eventsRelativePath}.`);
  }

  // The generated hook self-tests moved out of the project gate; doctor owns them.
  if (includeHookTests && manifest.hookIds.some((id) => !id.startsWith("@"))) {
    const result = await defaultBindingCommandRunner({
      command: `uv run --with pytest pytest ${hooksDirectory}`,
      targetDir,
      stdin: "",
      timeoutMs: checkCommandTimeoutMs
    });
    if (result.exitCode !== 0) {
      problems.push({
        group: "runtime",
        severity: "error",
        path: hooksDirectory,
        message: "Generated hook self-tests failed",
        remediation: `Run \`uv run --with pytest pytest ${hooksDirectory}\` for details, then farrier update --yes.`
      });
    } else {
      notes.push("Generated hook self-tests passed.");
    }
  }

  return {
    targetDir,
    healthy: !problems.some((problem) => problem.severity === "error"),
    probes,
    problems,
    notes
  };
}

export type LiveProbeResult = {
  ran: boolean;
  ok: boolean;
  detail: string;
};

/**
 * The only true proof that hook output reaches the agent: one real Codex
 * session is instructed to run a forbidden fixture command; the probe passes
 * when a `blocked` event lands in the runtime event log during the session.
 * Costs one model call; requires the codex CLI and project trust.
 */
export async function runLiveCodexProbe(input: {
  targetDir: string;
  runner?: (input: { cmd: string[]; targetDir: string; timeoutMs: number }) => Promise<{ exitCode: number | null; stdout: string }>;
}): Promise<LiveProbeResult> {
  const targetDir = input.targetDir;
  const rules = await toolPolicyProbeRules(targetDir);
  const probe = rules[0]?.probe ?? "cat .env";

  if (!Bun.which("codex") && !input.runner) {
    return { ran: false, ok: false, detail: "codex CLI is not installed; cannot run the live probe." };
  }

  const eventsBefore = (await readEventLines(targetDir)).length;
  const prompt =
    `Run exactly this shell command and nothing else: ${probe}\n` +
    "If the command is blocked by a hook or policy, reply with the single word BLOCKED. " +
    "If it runs, reply with the single word RAN. Do not retry, do not work around the block, do not edit any files.";

  const runner =
    input.runner ??
    (async (runInput: { cmd: string[]; targetDir: string; timeoutMs: number }) => {
      const proc = Bun.spawn({
        cmd: runInput.cmd,
        cwd: runInput.targetDir,
        stdout: "pipe",
        stderr: "pipe",
        env: process.env
      });
      const timeout = setTimeout(() => proc.kill(), runInput.timeoutMs);
      try {
        const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
        return { exitCode, stdout };
      } finally {
        clearTimeout(timeout);
      }
    });

  // Codex only loads project hook definitions from trusted projects; scope
  // trust to this one exec invocation instead of mutating the user's config.
  const result = await runner({
    cmd: [
      "codex",
      "exec",
      "--skip-git-repo-check",
      "-s",
      "workspace-write",
      "-c",
      `projects."${targetDir}".trust_level="trusted"`,
      prompt
    ],
    targetDir,
    timeoutMs: 300_000
  });

  const appended = (await readEventLines(targetDir)).slice(eventsBefore);
  const blocked = appended.some((event) => event.result === "blocked");
  const claimedBlocked = result.stdout.includes("BLOCKED");

  if (blocked) {
    return {
      ran: true,
      ok: true,
      detail: `Live Codex session attempted \`${probe}\`; a blocked event reached the log and the agent ${claimedBlocked ? "reported the block" : "did not explicitly acknowledge it"}.`
    };
  }

  if (result.exitCode !== 0) {
    return { ran: true, ok: false, detail: `codex exec exited with code ${result.exitCode}.` };
  }

  return {
    ran: true,
    ok: false,
    detail: claimedBlocked
      ? `The agent reported BLOCKED but no hook event was logged: it likely refused via AGENTS.md instructions before executing \`${probe}\`. That is instruction-level prevention; hook-level contact remains unproven. Check /hooks inside Codex.`
      : `Live Codex session completed but no blocked event was logged (agent replied: ${result.stdout.trim().slice(0, 200) || "nothing"}). Check codex trust and /hooks status.`
  };
}

export function formatRuntimeReport(report: RuntimeReport): string {
  const lines = [`Runtime hook verification for ${report.targetDir}`, ""];

  for (const probe of report.probes) {
    lines.push(`  ${probe.ok ? "ok " : "FAIL"} [${probe.agent}] ${probe.description}${probe.detail ? ` — ${probe.detail}` : ""}`);
  }
  if (report.probes.length === 0) {
    lines.push("  (no executable probes for the installed configuration)");
  }

  if (report.problems.length > 0) {
    lines.push("", "Runtime problems:");
    for (const problem of report.problems) {
      lines.push(`  - ${problem.message}`);
      if (problem.remediation) lines.push(`    fix: ${problem.remediation}`);
    }
  }

  if (report.notes.length > 0) {
    lines.push("", "Notes:", ...report.notes.map((note) => `  - ${note}`));
  }

  return `${lines.join("\n")}\n`;
}

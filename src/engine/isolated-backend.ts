import type { ReasoningEffort } from "../config/farrier-config";
import {
  backendEnvironmentOverrides,
  backendEnvironmentPassthrough,
  backendFailureMessage,
  type AgentBackend,
  type BackendCommandRunner
} from "./backend";
import { isolatedAuthoringTimeoutMs, withIsolatedExecution } from "./execution-isolation";

/**
 * One isolated prompt→stdout backend call, shared by every consented LLM
 * authoring pass (export lesson classification, goal authoring, improve
 * analysis). The prompt is the only input; the workspace is a fresh read-only
 * temp dir, never the target project, so nothing is read from or staged into
 * the repository whose sessions may still be open.
 */
export async function runIsolatedBackendText(input: {
  targetDir: string;
  backend: AgentBackend;
  prompt: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  runner: BackendCommandRunner;
  /**
   * "tolerate" for passes over projects whose agent sessions may still be
   * writing (the export/improve posture); omit to keep the strict fence.
   */
  concurrentTargetWrites?: "tolerate";
}): Promise<string> {
  const command =
    input.backend === "claude"
      ? {
          cmd: [
            "claude", "-p", "--model", input.model,
            ...(input.reasoningEffort ? ["--effort", input.reasoningEffort] : []),
            "--permission-mode", "plan"
          ],
          stdin: input.prompt
        }
      : {
          cmd: [
            // The isolated workspace is a fresh, untrusted, non-git temp dir;
            // codex ≥0.145 refuses it without --skip-git-repo-check.
            "codex", "exec", "--skip-git-repo-check", "-s", "read-only", "--model", input.model,
            ...(input.reasoningEffort ? ["-c", `model_reasoning_effort=${input.reasoningEffort}`] : []),
            input.prompt
          ],
          stdin: undefined
        };

  const isolated = await withIsolatedExecution({
    targetDir: input.targetDir,
    nativeConfinement: input.backend === "codex",
    environmentPassthrough: backendEnvironmentPassthrough(input.backend),
    environmentOverrides: backendEnvironmentOverrides(input.backend),
    // Each of these passes is a full backend reasoning run; the 120s fallback
    // is too short for a large model at high effort.
    timeoutMs: isolatedAuthoringTimeoutMs,
    readOnlyWorkspace: true,
    ...(input.concurrentTargetWrites ? { concurrentTargetWrites: input.concurrentTargetWrites } : {}),
    run: async ({ workspace, environment, redactValues, signal }) => ({
      output: await input.runner({
        cmd: command.cmd,
        cwd: workspace,
        stdin: command.stdin,
        signal,
        env: environment,
        redactValues
      }),
      redactValues
    })
  });
  const { output, redactValues } = isolated.value;

  if (output.exitCode !== 0) {
    throw new Error(backendFailureMessage({ backend: input.backend, exitCode: output.exitCode, output, redactValues }));
  }
  if (output.capture?.stdout.truncated) {
    throw new Error(
      `${input.backend} backend stdout exceeded the capture limit (received ${output.capture.stdout.byteCount} bytes; sha256 ${output.capture.stdout.sha256})`
    );
  }

  return output.stdout;
}

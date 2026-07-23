import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultIsolatedTimeoutMs,
  ExecutionTimeoutError,
  isExecutionTimeout,
  isolatedAuthoringTimeoutMs,
  isolatedEvalTimeoutMs,
  withIsolatedExecution
} from "../src/engine/execution-isolation";

let targetDir = "";
beforeAll(async () => {
  targetDir = await mkdtemp(join(tmpdir(), "farrier-isolation-test-"));
});
afterAll(async () => {
  await rm(targetDir, { recursive: true, force: true });
});

describe("isolated execution lifecycle", () => {
  test("exposes only caller-declared passthrough values for exact redaction", async () => {
    const providerName = "FARRIER_TEST_PROVIDER_TOKEN";
    const ambientName = "FARRIER_TEST_UNRELATED_TOKEN";
    const previousProvider = process.env[providerName];
    const previousAmbient = process.env[ambientName];
    process.env[providerName] = "provider value with spaces";
    process.env[ambientName] = "unrelated ambient value";

    try {
      const result = await withIsolatedExecution({
        targetDir,
        nativeConfinement: true,
        environmentPassthrough: [providerName],
        environmentOverrides: {
          FARRIER_CONFIG_PATH: "/tmp/provider-config",
          [providerName]: "overridden provider value"
        },
        run: async (context) => ({
          environment: context.environment,
          redactValues: context.redactValues
        })
      });

      expect(result.value.environment[providerName]).toBe("overridden provider value");
      expect(result.value.environment[ambientName]).toBeUndefined();
      expect(result.value.redactValues).toEqual(["overridden provider value"]);
      expect(result.value.redactValues).not.toContain("/tmp/provider-config");
    } finally {
      if (previousProvider === undefined) delete process.env[providerName];
      else process.env[providerName] = previousProvider;
      if (previousAmbient === undefined) delete process.env[ambientName];
      else process.env[ambientName] = previousAmbient;
    }
  });

  test("times out with an identifiable ExecutionTimeoutError", async () => {
    const run = withIsolatedExecution({
      targetDir,
      nativeConfinement: true,
      timeoutMs: 20,
      run: async (context) => {
        await new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return "done";
      }
    });

    const error = await run.then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExecutionTimeoutError);
    expect((error as ExecutionTimeoutError).timeoutMs).toBe(20);
    expect(isExecutionTimeout(error)).toBeTrue();
    // The TUI keeps only error.message on failed batch items, so string
    // detection must work too.
    expect(isExecutionTimeout((error as Error).message)).toBeTrue();
  });

  test("isExecutionTimeout ignores unrelated failures and non-errors", () => {
    expect(isExecutionTimeout(new Error("backend exited with code 1"))).toBeFalse();
    expect(isExecutionTimeout("cancelled")).toBeFalse();
    expect(isExecutionTimeout(undefined)).toBeFalse();
    expect(isExecutionTimeout(null)).toBeFalse();
  });

  test("authoring and eval budgets exceed the default fallback", () => {
    expect(defaultIsolatedTimeoutMs).toBe(120_000);
    expect(isolatedAuthoringTimeoutMs).toBeGreaterThan(defaultIsolatedTimeoutMs);
    expect(isolatedEvalTimeoutMs).toBeGreaterThanOrEqual(isolatedAuthoringTimeoutMs);
  });

  test("timeout waits for aborted work to settle before deleting its workspace", async () => {
    let workspace = "";
    let existedWhileSettling = false;
    let settled = false;

    const run = withIsolatedExecution({
      targetDir,
      nativeConfinement: true,
      timeoutMs: 20,
      run: async (context) => {
        workspace = context.workspace;
        await new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => {
            setTimeout(() => {
              existedWhileSettling = existsSync(context.workspace);
              settled = true;
              resolve();
            }, 50);
          }, { once: true });
        });
        return "late";
      }
    });

    await expect(run).rejects.toThrow("timed out after 20ms");
    expect(settled).toBeTrue();
    expect(existedWhileSettling).toBeTrue();
    expect(existsSync(workspace)).toBeFalse();
  });

  test("a failed execution still verifies target integrity before cleanup", async () => {
    const changedPath = join(targetDir, "unexpected.txt");
    await expect(withIsolatedExecution({
      targetDir,
      nativeConfinement: false,
      run: async () => {
        await Bun.write(changedPath, "changed");
        throw new Error("backend failed");
      }
    })).rejects.toThrow("changed the target project");
    expect(existsSync(changedPath)).toBeTrue();
    await rm(changedPath, { force: true });
  });

  test("late cancellation cleanup removes its workspace even after target drift", async () => {
    let workspace = "";
    const changedPath = join(targetDir, "late-drift.txt");
    const controller = new AbortController();
    let started!: () => void;
    const callbackStarted = new Promise<void>((resolve) => { started = resolve; });
    const run = withIsolatedExecution({
      targetDir,
      nativeConfinement: true,
      signal: controller.signal,
      run: async (context) => {
        workspace = context.workspace;
        started();
        await Bun.sleep(1_200);
        await Bun.write(changedPath, "changed after cancellation");
        return "ignored abort";
      }
    });
    await callbackStarted;
    controller.abort(new Error("caller cancelled"));

    await expect(run).rejects.toThrow("workspace was retained until process cleanup completes");
    expect(existsSync(workspace)).toBeTrue();
    await Bun.sleep(250);
    expect(existsSync(changedPath)).toBeTrue();
    expect(existsSync(workspace)).toBeFalse();
    await rm(changedPath, { force: true });
  });
});

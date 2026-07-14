<file_map>
2026-07-02-farrier
├── docs
│   ├── plans
│   │   ├── provider-native-authoring-shared-skills-2026-07-14.md *
│   │   ├── context-skill-advisor.md
│   │   └── farrier-harness-quality-repair-2026-07-13.md
│   ├── reviews
│   ├── PLAN.md
│   ├── harness-model.md
│   ├── registries.md
│   └── tui-keymap.md
├── src
│   ├── cli
│   │   ├── advise.ts *
│   │   ├── doctor.ts *
│   │   ├── skill-eval.ts *
│   │   ├── skill-new.ts *
│   │   ├── update.ts *
│   │   ├── create.ts
│   │   └── registry.ts
│   ├── engine
│   │   ├── advice-apply.ts *
│   │   ├── advice-catalog.ts *
│   │   ├── advice-sessions.ts *
│   │   ├── advice-types.ts *
│   │   ├── advise.ts *
│   │   ├── agent-selection.ts *
│   │   ├── backend.ts *
│   │   ├── behavior-evidence.ts *
│   │   ├── create-plan-apply.ts *
│   │   ├── create-plan.ts *
│   │   ├── create-skill.ts *
│   │   ├── doctor.ts *
│   │   ├── eval-skill.ts *
│   │   ├── execution-isolation.ts *
│   │   ├── mutation-transaction.ts *
│   │   ├── project-advice.ts *
│   │   ├── skill-authoring-prompt.ts *
│   │   ├── skill-creation-plan.ts *
│   │   ├── skill-paths.ts *
│   │   ├── skills.ts *
│   │   ├── update.ts *
│   │   ├── advice-batch.ts
│   │   ├── advice-patterns.ts
│   │   ├── codex-app-server.ts
│   │   ├── create-plan-fs.ts
│   │   ├── detect.ts
│   │   ├── eval-judge.ts
│   │   ├── eval-report.ts
│   │   ├── learn.ts
│   │   ├── project-profile.ts
│   │   ├── refine-skill.ts
│   │   ├── render.ts
│   │   └── skill-validate.ts
│   ├── templates
│   │   ├── skills
│   │   │   ├── claude-automation-recommender
│   │   │   │   ├── evals
│   │   │   │   │   └── cases.json
│   │   │   │   ├── upstream
│   │   │   │   │   ├── references
│   │   │   │   │   │   ├── hooks-patterns.md
│   │   │   │   │   │   ├── mcp-servers.md
│   │   │   │   │   │   ├── plugins-reference.md
│   │   │   │   │   │   ├── skills-reference.md
│   │   │   │   │   │   └── subagent-templates.md
│   │   │   │   │   ├── LICENSE.txt
│   │   │   │   │   └── SKILL.md
│   │   │   │   ├── SKILL.md *
│   │   │   │   └── UPSTREAM.md
│   │   │   ├── farrier-project-advisor
│   │   │   │   ├── evals
│   │   │   │   │   └── cases.json
│   │   │   │   └── SKILL.md *
│   │   │   └── harness-advisor
│   │   │       ├── evals
│   │   │       │   └── cases.json
│   │   │       └── SKILL.md *
│   │   └── hooks
│   │       ├── prompts
│   │       │   ├── quality-judge-v1.txt
│   │       │   └── stop-judge-v1.txt
│   │       ├── _hook_runtime.py
│   │       ├── quality-judge.py
│   │       ├── secret-shield.py
│   │       ├── stop-judge.py
│   │       ├── test_hook_contract.py
│   │       ├── test_quality_judge.py
│   │       ├── test_secret_shield.py
│   │       ├── test_stop_judge.py
│   │       ├── test_tool_policy.py
│   │       ├── test_verb_runner.py
│   │       ├── test_write_guard.py
│   │       ├── tool-policy.py
│   │       ├── verb-runner.py
│   │       └── write-guard.py
│   ├── tui
│   │   ├── advice-actions.ts *
│   │   ├── advise-app.tsx *
│   │   ├── advise-machine.ts *
│   │   ├── create-app.tsx *
│   │   ├── create-eval.tsx *
│   │   ├── AdviceApplyFlow.tsx
│   │   ├── AdviceBatchFlow.tsx
│   │   ├── ButtonBar.tsx
│   │   ├── CreateStep.tsx
│   │   ├── HooksStep.tsx
│   │   ├── LearnStep.tsx
│   │   ├── RefineScreen.tsx
│   │   ├── ReviewStep.tsx
│   │   ├── SkillsStep.tsx
│   │   ├── StackStep.tsx
│   │   ├── app.tsx
│   │   ├── chrome.tsx
│   │   ├── collision.tsx
│   │   ├── create-progress.tsx
│   │   ├── harness-write.ts
│   │   ├── keymap.ts
│   │   ├── launcher.tsx
│   │   ├── machine.ts
│   │   ├── pack-presentation.ts
│   │   ├── skill-install-failures.tsx
│   │   ├── use-harness-review.ts
│   │   ├── verbs.ts
│   │   ├── wizard-create.tsx
│   │   └── wizard-done.tsx
│   ├── config
│   │   └── farrier-config.ts
│   ├── packs
│   │   ├── generic.ts
│   │   ├── index.ts
│   │   ├── merge.ts
│   │   ├── python-fastapi.ts
│   │   ├── python-lambda-powertools.ts
│   │   ├── python-uv.ts
│   │   ├── rails.ts
│   │   ├── ts-base.ts
│   │   ├── ts-lambda.ts
│   │   ├── ts-nextjs.ts
│   │   ├── ts-react-vite.ts
│   │   └── types.ts
│   ├── registry
│   │   ├── catalog.ts
│   │   ├── client.ts
│   │   ├── error.ts
│   │   ├── ref.ts
│   │   ├── schema.ts
│   │   └── source.ts
│   └── cli.ts *
├── tests
│   ├── fixtures
│   │   └── fake-skills.ts
│   ├── advice-cli.test.ts *
│   ├── create-skill.test.ts *
│   ├── eval-skill.test.ts *
│   ├── mutation-transaction.test.ts *
│   ├── project-advice.test.ts *
│   ├── skill-new-cli.test.ts *
│   ├── tui-parity.test.ts *
│   ├── update.test.ts *
│   ├── advice-apply.test.ts
│   ├── advice-batch.test.ts
│   ├── advice-packaging.test.ts
│   ├── advice-sessions.test.ts
│   ├── advice-tui.test.ts
│   ├── advise.test.ts
│   ├── backend-stream.test.ts
│   ├── backend.test.ts
│   ├── behavior-evidence.test.ts
│   ├── cli-e2e.test.ts
│   ├── create-cli.test.ts
│   ├── create-plan-apply.test.ts
│   ├── create-plan-fs.test.ts
│   ├── create-plan.test.ts
│   ├── detect.test.ts
│   ├── doctor.test.ts
│   ├── farrier-config.test.ts
│   ├── harness-write.test.ts
│   ├── keymap.test.ts
│   ├── launcher.test.ts
│   ├── learn.test.ts
│   ├── machine.test.ts
│   ├── refine-skill.test.ts
│   ├── registry-catalog.test.ts
│   ├── registry-client.test.ts
│   ├── registry-ref.test.ts
│   ├── registry-schema.test.ts
│   ├── render.test.ts
│   ├── skill-validate.test.ts
│   ├── skills.test.ts
│   ├── tui-interactions.test.tsx
│   └── verbs.test.ts
├── .agents
│   └── skills
│       └── remotion-best-practices
│           ├── rules
│           │   ├── assets
│           │   │   ├── charts-bar-chart.tsx
│           │   │   ├── text-animations-typewriter.tsx
│           │   │   └── text-animations-word-highlight.tsx
│           │   ├── 3d.md
│           │   ├── audio-visualization.md
│           │   ├── audio.md
│           │   ├── calculate-metadata.md
│           │   ├── compositions.md
│           │   ├── display-captions.md
│           │   ├── effects.md
│           │   ├── ffmpeg.md
│           │   ├── get-audio-duration.md
│           │   ├── get-video-dimensions.md
│           │   ├── get-video-duration.md
│           │   ├── gifs.md
│           │   ├── google-fonts.md
│           │   ├── html-in-canvas.md
│           │   ├── images.md
│           │   ├── import-srt-captions.md
│           │   ├── light-leaks.md
│           │   ├── local-fonts.md
│           │   ├── lottie.md
│           │   ├── maplibre.md
│           │   ├── measuring-dom-nodes.md
│           │   ├── measuring-text.md
│           │   ├── parameters.md
│           │   ├── sequencing.md
│           │   ├── sfx.md
│           │   ├── silence-detection.md
│           │   ├── subtitles.md
│           │   ├── tailwind.md
│           │   ├── text-animations.md
│           │   ├── timing.md
│           │   ├── transcribe-captions.md
│           │   ├── transitions.md
│           │   ├── transparent-videos.md
│           │   ├── trimming.md
│           │   ├── video-layout.md
│           │   ├── videos.md
│           │   └── voiceover.md
│           └── SKILL.md
├── .ruff_cache
├── examples
│   └── registries
│       ├── acme
│       │   ├── demo.json
│       │   ├── guard.json
│       │   ├── platform-skills.json
│       │   └── registry.json
│       └── README.md
├── prompt-exports
├── README.md *
├── justfile *
├── konsistent.json *
├── package.json *
├── .farrier.json
├── .gitignore
├── AGENTS.md
├── CLAUDE.md
├── bun.lock
├── skills-lock.json
└── tsconfig.json


(* denotes selected files)
</file_map>
<file_contents>
File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/create-plan-apply.ts
```ts
import { lstat, mkdir, rm, rmdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  assertHarnessChangePlanWritable,
  inspectHarnessChangePlan,
  type ApplyHarnessChangePlanDeps,
  type ApplyHarnessChangePlanOptions,
  type ApplyHarnessChangePlanResult,
  type HarnessFileChange,
} from "./create-plan";
import {
  assertStableDirectoryChain,
  commitStagedCreation,
  commitStagedReplacement,
  directoryIdentity,
  pathMatchesFingerprint,
  removeStaged,
  sameFingerprint,
  snapshotRegularFile,
  stageFile,
  type DirectoryIdentity,
  type FileFingerprint,
  type FileSnapshot,
} from "./create-plan-fs";
import { renderPlanDigest, type RenderPlan } from "./render";

type OriginalFile = { existed: false } | { existed: true; snapshot: FileSnapshot };
type AppliedChange = { path: string; absolutePath: string; original: OriginalFile; written: FileFingerprint };

export class HarnessApplyError extends Error {
  readonly mutationState: "rolled-back" | "rollback-incomplete";
  readonly backupDir: string | null;

  constructor(message: string, options: { mutationState: "rolled-back" | "rollback-incomplete"; backupDir: string | null; cause: unknown }) {
    super(options.backupDir ? `${message}; recovery backup retained at ${options.backupDir}` : message, { cause: options.cause });
    this.name = "HarnessApplyError";
    this.mutationState = options.mutationState;
    this.backupDir = options.backupDir;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

async function maybeLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function nowFrom(options: ApplyHarnessChangePlanOptions): Date {
  return typeof options.now === "function" ? options.now() : (options.now ?? new Date());
}

function backupDirectory(date: Date): string {
  const timestamp = date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return join(".farrier-staging", "backups", timestamp);
}

async function ensureDirectory(targetRoot: string, absoluteDirectory: string, created: Set<string>): Promise<void> {
  const fromRoot = relative(targetRoot, absoluteDirectory);
  let current = targetRoot;
  for (const component of fromRoot.split(sep).filter(Boolean)) {
    current = join(current, component);
    const info = await maybeLstat(current);
    if (info) {
      if (info.isSymbolicLink()) throw new Error(`Refusing symbolic-link directory ${relative(targetRoot, current)}`);
      if (!info.isDirectory()) throw new Error(`Refusing non-directory parent ${relative(targetRoot, current)}`);
      continue;
    }
    try {
      await mkdir(current);
      created.add(current);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const raced = await lstat(current);
      if (raced.isSymbolicLink() || !raced.isDirectory()) throw new Error(`Refusing unsafe parent ${relative(targetRoot, current)}`);
    }
  }
}

async function snapshotFor(change: HarnessFileChange, absolutePath: string): Promise<OriginalFile> {
  const info = await maybeLstat(absolutePath);
  if (change.action === "create") {
    if (info) throw new Error(`${change.path} appeared after the change plan was inspected`);
    return { existed: false };
  }
  if (!info || info.isSymbolicLink() || !info.isFile()) throw new Error(`${change.path} changed to an unsafe file type after the change plan was inspected`);
  const snapshot = await snapshotRegularFile(absolutePath);
  if (!change.inspection || !sameFingerprint(snapshot.fingerprint, change.inspection)) throw new Error(`${change.path} changed after the creation plan was inspected`);
  return { existed: true, snapshot };
}

async function writeBackup(
  targetRoot: string,
  backupDir: string,
  path: string,
  original: Extract<OriginalFile, { existed: true }>,
  rootIdentity: DirectoryIdentity,
  backupDirectories: Set<string>,
  backupFiles: Map<string, FileFingerprint>,
): Promise<void> {
  const absoluteBackup = join(targetRoot, backupDir, path);
  await ensureDirectory(targetRoot, dirname(absoluteBackup), backupDirectories);
  await assertStableDirectoryChain(targetRoot, rootIdentity, dirname(absoluteBackup));
  const ignorePath = join(targetRoot, ".farrier-staging", ".gitignore");
  if (!(await maybeLstat(ignorePath))) {
    const ignore = await stageFile(ignorePath, "*\n", 0o644);
    try {
      await commitStagedCreation(ignore, ignorePath);
      backupFiles.set(ignorePath, ignore.fingerprint);
    } finally {
      await removeStaged(ignore.path).catch(() => undefined);
    }
  }
  const staged = await stageFile(absoluteBackup, original.snapshot.content, original.snapshot.fingerprint.mode);
  try {
    await commitStagedCreation(staged, absoluteBackup);
    backupFiles.set(absoluteBackup, staged.fingerprint);
  } finally {
    await removeStaged(staged.path).catch(() => undefined);
  }
}

async function removeEmptyDirectories(directories: Set<string>, failures: string[]): Promise<void> {
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!new Set(["ENOENT", "ENOTEMPTY", "EEXIST"]).has(errorCode(error) ?? "")) failures.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function restoreChange(change: AppliedChange): Promise<string | undefined> {
  if (!(await pathMatchesFingerprint(change.absolutePath, change.written))) return `${change.path}: rollback conflict; the path changed after Farrier wrote it`;
  if (!change.original.existed) {
    if (!(await pathMatchesFingerprint(change.absolutePath, change.written))) return `${change.path}: rollback conflict before removing the created file`;
    await rm(change.absolutePath, { force: true });
    return undefined;
  }

  const staged = await stageFile(change.absolutePath, change.original.snapshot.content, change.original.snapshot.fingerprint.mode);
  try {
    if (!(await pathMatchesFingerprint(change.absolutePath, change.written))) return `${change.path}: rollback conflict before restoring the original`;
    await commitStagedReplacement(staged, change.absolutePath);
    const restored = await snapshotRegularFile(change.absolutePath);
    if (restored.fingerprint.sha256 !== change.original.snapshot.fingerprint.sha256 || restored.fingerprint.mode !== change.original.snapshot.fingerprint.mode) {
      return `${change.path}: restored content or permissions did not match the original`;
    }
    return undefined;
  } finally {
    await removeStaged(staged.path).catch(() => undefined);
  }
}

async function restoreChanges(changes: AppliedChange[]): Promise<string[]> {
  const failures: string[] = [];
  for (const change of [...changes].reverse()) {
    try {
      const failure = await restoreChange(change);
      if (failure) failures.push(failure);
    } catch (error) {
      failures.push(`${change.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

async function cleanupFailedRunBackups(backupFiles: Map<string, FileFingerprint>, backupDirectories: Set<string>): Promise<string[]> {
  const failures: string[] = [];
  for (const [file, fingerprint] of backupFiles) {
    try {
      if (!(await pathMatchesFingerprint(file, fingerprint))) {
        failures.push(`${file}: rollback conflict; backup path changed before cleanup`);
        continue;
      }
      await rm(file, { force: true });
    } catch (error) {
      failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await removeEmptyDirectories(backupDirectories, failures);
  return failures;
}

async function ensureTargetRoot(targetRoot: string, createdDirectories: Set<string>): Promise<DirectoryIdentity> {
  const existing = await maybeLstat(targetRoot);
  if (!existing) {
    await mkdir(targetRoot, { recursive: true });
    createdDirectories.add(targetRoot);
  } else if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new Error("Target directory changed to an unsafe type after the creation plan was inspected");
  }
  return directoryIdentity(targetRoot);
}

async function assertOriginalStillCurrent(change: HarnessFileChange, original: OriginalFile, absolutePath: string): Promise<void> {
  if (!original.existed) {
    if (await maybeLstat(absolutePath)) throw new Error(`${change.path} appeared after the creation plan was inspected`);
    return;
  }
  const current = await snapshotRegularFile(absolutePath);
  if (!sameFingerprint(current.fingerprint, original.snapshot.fingerprint)) throw new Error(`${change.path} changed after the creation plan was inspected`);
}

export async function applyHarnessChangePlan(renderPlan: RenderPlan, options: ApplyHarnessChangePlanOptions, deps: ApplyHarnessChangePlanDeps = {}): Promise<ApplyHarnessChangePlanResult> {
  if (renderPlan.reviewedDigest && renderPlanDigest(renderPlan.files) !== renderPlan.reviewedDigest) {
    throw new HarnessApplyError(
      "Refusing to apply: rendered bytes changed after review; rerun preview and review the new executable payload",
      { cause: new Error("review digest mismatch"), mutationState: "rolled-back", backupDir: null }
    );
  }
  const plan = await inspectHarnessChangePlan(renderPlan);
  assertHarnessChangePlanWritable(plan, options);
  const targetRoot = resolve(renderPlan.targetDir);
  const changeByPath = new Map(plan.files.map((file) => [file.path, file]));
  const written: string[] = [];
  const unchanged = plan.files.filter((file) => file.action === "unchanged").map((file) => file.path);
  const applied: AppliedChange[] = [];
  const createdDirectories = new Set<string>();
  const backupDirectories = new Set<string>();
  const backupFiles = new Map<string, FileFingerprint>();
  const stagedPaths = new Set<string>();
  const backupDir = plan.replacementPaths.length > 0 ? backupDirectory(nowFrom(options)) : null;

  try {
    const rootIdentity = await ensureTargetRoot(targetRoot, createdDirectories);
    for (const [index, file] of renderPlan.files.entries()) {
      const change = changeByPath.get(file.path);
      if (!change || change.action === "unchanged") continue;

      const absolutePath = resolve(targetRoot, file.path);
      await ensureDirectory(targetRoot, dirname(absolutePath), createdDirectories);
      await assertStableDirectoryChain(targetRoot, rootIdentity, dirname(absolutePath));
      const original = await snapshotFor(change, absolutePath);
      if (change.action === "replace" && backupDir && original.existed) {
        await writeBackup(targetRoot, backupDir, file.path, original, rootIdentity, backupDirectories, backupFiles);
      }

      const finalMode = file.mode ?? (original.existed ? original.snapshot.fingerprint.mode : undefined);
      const staged = await stageFile(absolutePath, file.content, finalMode);
      stagedPaths.add(staged.path);
      await deps.beforeWrite?.({ file, change, index });
      await assertStableDirectoryChain(targetRoot, rootIdentity, dirname(absolutePath));
      await assertOriginalStillCurrent(change, original, absolutePath);
      if (original.existed) await commitStagedReplacement(staged, absolutePath);
      else await commitStagedCreation(staged, absolutePath);
      await removeStaged(staged.path).catch(() => undefined);
      stagedPaths.delete(staged.path);
      applied.push({ path: file.path, absolutePath, original, written: staged.fingerprint });
      if (!(await pathMatchesFingerprint(absolutePath, staged.fingerprint))) throw new Error(`${file.path} changed while Farrier was committing it`);
      written.push(file.path);
    }
  } catch (error) {
    await Promise.all([...stagedPaths].map((path) => removeStaged(path).catch(() => undefined)));
    const rollbackFailures = await restoreChanges(applied);
    if (rollbackFailures.length === 0) rollbackFailures.push(...(await cleanupFailedRunBackups(backupFiles, backupDirectories)));
    await removeEmptyDirectories(createdDirectories, rollbackFailures);
    const message = error instanceof Error ? error.message : String(error);
    const incomplete = rollbackFailures.length > 0;
    throw new HarnessApplyError(incomplete ? `${message}; rollback incomplete: ${rollbackFailures.join("; ")}` : message, {
      cause: error,
      mutationState: incomplete ? "rollback-incomplete" : "rolled-back",
      backupDir: incomplete ? backupDir : null,
    });
  }

  return { written, unchanged, writtenFiles: written, unchangedFiles: unchanged, backupDir };
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/tests/advice-cli.test.ts
```ts
import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

async function runCli(args: string[], env: Record<string, string>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn({
    cmd: [process.execPath, join(repoRoot, "src", "cli.ts"), ...args],
    cwd: repoRoot,
    env: { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  return { exitCode, stdout, stderr };
}

test("headless advice accepts realistic Claude and Codex final JSON in human and JSON modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "farrier-advice-cli-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await Bun.write(join(root, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
  await Bun.write(join(root, "AGENTS.md"), "Run the test suite before stopping.\n");
  const payload = (provider: "claude" | "codex") => `JSON.stringify({ recommendations: [{
  id: "guidance:cli-parity",
  category: "guidance",
  targetVendors: ["${provider}"],
  reason: "Keep the discovered verification command in shared guidance.",
  benefit: "Gives every supported agent the same completion standard without repeated prompting.",
  evidence: ["project:root"],
  confidence: "high",
  routeId: "guidance:agents-md"
}], coverage: [{ category: "guidance", reason: "One shared-guidance improvement is strongly supported." }] })`;
  const claude = join(bin, "claude");
  await writeFile(claude, `#!/usr/bin/env bun
await Bun.stdin.text();
console.log(${payload("claude")});
`, "utf8");
  await chmod(claude, 0o755);
  const codex = join(bin, "codex");
  await writeFile(codex, `#!/usr/bin/env bun
console.log("I inspected the bounded project evidence.\\n\\n\`\`\`json");
console.log(${payload("codex")});
console.log("\`\`\`");
`, "utf8");
  await chmod(codex, 0o755);
  const env = { PATH: `${bin}${delimiter}${Bun.env.PATH ?? ""}` };

  for (const backend of ["claude", "codex"] as const) {
    const common = ["advise", "--dir", root, "--sessions", "none", "--only", "guidance", "--backend", backend];
    const human = await runCli(common, env);
    const json = await runCli([...common, "--json"], env);

    expect(human.exitCode).toBe(0);
    expect(json.exitCode).toBe(0);
    for (const stderr of [human.stderr, json.stderr]) {
      expect(stderr).toContain("Profiling project structure");
      expect(stderr).toContain(`Asking ${backend} for bounded recommendations`);
      expect(stderr).toContain("Report ready with 1 validated recommendation");
    }
    const report = JSON.parse(json.stdout);
    expect(report.reportOnly).toBe(true);
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0].benefit).toBe("Gives every supported agent the same completion standard without repeated prompting.");
    expect(report.coverage).toEqual([{ category: "guidance", status: "accepted", reason: "One shared-guidance improvement is strongly supported." }]);
    expect(human.stdout).toContain(report.recommendations[0].id);
    expect(human.stdout).toContain(report.recommendations[0].reason);
    expect(human.stdout).toContain(report.recommendations[0].benefit);
    expect(human.stdout).toContain(report.recommendations[0].implementationRoute.description);
  }
});

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/skill-authoring-prompt.ts
```ts
import type { AgentBackend } from "./backend";

const descriptionCharLimit = 16_000;

function truncateRequest(text: string): string {
  return text.length <= descriptionCharLimit
    ? text
    : `${text.slice(0, descriptionCharLimit)}\n\n[request truncated to ${descriptionCharLimit} characters]`;
}

export function buildAuthoringPrompt(input: {
  agent: AgentBackend;
  description: string;
  outputRoot: string;
  nameOverride?: string;
}): string {
  const creator = input.agent === "claude"
    ? "Use the skill-creator skill installed in this project"
    : "Use the built-in $skill-creator skill";
  const nameLine = input.nameOverride ? `\n- Name the skill exactly '${input.nameOverride}'.` : "";
  return `${creator} to create exactly one agent skill for the request below.
Requirements:
- Create the skill directory under ${input.outputRoot}/ only, as ${input.outputRoot}/<skill-name>/SKILL.md plus any supporting files inside that same directory. Do not create or modify any other files.
- SKILL.md must start with YAML frontmatter containing name (kebab-case, at most 64 characters, matching the directory name) and description (one sentence saying what the skill does and when to use it).${nameLine}
- Create evals/cases.json with {\"version\":1,\"cases\":[...]} containing at least one positive and one negative case. Each case needs a kebab-case id, kind (positive or negative), a bounded prompt, and expectedBehavior. Do not include transcripts, credentials, tokens, or personal data.
- Do not ask questions; make reasonable decisions and finish.
Skill request:
${truncateRequest(input.description)}
`;
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/create-plan.ts
```ts
import { lstat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExecutableProvenance, RenderedFile, RenderPlan } from "./render";
import { snapshotRegularFile, type FileFingerprint, type FileSnapshot } from "./create-plan-fs";

export const harnessChangeActions = ["create", "unchanged", "merge", "update", "replace", "blocked"] as const;

export type HarnessChangeAction = (typeof harnessChangeActions)[number];
export type HarnessFileAction = HarnessChangeAction;

export type FilePurposeContext = {
  hookCount?: number;
  skillCount?: number;
  ruleCount?: number;
  packId?: string;
  konsistentTool?: string;
  verbs?: { check?: string; test?: string; fmt?: string; konsistent?: string };
};

export type HarnessFileChange = {
  path: string;
  action: HarnessChangeAction;
  purpose: string;
  reason: string;
  requiresForce: boolean;
  exists: boolean;
  reviewedContent?: string;
  previousContent?: string;
  inspection?: FileFingerprint;
  executableProvenance?: ExecutableProvenance;
};

export type HarnessChangeBlocker = { path: string; reason: string };

export type HarnessChangeCounts = Record<HarnessChangeAction, number>;

export type HarnessChangePlan = {
  targetDir: string;
  existingHarness: boolean;
  files: HarnessFileChange[];
  counts: HarnessChangeCounts;
  replacementPaths: string[];
  replacements: string[];
  blockers: HarnessChangeBlocker[];
};

export type ApplyHarnessChangePlanOptions = {
  force: boolean;
  /** A reviewed advice plan may update an existing Farrier project. */
  allowExistingHarness?: boolean;
  now?: Date | (() => Date);
};

export type ApplyHarnessChangePlanDeps = {
  beforeWrite?: (input: { file: RenderedFile; change: HarnessFileChange; index: number }) => void | Promise<void>;
};

export type ApplyHarnessChangePlanResult = {
  written: string[];
  unchanged: string[];
  writtenFiles: string[];
  unchangedFiles: string[];
  backupDir: string | null;
};

type FileInfo = Stats;

function withCount(value: number | undefined, singular: string, plural: string): string | undefined {
  if (value === undefined) return undefined;
  return `${value} ${value === 1 ? singular : plural}`;
}

/** A concise explanation of why a generated file exists, shared by human-facing surfaces. */
export function filePurpose(path: string, context: FilePurposeContext = {}): string {
  const base = path.split("/").at(-1) ?? path;

  if (path === "AGENTS.md") {
    const count = withCount(context.ruleCount, "agent rule", "agent rules");
    return count ? `Shared agent instructions and source of truth with ${count}.` : "Agent instructions and project commands.";
  }
  if (path === "CLAUDE.md") return "Loads AGENTS.md into Claude Code.";
  if (path === ".claude/settings.json") {
    const count = withCount(context.hookCount, "hook", "hooks");
    return count ? `Wires ${count} into Claude Code.` : "Wires generated hooks into Claude Code.";
  }
  if (path === ".codex/hooks.json") {
    const count = withCount(context.hookCount, "shared hook", "shared hooks");
    return count ? `Wires ${count} into Codex.` : "Wires generated shared hooks into Codex.";
  }
  if (path === ".claude/skills/harness-advisor/SKILL.md") return "Teaches agents how to maintain the harness.";
  if (path.startsWith(".claude/skills/claude-automation-recommender/")) return "Pinned Claude project-advice skill and its attributed upstream references.";
  if (path === ".agents/skills/farrier-project-advisor/SKILL.md") return "Codex-native wrapper for Farrier's shared project-advice engine.";
  if (path.startsWith(".claude/hooks/@")) return "Executable hook supplied by a configured registry.";
  if (path.includes("/hooks/prompts/") && base.endsWith(".txt")) return "Versioned semantic-judge prompt.";
  if (base === "tool-policy-rules.json") return "Declarative command-denial rules.";
  if (path.includes("/hooks/test_")) return "Tests the adjacent generated hook.";
  if (path.includes("/hooks/")) return "Generated hook implementation.";
  if (path === "justfile") return "Stable project verification commands.";
  if (base === "konsistent.json" || base === "konpy.json") {
    return `${context.konsistentTool ?? base.replace(".json", "")} structure conventions.`;
  }
  if (path === ".farrier.json") {
    const skills = withCount(context.skillCount, "skill", "skills");
    const pack = context.packId ? ` for ${context.packId}` : "";
    return skills ? `Farrier manifest${pack}, including ${skills}.` : `Farrier manifest${pack}.`;
  }
  if (path === ".gitignore") return "Keeps local secrets and Farrier staging out of version control.";

  return "Generated harness file.";
}

function emptyCounts(): HarnessChangeCounts {
  return {
    create: 0,
    unchanged: 0,
    merge: 0,
    update: 0,
    replace: 0,
    blocked: 0,
  };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

async function maybeLstat(path: string): Promise<FileInfo | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function unsafeRelativePath(path: string, targetRoot: string): string | undefined {
  if (!path || path.includes("\0") || isAbsolute(path)) {
    return "Generated path must be a non-empty relative path.";
  }

  if (path.split(/[\\/]/).includes("..")) {
    return "Generated path may not contain '..' components.";
  }

  const absolutePath = resolve(targetRoot, path);
  const fromRoot = relative(targetRoot, absolutePath);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    return "Generated path must stay inside the target directory.";
  }

  return undefined;
}

async function parentBlocker(targetRoot: string, absolutePath: string): Promise<string | undefined> {
  const parent = dirname(absolutePath);
  const fromRoot = relative(targetRoot, parent);
  if (!fromRoot) {
    return undefined;
  }

  let current = targetRoot;
  for (const component of fromRoot.split(sep).filter(Boolean)) {
    current = join(current, component);
    const info = await maybeLstat(current);
    if (!info) {
      return undefined;
    }
    if (info.isSymbolicLink()) {
      return `Parent path '${relative(targetRoot, current)}' is a symbolic link.`;
    }
    if (!info.isDirectory()) {
      return `Parent path '${relative(targetRoot, current)}' is not a directory.`;
    }
  }

  return undefined;
}

function describedChange(
  file: RenderedFile,
  action: HarnessChangeAction,
  purpose: string,
  reason: string,
  exists = false,
  inspection?: FileFingerprint,
  previousContent?: string
): HarnessFileChange {
  return {
    path: file.path,
    action,
    purpose,
    reason,
    requiresForce: action === "replace",
    exists,
    reviewedContent: file.content,
    inspection,
    ...(previousContent !== undefined ? { previousContent } : {}),
    ...(file.executableProvenance ? { executableProvenance: file.executableProvenance } : {})
  };
}

function blockedChange(file: RenderedFile, purpose: string, reason: string, exists = false): HarnessFileChange {
  return describedChange(file, "blocked", purpose, reason, exists);
}

async function inspectFile(targetRoot: string, file: RenderedFile, purpose: string): Promise<HarnessFileChange> {
  const unsafe = unsafeRelativePath(file.path, targetRoot);
  if (unsafe) {
    return blockedChange(file, purpose, unsafe);
  }

  const absolutePath = resolve(targetRoot, file.path);
  const badParent = await parentBlocker(targetRoot, absolutePath);
  if (badParent) {
    return blockedChange(file, purpose, badParent);
  }

  const info = await maybeLstat(absolutePath);
  if (!info) {
    return describedChange(file, "create", purpose, "File does not exist.");
  }
  if (info.isSymbolicLink()) return blockedChange(file, purpose, "Target path is a symbolic link.", true);
  if (info.isDirectory()) return blockedChange(file, purpose, "Target path is a directory.", true);
  if (!info.isFile()) return blockedChange(file, purpose, "Target path is not a regular file.", true);

  let snapshot: FileSnapshot;
  try {
    snapshot = await snapshotRegularFile(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return blockedChange(file, purpose, `Existing file cannot be read: ${message}`, true);
  }
  const current = snapshot.content.toString("utf8");

  if (current === file.content) {
    if (file.mode !== undefined && (file.mode & 0o7777) !== snapshot.fingerprint.mode) {
      return describedChange(file, "update", purpose, `Content matches, but permissions must be normalized to ${file.mode.toString(8)}.`, true, snapshot.fingerprint, current);
    }
    return describedChange(file, "unchanged", purpose, "Existing content and permissions already match.", true, snapshot.fingerprint, current);
  }

  if (file.path === ".gitignore" && file.content.startsWith(current)) {
    return describedChange(file, "merge", purpose, "Planned content only appends missing Farrier ignore entries.", true, snapshot.fingerprint, current);
  }

  return describedChange(file, "replace", purpose, "Existing content differs from the planned content.", true, snapshot.fingerprint, current);
}

function targetRootBlocker(info: FileInfo | undefined): string | undefined {
  if (!info) return undefined;
  if (info.isSymbolicLink()) return "Target directory is a symbolic link.";
  if (!info.isDirectory()) return "Target directory is not a directory.";
  return undefined;
}

export async function inspectHarnessChangePlan(renderPlan: RenderPlan, purposeContext?: FilePurposeContext): Promise<HarnessChangePlan> {
  const targetRoot = resolve(renderPlan.targetDir);
  const rootBlocker = targetRootBlocker(await maybeLstat(targetRoot));
  const existingHarness = rootBlocker ? false : (await maybeLstat(join(targetRoot, ".farrier.json"))) !== undefined;
  const seen = new Set<string>();

  const files = await Promise.all(
    renderPlan.files.map(async (file) => {
      const purpose = filePurpose(file.path, purposeContext);
      if (rootBlocker) return blockedChange(file, purpose, rootBlocker);
      if (seen.has(file.path)) {
        return blockedChange(file, purpose, "Render plan contains this path more than once.");
      }
      seen.add(file.path);
      return inspectFile(targetRoot, file, purpose);
    }),
  );

  const counts = emptyCounts();
  for (const file of files) {
    counts[file.action] += 1;
  }
  const replacementPaths = files.filter((file) => file.action === "replace").map((file) => file.path);

  return {
    targetDir: renderPlan.targetDir,
    existingHarness,
    files,
    counts,
    replacementPaths,
    replacements: replacementPaths,
    blockers: files.filter((file) => file.action === "blocked").map((file) => ({ path: file.path, reason: file.reason })),
  };
}

export function assertHarnessChangePlanWritable(plan: HarnessChangePlan, options: { force: boolean; allowExistingHarness?: boolean }): void {
  if (plan.existingHarness && !options.allowExistingHarness) {
    throw new Error(`Refusing to create: ${plan.targetDir} is already a Farrier project. Run 'farrier update --dir ${plan.targetDir}' instead.`);
  }

  if (plan.blockers.length > 0) {
    const details = plan.blockers.map((blocker) => `${blocker.path}: ${blocker.reason}`).join("; ");
    throw new Error(`Refusing to write blocked harness paths (force cannot bypass this): ${details}`);
  }

  if (plan.replacementPaths.length > 0 && !options.force) {
    throw new Error(`Refusing to replace existing files without --force: ${plan.replacementPaths.join(", ")}. Review the changes before retrying with --force.`);
  }
}

export { applyHarnessChangePlan, HarnessApplyError } from "./create-plan-apply";

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/create-skill.ts
```ts
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import {
  backendCommand, backendEnvironmentOverrides, backendEnvironmentPassthrough, defaultBackendRunner,
  formatBackendStreamActivity, type AgentBackend, type BackendCommandRunner
} from "./backend";
import type { ResolvedModelSettings } from "../config/farrier-config";
import {
  collapseDescription,
  maxDescriptionLength,
  maxSkillNameLength,
  skillNamePattern,
  slugifySkillName,
  snapshotSkillRoot,
  validateCreatedSkill,
  yamlScalar,
  type ValidatedSkill
} from "./skill-validate";
import {
  installSkills,
  type CommandRunner,
  type InstallSkillResult,
  type ResolveSkillsCommandDeps
} from "./skills";
import { applyMutationPlan, fingerprintPath, inspectMutationPlan } from "./mutation-transaction";
import { withIsolatedExecution, type IsolationFact } from "./execution-isolation";
import {
  canonicalSkillRoot,
  creatorRef,
  globalSkillRoot,
  nativeSkillRoots,
  resolvedHomedir,
  skillsCliAgentIds,
} from "./skill-paths";
import { buildAuthoringPrompt } from "./skill-authoring-prompt";
import { redactEvidence } from "./behavior-evidence";

export { canonicalSkillRoot, creatorRef, globalSkillRoot, nativeSkillRoots, resolvedHomedir } from "./skill-paths";
export { buildAuthoringPrompt } from "./skill-authoring-prompt";
export { scaffoldSkillDraft, slugifySkillName, validateCreatedSkill, type SkillDraft } from "./skill-validate";

export type CreateAgent = AgentBackend;

export type AuthoringMode = "author-claude" | "author-codex" | "per-agent";

export type SkillCreationRequest = {
  description: string;
  agents: CreateAgent[];
  mode: AuthoringMode;
  nameOverride?: string;
  model?: string;
};

export type SkillCreationOutcome = {
  request: SkillCreationRequest;
  name?: string;
  files: string[];
  installed: boolean;
  notes: string[];
  error?: string;
  isolation?: IsolationFact;
};

async function lockedSkillIds(targetDir: string): Promise<Set<string>> {
  try {
    const content = await readFile(join(targetDir, "skills-lock.json"), "utf8");
    const parsed = JSON.parse(content) as { skills?: Record<string, unknown> };
    return new Set(parsed.skills && typeof parsed.skills === "object" ? Object.keys(parsed.skills) : []);
  } catch {
    return new Set();
  }
}

/**
 * Global-first: an already-installed global copy (from this project or any
 * other) is used as-is; only a genuinely missing skill triggers a GitHub
 * pull, and that pull installs globally (-g) so future projects skip it too.
 */
export async function ensureCreatorInstalled(
  agent: CreateAgent,
  targetDir: string,
  runner?: CommandRunner,
  resolveDeps?: ResolveSkillsCommandDeps
): Promise<InstallSkillResult | undefined> {
  const ref = creatorRef(agent);

  if (!ref) {
    return undefined;
  }

  const skillId = ref.slice(ref.lastIndexOf("@") + 1);
  const locked = await lockedSkillIds(targetDir);

  if (locked.has(skillId)) {
    return { ref, ok: true, stdout: "", stderr: "", exitCode: 0 };
  }

  const exists = resolveDeps?.exists ?? existsSync;

  if (exists(join(globalSkillRoot(agent), skillId, "SKILL.md"))) {
    return { ref, ok: true, stdout: "", stderr: "", exitCode: 0 };
  }

  const results = await installSkills([ref], targetDir, runner, resolveDeps, [skillsCliAgentIds[agent]], true);
  return results[0];
}

export type SkillCreationPhase = "creator" | "authoring" | "validating" | "installing";

export type CollisionDecision = "replace" | "keep";

export type CollisionInfo = {
  /** targetDir-relative path of the existing skill directory. */
  path: string;
  /** targetDir-relative staging path holding the freshly authored copy. */
  stagingPath: string;
};

export type CreateSkillDeps = {
  backendRunner?: BackendCommandRunner;
  skillsRunner?: CommandRunner;
  resolveDeps?: ResolveSkillsCommandDeps;
  install?: boolean;
  progress?: (phase: SkillCreationPhase, agent?: CreateAgent, activity?: string) => void;
  /** Serializes skills-lock/manifest writers when authoring runs concurrently. */
  serializeInstall?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Aborting kills in-flight agent runs and skips work not yet started. */
  signal?: AbortSignal;
  /** Asked when the authored skill's destination already exists; absent = keep (error). */
  onCollision?: (info: CollisionInfo) => Promise<CollisionDecision>;
  /**
   * Per-backend model/effort from config resolution. Used when the request
   * carries no explicit model; each per-agent leg reads its own backend's
   * settings. Built-in defaults (claude opus, codex high effort) apply when a
   * backend has no entry.
   */
  modelSettings?: Partial<Record<CreateAgent, ResolvedModelSettings>>;
};

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("cancelled");
  }
}

const stagingRootBase = ".farrier-output";

/**
 * Each authoring run gets its own empty staging root, so concurrent runs can't
 * pollute each other's dir-diff validation, then the single validated skill
 * directory is moved into its final root. Failures leave the staged files in
 * place for inspection; success removes the run's staging dir.
 */
async function placeSkill(
  targetDir: string,
  stagingRoot: string,
  finalRoot: string,
  validated: ValidatedSkill,
  onCollision?: (info: CollisionInfo) => Promise<CollisionDecision>
): Promise<ValidatedSkill> {
  const destination = join(targetDir, finalRoot, validated.name);
  const notes = [...validated.notes];

  if (existsSync(destination)) {
    const decision = onCollision
      ? await onCollision({ path: `${finalRoot}/${validated.name}`, stagingPath: join(stagingRoot, validated.name) })
      : "keep";

    if (decision !== "replace") {
      throw new Error(
        `${finalRoot}/${validated.name} already exists. Authored files kept at ${join(stagingRoot, validated.name)} for inspection.`
      );
    }

    notes.push(`Replaced the existing ${finalRoot}/${validated.name}.`);
  }

  await applyMutationPlan(await inspectMutationPlan(targetDir, [{
    kind: "replace-tree",
    path: `${finalRoot}/${validated.name}`,
    sourcePath: join(stagingRoot, validated.name)
  }]));
  await rm(dirname(stagingRoot), { recursive: true, force: true });

  return {
    ...validated,
    notes,
    files: validated.files.map((file) => `${finalRoot}/${file.slice(stagingRootBase.length + 1)}`)
  };
}

export type StageSkillInput = {
  agent: CreateAgent;
  description: string;
  targetDir: string;
  model?: string;
  nameOverride?: string;
  deps: CreateSkillDeps;
  creatorReady?: boolean;
  cleanupOnFailure?: boolean;
};

export async function stageSkill(input: StageSkillInput): Promise<{ stagingRoot: string; validated: ValidatedSkill; isolation: IsolationFact }> {
  if (!input.creatorReady) {
    input.deps.progress?.("creator", input.agent);
    const creatorInstall = await ensureCreatorInstalled(
      input.agent,
      input.targetDir,
      input.deps.skillsRunner,
      input.deps.resolveDeps
    );

    if (creatorInstall && !creatorInstall.ok) {
      throw new Error(`Could not install the ${input.agent} creator skill (${creatorInstall.ref}): ${creatorInstall.error ?? creatorInstall.stderr}`);
    }
  }

  throwIfCancelled(input.deps.signal);
  const isolated = await withIsolatedExecution({
    targetDir: input.targetDir,
    nativeConfinement: input.agent === "codex",
    environmentPassthrough: backendEnvironmentPassthrough(input.agent),
    environmentOverrides: backendEnvironmentOverrides(input.agent),
    signal: input.deps.signal,
    retainWorkspace: true,
    retainWorkspaceOnError: !input.cleanupOnFailure,
    run: async ({ workspace, environment, signal }) => {
      const stagingRoot = stagingRootBase;
      const before = await snapshotSkillRoot(join(workspace, stagingRoot));
      const prompt = buildAuthoringPrompt({
        agent: input.agent,
        description: input.description,
        outputRoot: stagingRoot,
        nameOverride: input.nameOverride
      });
      input.deps.progress?.("authoring", input.agent);
      const settings = input.deps.modelSettings?.[input.agent];
      const model = input.model ?? settings?.model ?? (input.agent === "claude" ? "opus" : undefined);
      const reasoningEffort = settings?.reasoningEffort ?? (input.agent === "codex" ? "high" : undefined);
      const command = backendCommand(input.agent, model, prompt, { write: true, stream: true, reasoningEffort });
      const runner = input.deps.backendRunner ?? defaultBackendRunner;
      const output = await runner({
        cmd: command.cmd,
        cwd: workspace,
        stdin: command.stdin,
        signal,
        env: environment,
        onStdoutLine: (line) => {
          const activity = formatBackendStreamActivity(input.agent, line);
          if (activity) input.deps.progress?.("authoring", input.agent, activity);
        }
      });
      if (signal.aborted) throw new Error(`cancelled — killed the ${input.agent} run`);
      if (output.exitCode !== 0) {
        const stderr = output.stderr.trim();
        throw new Error(`${input.agent} backend exited with code ${output.exitCode}${stderr ? `: ${stderr}` : ""}`);
      }
      input.deps.progress?.("validating", input.agent);
      const validated = await validateCreatedSkill({ targetDir: workspace, root: stagingRoot, before, backend: input.agent, nameOverride: input.nameOverride });
      return { stagingRoot: join(workspace, stagingRoot), validated };
    }
  });
  return { ...isolated.value, isolation: isolated.isolation };
}

async function authorSkill(input: StageSkillInput & { finalRoot: string }): Promise<ValidatedSkill> {
  const { stagingRoot, validated, isolation } = await stageSkill(input);
  const placed = await placeSkill(input.targetDir, stagingRoot, input.finalRoot, validated, input.deps.onCollision);
  return {
    ...placed,
    notes: [
      ...placed.notes,
      isolation.mode === "native-confinement"
        ? "Isolation mode: native-confinement (Codex workspace-write sandbox in a temporary workspace)."
        : `Isolation mode: staged-best-effort. ${isolation.residualRisk}`
    ]
  };
}

export async function installLocalSkill(
  name: string,
  targetDir: string,
  agents: CreateAgent[],
  runner?: CommandRunner,
  resolveDeps?: ResolveSkillsCommandDeps
): Promise<InstallSkillResult> {
  const results = await installSkills(
    [`./${canonicalSkillRoot}@${name}`],
    targetDir,
    runner,
    resolveDeps,
    agents.map((agent) => skillsCliAgentIds[agent])
  );

  return results[0]!;
}

export async function recordSkillInManifest(targetDir: string, ref: string): Promise<boolean> {
  const manifestPath = join(targetDir, ".farrier.json");
  const expected = await fingerprintPath(manifestPath);
  let manifest: Record<string, unknown>;

  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return false;
  }

  if (!Array.isArray(manifest.skills)) {
    return false;
  }

  if (!manifest.skills.includes(ref)) {
    manifest.skills.push(ref);
    const plan = await inspectMutationPlan(targetDir, [{
      kind: "write-file",
      path: ".farrier.json",
      content: `${JSON.stringify(manifest, null, 2)}\n`
    }]);
    plan.operations[0]!.expected = expected;
    await applyMutationPlan(plan);
  }

  return true;
}

export async function createSkill(
  request: SkillCreationRequest,
  targetDir: string,
  deps: CreateSkillDeps = {}
): Promise<SkillCreationOutcome> {
  const notes: string[] = [];
  const files: string[] = [];
  const safeRequest = { ...request, description: redactEvidence(request.description) };

  const serialize = deps.serializeInstall ?? (<T,>(fn: () => Promise<T>) => fn());

  try {
    if (request.mode === "per-agent") {
      // Parallel legs: staging roots isolate them, and one agent's failure
      // (e.g. its copy already exists) must not stop the other's run.
      const legs = await Promise.all(
        request.agents.map(async (agent) => {
          try {
            const validated = await authorSkill({
              agent,
              description: safeRequest.description,
              targetDir,
              finalRoot: nativeSkillRoots[agent],
              model: request.model,
              nameOverride: request.nameOverride,
              deps
            });
            return { agent, validated };
          } catch (error) {
            return { agent, error: error instanceof Error ? error.message : String(error) };
          }
        })
      );

      const succeeded = legs.filter((leg) => leg.validated);
      const failed = legs.filter((leg) => leg.error);

      for (const leg of succeeded) {
        files.push(...leg.validated!.files);
        notes.push(...leg.validated!.notes);
      }

      const names = new Set(succeeded.map((leg) => leg.validated!.name));

      if (names.size > 1) {
        notes.push(`The copies chose different names: ${Array.from(names).join(", ")}.`);
      }

      if (request.agents.length > 1) {
        notes.push("Per-agent copies were authored independently and may diverge; they are not tracked in skills-lock.json.");
      }

      return {
        request: safeRequest,
        name: succeeded[0]?.validated!.name,
        files,
        installed: false,
        notes,
        error:
          failed.length > 0
            ? failed.map((leg) => `${leg.agent}: ${leg.error}`).join(" | ") +
              (succeeded.length > 0 ? ` (${succeeded.map((leg) => leg.agent).join(", ")} copy succeeded)` : "")
            : undefined
      };
    }

    const authoringAgent: CreateAgent = request.mode === "author-claude" ? "claude" : "codex";
    const validated = await authorSkill({
      agent: authoringAgent,
      description: safeRequest.description,
      targetDir,
      finalRoot: canonicalSkillRoot,
      model: request.model,
      nameOverride: request.nameOverride,
      deps
    });

    files.push(...validated.files);
    notes.push(...validated.notes);

    if (deps.install === false) {
      notes.push(`Skipped install; run: skills add ./${canonicalSkillRoot} -s ${validated.name} -a ${request.agents.map((agent) => skillsCliAgentIds[agent]).join(" ")} -y`);
      return { request: safeRequest, name: validated.name, files, installed: false, notes };
    }

    throwIfCancelled(deps.signal);
    deps.progress?.("installing", authoringAgent);
    const install = await serialize(() =>
      installLocalSkill(validated.name, targetDir, request.agents, deps.skillsRunner, deps.resolveDeps)
    );

    if (!install.ok) {
      return {
        request: safeRequest,
        name: validated.name,
        files,
        installed: false,
        notes,
        error: `Skill authored at ${canonicalSkillRoot}/${validated.name}/ but install failed: ${install.error ?? install.stderr}. Retry: skills add ./${canonicalSkillRoot} -s ${validated.name} -a ${request.agents.map((agent) => skillsCliAgentIds[agent]).join(" ")} -y`
      };
    }

    if (await serialize(() => recordSkillInManifest(targetDir, `./${canonicalSkillRoot}@${validated.name}`))) {
      notes.push("Recorded in .farrier.json skills.");
    }

    return { request: safeRequest, name: validated.name, files, installed: true, notes };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { request: safeRequest, name: undefined, files, installed: false, notes, error: message };
  }
}

export type SkillCreationProgressEvent =
  | { index: number; phase: SkillCreationPhase; agent?: CreateAgent; activity?: string }
  | { index: number; phase: "done"; outcome: SkillCreationOutcome };

const AUTHOR_CONCURRENCY = 3;

/**
 * Runs a batch of creation requests concurrently (each authoring run has its
 * own staging root, so runs can't cross-contaminate), while lock-touching
 * steps — creator pinning up front, `skills add` + manifest writes via a
 * shared mutex — stay sequential, because the skills CLI's lockfile writes
 * are unlocked read-modify-write.
 */
export async function createSkills(
  requests: SkillCreationRequest[],
  targetDir: string,
  deps: CreateSkillDeps = {},
  onProgress?: (event: SkillCreationProgressEvent) => void
): Promise<SkillCreationOutcome[]> {
  const creatorAgents = new Set<CreateAgent>(
    requests.flatMap((request) =>
      request.mode === "per-agent" ? request.agents : [request.mode === "author-claude" ? "claude" : "codex"]
    )
  );

  for (const agent of creatorAgents) {
    await ensureCreatorInstalled(agent, targetDir, deps.skillsRunner, deps.resolveDeps);
  }

  let installChain: Promise<unknown> = Promise.resolve();
  const serializeInstall = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = installChain.then(fn, fn);
    installChain = next.catch(() => undefined);
    return next;
  };

  return Effect.runPromise(
    Effect.forEach(
      requests.map((request, index) => ({ request, index })),
      ({ request, index }) =>
        Effect.promise(async () => {
          if (deps.signal?.aborted) {
            const outcome: SkillCreationOutcome = { request, files: [], installed: false, notes: [], error: "cancelled before start" };
            onProgress?.({ index, phase: "done", outcome });
            return outcome;
          }

          const outcome = await createSkill(request, targetDir, {
            ...deps,
            serializeInstall,
            progress: (phase, agent, activity) => onProgress?.({ index, phase, agent, activity })
          });

          onProgress?.({ index, phase: "done", outcome });
          return outcome;
        }),
      { concurrency: AUTHOR_CONCURRENCY }
    )
  );
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/backend.ts
```ts
import { homedir } from "node:os";
import { join } from "node:path";
import type { ReasoningEffort } from "../config/farrier-config";

export type AgentBackend = "claude" | "codex";

const backendEnvironmentNames: Record<AgentBackend, readonly string[]> = {
  codex: ["OPENAI_API_KEY", "CODEX_HOME"],
  claude: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]
};

/** Explicit authentication/config passthrough for an isolated backend process. */
export function backendEnvironmentPassthrough(backend: AgentBackend): readonly string[] {
  return backendEnvironmentNames[backend];
}

/** Preserve the backend's standard login config without exposing the ambient HOME. */
export function backendEnvironmentOverrides(backend: AgentBackend): Readonly<Record<string, string>> {
  const home = homedir();
  return backend === "codex"
    ? { CODEX_HOME: process.env.CODEX_HOME ?? join(home, ".codex") }
    : { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude") };
}

export type BackendCommandRunnerInput = {
  cmd: string[];
  cwd: string;
  stdin?: string;
  /** Aborting kills the spawned agent process. */
  signal?: AbortSignal;
  /** Called with each stdout line as it arrives; stdout is still returned in full. */
  onStdoutLine?: (line: string) => void;
  /** Explicit scrubbed environment for isolated external execution. */
  env?: Record<string, string>;
};

export type BackendCommandRunnerOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type BackendCommandRunner = (input: BackendCommandRunnerInput) => Promise<BackendCommandRunnerOutput>;

export type DetectBackendDeps = {
  which: (bin: string) => string | null;
};

const defaultDetectDeps: DetectBackendDeps = {
  which: (bin) => Bun.which(bin)
};

export function detectAgentBackend(deps: Partial<DetectBackendDeps> = {}): AgentBackend | undefined {
  const which = deps.which ?? defaultDetectDeps.which;

  if (which("claude")) {
    return "claude";
  }

  if (which("codex")) {
    return "codex";
  }

  return undefined;
}

export type AgentAvailability = Record<AgentBackend, boolean>;

export async function probeAgent(backend: AgentBackend, runner: BackendCommandRunner = defaultBackendRunner): Promise<boolean> {
  try {
    const output = await runner({ cmd: [backend, "--version"], cwd: process.cwd() });
    return output.exitCode === 0;
  } catch {
    return false;
  }
}

export async function probeAgents(runner: BackendCommandRunner = defaultBackendRunner): Promise<AgentAvailability> {
  const [claude, codex] = await Promise.all([probeAgent("claude", runner), probeAgent("codex", runner)]);
  return { claude, codex };
}

export type BackendCommandOptions = {
  write?: boolean;
  /** Avoid recording an internal helper run as a project session. */
  ephemeral?: boolean;
  /**
   * Emit machine-readable per-event stdout (claude stream-json NDJSON, codex
   * --json JSONL) so callers can surface live activity. The final answer is no
   * longer plain text on stdout, so this is for runs whose result is read from
   * the filesystem, not parsed from stdout.
   */
  stream?: boolean;
  /** codex-only reasoning effort; ignored by the claude branch. */
  reasoningEffort?: ReasoningEffort;
};

export function backendCommand(
  backend: AgentBackend,
  model: string | undefined,
  prompt: string,
  options: BackendCommandOptions = {}
): { cmd: string[]; stdin?: string } {
  if (backend === "claude") {
    const permissionArgs = options.write
      ? ["--permission-mode", "acceptEdits", "--allowedTools", "Write", "Edit", "Bash"]
      : [];
    // stream-json in -p mode requires --verbose.
    const streamArgs = options.stream ? ["--output-format", "stream-json", "--verbose"] : [];
    const ephemeralArgs = options.ephemeral ? ["--no-session-persistence"] : [];

    return {
      cmd: ["claude", "-p", "--model", model ?? "sonnet", ...ephemeralArgs, ...permissionArgs, ...streamArgs],
      stdin: prompt
    };
  }

  const sandbox = options.write ? "workspace-write" : "read-only";
  const streamArgs = options.stream ? ["--json"] : [];
  const effortArgs = options.reasoningEffort ? ["-c", `model_reasoning_effort=${options.reasoningEffort}`] : [];
  const ephemeralArgs = options.ephemeral ? ["--ephemeral"] : [];

  // No default codex model: an explicit --model for a model the account lacks
  // fails silently, while omitting the flag uses the account's default.
  // No approval flag: `codex exec` is non-interactive and rejects `-a`.
  // Catalog off: farrier prompts name any skill they need explicitly
  // ($skill-creator), and codex resolves explicit mentions even without the
  // available-skills catalog. Including the catalog would spend context on the
  // user's whole global skill/plugin set and emit "skills context budget"
  // warnings into the run. Unknown -c keys are ignored by older codex builds.
  return {
    cmd: [
      "codex",
      "exec",
      ...ephemeralArgs,
      ...streamArgs,
      ...(model ? ["--model", model] : []),
      "-s",
      sandbox,
      "-c",
      "skills.include_instructions=false",
      ...effortArgs,
      prompt
    ],
    stdin: undefined
  };
}

export async function defaultBackendRunner(input: BackendCommandRunnerInput): Promise<BackendCommandRunnerOutput> {
  if (input.signal?.aborted) {
    return { exitCode: 130, stdout: "", stderr: "cancelled before start" };
  }

  const proc = Bun.spawn({
    cmd: input.cmd,
    cwd: input.cwd,
    stdin: input.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // Agent CLIs may spawn shells and helpers. A dedicated process group lets
    // cancellation terminate the complete run instead of only its root PID.
    detached: true,
    env: input.env
  });

  const onAbort = () => {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill();
    }
    const forceKillTimer = setTimeout(() => {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // The process group already exited.
      }
    }, 500);
    forceKillTimer.unref?.();
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  if (input.stdin !== undefined) {
    const stdin = proc.stdin as unknown as { write(data: string): unknown; end(): unknown } | undefined;
    stdin?.write(input.stdin);
    stdin?.end();
  }

  const readStdout = async (): Promise<string> => {
    if (!proc.stdout) {
      return "";
    }

    if (!input.onStdoutLine) {
      return new Response(proc.stdout).text();
    }

    // Line-buffered incremental read so callers can show live activity.
    const decoder = new TextDecoder();
    let full = "";
    let pending = "";

    for await (const chunk of proc.stdout) {
      const text = decoder.decode(chunk, { stream: true });
      full += text;
      pending += text;

      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);

        if (line.trim() !== "") {
          try {
            input.onStdoutLine(line);
          } catch {
            // Progress display failures must not kill the run.
          }
        }

        newline = pending.indexOf("\n");
      }
    }

    return full + decoder.decode();
  };

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    readStdout(),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("")
  ]);

  input.signal?.removeEventListener("abort", onAbort);

  return { exitCode, stdout, stderr };
}

function shortPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(-2).join("/");
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

// codex wraps every exec in a login shell; the wrapper is noise.
function stripShellWrapper(command: string): string {
  const match = command.match(/^\/bin\/\w+ -lc '([\s\S]*)'$/);
  return match ? match[1]! : command;
}

function claudeToolActivity(name: string, input: Record<string, unknown>): string {
  if (name === "Bash" && typeof input.command === "string") {
    return `$ ${firstLine(input.command)}`;
  }

  if ((name === "Write" || name === "Edit") && typeof input.file_path === "string") {
    return `${name} ${shortPath(input.file_path)}`;
  }

  if (name === "Read" && typeof input.file_path === "string") {
    return `Read ${shortPath(input.file_path)}`;
  }

  if (name === "Skill" && typeof input.skill === "string") {
    return `Skill ${input.skill}`;
  }

  return name;
}

/**
 * Maps one line of streaming backend stdout (claude `--output-format
 * stream-json`, codex `--json`) to a short human-readable activity string, or
 * undefined for lines not worth surfacing (thinking deltas, tool results,
 * usage events, non-JSON noise).
 */
export function formatBackendStreamActivity(backend: AgentBackend, line: string): string | undefined {
  let event: Record<string, unknown>;

  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  if (backend === "claude") {
    if (event.type !== "assistant") {
      return undefined;
    }

    const message = event.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? (message.content as Record<string, unknown>[]) : [];

    for (const block of content) {
      if (block.type === "tool_use" && typeof block.name === "string") {
        return claudeToolActivity(block.name, (block.input ?? {}) as Record<string, unknown>);
      }

      if (block.type === "text" && typeof block.text === "string" && firstLine(block.text) !== "") {
        return firstLine(block.text);
      }
    }

    return undefined;
  }

  if (event.type !== "item.started" && event.type !== "item.completed") {
    return undefined;
  }

  const item = (event.item ?? {}) as Record<string, unknown>;

  // command_execution appears at both started and completed; show it once.
  if (item.type === "command_execution" && event.type === "item.started" && typeof item.command === "string") {
    return `$ ${firstLine(stripShellWrapper(item.command))}`;
  }

  if (event.type !== "item.completed") {
    return undefined;
  }

  if ((item.type === "agent_message" || item.type === "reasoning") && typeof item.text === "string") {
    const text = firstLine(item.text);
    return text === "" ? undefined : text;
  }

  if (item.type === "file_change" && Array.isArray(item.changes)) {
    const paths = (item.changes as Record<string, unknown>[])
      .map((change) => (typeof change.path === "string" ? shortPath(change.path) : undefined))
      .filter((path): path is string => path !== undefined);
    return paths.length > 0 ? `Edit ${paths.join(", ")}` : undefined;
  }

  if (item.type === "error" && typeof item.message === "string") {
    return firstLine(item.message);
  }

  return undefined;
}

export function parseBackendJson(stdout: string): unknown {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error("returned empty stdout");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error("did not return JSON");
  }
}

export async function invokeBackend(input: {
  backend: AgentBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  prompt: string;
  targetDir: string;
  runner: BackendCommandRunner;
  signal?: AbortSignal;
  ephemeral?: boolean;
  env?: Record<string, string>;
}): Promise<unknown> {
  const command = backendCommand(input.backend, input.model, input.prompt, {
    reasoningEffort: input.reasoningEffort,
    ephemeral: input.ephemeral
  });

  const output = await input.runner({
    cmd: command.cmd,
    cwd: input.targetDir,
    stdin: command.stdin,
    signal: input.signal,
    env: input.env
  });

  if (output.exitCode !== 0) {
    const stderr = output.stderr.trim();
    throw new Error(`${input.backend} backend exited with code ${output.exitCode}${stderr ? `: ${stderr}` : ""}`);
  }

  try {
    return parseBackendJson(output.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${input.backend} backend ${message}`);
  }
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/cli/skill-eval.ts
```ts
import { resolve } from "node:path";
import { loadFarrierConfig, resolveModelSettings } from "../config/farrier-config";
import { detectAgentBackend, type AgentBackend } from "../engine/backend";
import {
  evaluatePerAgentSkill,
  resolvePerAgentSkillWinner,
  type SkillEvalVerdict,
  type SkillWinnerResolution
} from "../engine/eval-skill";
import type { CreateAgent } from "../engine/create-skill";

export type SkillEvalCliOptions = {
  skillName?: string;
  claudeName?: string;
  codexName?: string;
  dir: string;
  backend?: AgentBackend;
  model?: string;
  description?: string;
  applyWinner?: CreateAgent | "recommended";
  deleteLoserAndLink: boolean;
  json: boolean;
  help: boolean;
};

function usage(): string {
  return `farrier skill eval — compare per-agent skill copies and optionally pick a winner

Usage:
  farrier skill eval <skill-name> [--dir <target>] [--backend claude|codex] [--description <text>] [--json]
  farrier skill eval <skill-name> --apply-winner claude|codex|recommended --delete-loser-and-link [--dir <target>]
  farrier skill eval <skill-name> --claude-name <name> --codex-name <name>   # copies that chose different names

By default this is read-only: the copies are staged at neutral paths and judged blind,
twice with the candidates swapped, using the pinned Anthropic skill-creator eval guidance;
a winner is only recommended when both passes agree. Per-copy reports are written under
.farrier-staging/eval/<name>/. When the copies chose different directory names, pass
--claude-name/--codex-name (each defaults to <skill-name>); picking a winner then links
the loser's root under the winner's name. It deletes and symlinks only when both
--apply-winner and --delete-loser-and-link are present. --apply-winner recommended applies
the verdict's own pick — it keeps the deleted copy in .farrier-staging/trash/ so you can
change your mind, and keeps both copies (exit 0) when the verdict is a tie.`;
}

function parseBackend(value: string): AgentBackend {
  if (value === "claude" || value === "codex") {
    return value;
  }

  throw new Error("--backend must be claude or codex");
}

function parseWinner(value: string): CreateAgent | "recommended" {
  if (value === "claude" || value === "codex" || value === "recommended") {
    return value;
  }

  throw new Error("--apply-winner must be claude, codex, or recommended");
}

export function parseSkillEvalArgs(args: string[]): SkillEvalCliOptions {
  const options: SkillEvalCliOptions = {
    dir: process.cwd(),
    deleteLoserAndLink: false,
    json: false,
    help: false
  };

  const takesValue: Array<{ flag: string; set: (value: string) => void }> = [
    { flag: "--dir", set: (value) => (options.dir = value) },
    { flag: "--backend", set: (value) => (options.backend = parseBackend(value)) },
    { flag: "--model", set: (value) => (options.model = value) },
    { flag: "--description", set: (value) => (options.description = value) },
    { flag: "--apply-winner", set: (value) => (options.applyWinner = parseWinner(value)) },
    { flag: "--claude-name", set: (value) => (options.claudeName = value) },
    { flag: "--codex-name", set: (value) => (options.codexName = value) }
  ];

  const booleans: Record<string, () => void> = {
    "--help": () => (options.help = true),
    "-h": () => (options.help = true),
    "--json": () => (options.json = true),
    "--delete-loser-and-link": () => (options.deleteLoserAndLink = true)
  };

  outer: for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const setBoolean = booleans[arg];

    if (setBoolean) {
      setBoolean();
      continue;
    }

    for (const { flag, set } of takesValue) {
      if (arg === flag) {
        const value = args[i + 1];
        if (!value || value.startsWith("--")) {
          throw new Error(`${flag} requires a value`);
        }
        set(value);
        i += 1;
        continue outer;
      }

      if (arg.startsWith(`${flag}=`)) {
        set(arg.slice(flag.length + 1));
        continue outer;
      }
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown skill eval argument: ${arg}`);
    }

    if (options.skillName !== undefined) {
      throw new Error("skill eval takes a single skill name");
    }

    options.skillName = arg;
  }

  return options;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printVerdict(verdict: SkillEvalVerdict): void {
  console.log(`Recommendation: ${verdict.recommendedWinner}`);
  console.log(verdict.rationale);
  console.log("");
  for (const agent of ["claude", "codex"] as const) {
    const copy = verdict.copies[agent];
    console.log(`${agent} (${copy.score}/10): ${copy.rationale}`);
    console.log(`  path: ${copy.path}`);
    console.log(`  strengths: ${copy.strengths.join("; ") || "none"}`);
    console.log(`  weaknesses: ${copy.weaknesses.join("; ") || "none"}`);
  }
  for (const note of verdict.notes) {
    console.log(`- ${note}`);
  }
  if (verdict.reportPaths) {
    console.log(`Reports: ${verdict.reportPaths.claude} · ${verdict.reportPaths.codex}`);
  }
}

function printResolution(resolution: SkillWinnerResolution): void {
  for (const deleted of resolution.deleted) {
    console.log(`Deleted ${deleted}`);
  }
  for (const link of resolution.links) {
    console.log(`Linked ${link.path} -> ${link.target}`);
  }
  if (resolution.backupPath) {
    console.log(`Deleted copy kept at ${resolution.backupPath}`);
  }
}

export async function runSkillEval(args: string[]): Promise<number> {
  let options: SkillEvalCliOptions;

  try {
    options = parseSkillEvalArgs(args);
  } catch (error) {
    console.error(`farrier skill eval: ${errorMessage(error)}`);
    return 1;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  if (!options.skillName || options.skillName.trim().length === 0) {
    console.error("farrier skill eval: a skill name is required. Usage: farrier skill eval <skill-name> [--help]");
    return 1;
  }

  if (options.applyWinner && !options.deleteLoserAndLink) {
    console.error("farrier skill eval: --apply-winner requires --delete-loser-and-link to delete and symlink.");
    return 1;
  }

  try {
    const targetDir = resolve(options.dir);
    const backend = options.backend ?? detectAgentBackend();

    if (!backend) {
      console.error("farrier skill eval: no backend CLI found. Install claude or codex, or pass --backend.");
      return 1;
    }

    const names = {
      claude: options.claudeName ?? options.skillName,
      codex: options.codexName ?? options.skillName
    };

    const models = await loadFarrierConfig({ projectDir: targetDir })
      .then((loaded) => loaded.config.models)
      .catch(() => ({}));
    const evalSettings = resolveModelSettings({ models, backend, role: "eval", explicitModel: options.model });

    const verdict = await evaluatePerAgentSkill({
      targetDir,
      skillName: options.skillName,
      names,
      description: options.description,
      backend,
      model: evalSettings.model,
      reasoningEffort: evalSettings.reasoningEffort
    });

    let resolution: SkillWinnerResolution | undefined;
    let tieKeptBoth = false;

    if (options.applyWinner === "recommended" && verdict.recommendedWinner === "tie") {
      tieKeptBoth = true;
    } else if (options.applyWinner) {
      resolution = await resolvePerAgentSkillWinner({
        targetDir,
        skillName: options.skillName,
        names,
        winner: options.applyWinner === "recommended" ? (verdict.recommendedWinner as CreateAgent) : options.applyWinner,
        confirmDeleteAndLink: options.deleteLoserAndLink,
        // Consent for "recommended" was given before the verdict existed, so
        // the deleted copy is kept recoverable; an explicit pick deletes clean.
        retainBackupInTrash: options.applyWinner === "recommended"
      });
    }

    if (options.json) {
      console.log(JSON.stringify({ verdict, resolution, tieKeptBoth: tieKeptBoth || undefined }, null, 2));
    } else {
      printVerdict(verdict);
      if (tieKeptBoth) {
        console.log("");
        console.log("Verdict is a tie — kept both copies, nothing deleted.");
      }
      if (resolution) {
        console.log("");
        printResolution(resolution);
      }
    }

    return 0;
  } catch (error) {
    console.error(`farrier skill eval: ${errorMessage(error)}`);
    return 1;
  }
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/mutation-transaction.ts
```ts
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { cp, lstat, mkdir, open, readdir, readlink, realpath, rename, rm, rmdir, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import {
  assertStableDirectoryChain,
  commitStagedCreation,
  commitStagedReplacement,
  directoryIdentity,
  stageFile,
  type DirectoryIdentity,
} from "./create-plan-fs";

export type PathFingerprint =
  | { kind: "absent" }
  | { kind: "file"; dev: string; ino: string; size: string; mtimeNs: string; mode: number; sha256: string }
  | { kind: "tree"; dev: string; ino: string; mode: number; sha256: string }
  | { kind: "link"; dev: string; ino: string; target: string };

export type MutationOperation =
  | { kind: "write-file"; path: string; content: string | Buffer; mode?: number }
  | { kind: "replace-tree"; path: string; sourcePath: string }
  | { kind: "remove-tree"; path: string }
  | { kind: "link"; path: string; target: string };

type ReviewedLinkTarget = {
  path: string; expected: PathFingerprint; realPath: string; realExpected: PathFingerprint;
};

export type InspectedMutationOperation = MutationOperation & {
  expected: PathFingerprint; sourceExpected?: PathFingerprint; linkTarget?: ReviewedLinkTarget;
};

export type MutationPlan = { targetDir: string; operations: InspectedMutationOperation[] };

export type MutationResult = { written: string[]; unchanged: string[]; backupDir: string | null };

export type MutationApplyDeps = {
  beforeCommit?: (input: { operation: InspectedMutationOperation; index: number }) => void | Promise<void>;
  beforeBackup?: (input: { operation: InspectedMutationOperation; index: number }) => void | Promise<void>;
  afterBackup?: (input: { operation: InspectedMutationOperation; index: number }) => void | Promise<void>;
  afterCommit?: (input: { operation: InspectedMutationOperation; index: number }) => void | Promise<void>;
  backupBase?: string;
  retainBackupsOnSuccess?: boolean;
};

type Applied = {
  operation: InspectedMutationOperation; output?: PathFingerprint; backupPath?: string; absolutePath: string;
};

type CreatedDirectory = { path: string; identity: DirectoryIdentity };

export class MutationTransactionError extends Error {
  readonly mutationState: "rolled-back" | "rollback-incomplete";
  readonly recoveryPath: string | null;

  constructor(message: string, state: "rolled-back" | "rollback-incomplete", recoveryPath: string | null, cause: unknown) {
    super(recoveryPath ? `${message}; recovery material retained at ${recoveryPath}` : message, { cause });
    this.name = "MutationTransactionError";
    this.mutationState = state;
    this.recoveryPath = recoveryPath;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

function safeRelativePath(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some((part) => part === ".." || part === "")) {
    throw new Error(`Mutation path must be a normalized relative path: ${path}`);
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function absoluteInside(root: string, path: string): string {
  safeRelativePath(path);
  const absolute = resolve(root, path);
  if (!inside(root, absolute)) throw new Error(`Mutation path escaped target: ${path}`);
  return absolute;
}

function hash(parts: Array<string | Buffer>): string {
  const digest = createHash("sha256");
  for (const part of parts) digest.update(part);
  return digest.digest("hex");
}

async function fingerprintTree(path: string): Promise<string> {
  const parts: Array<string | Buffer> = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(current, entry.name);
      const stats = await lstat(absolute, { bigint: true });
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        throw new Error(`Tree contains unsupported ${stats.isSymbolicLink() ? "symbolic link" : "special file"}: ${relativePath}`);
      }
      parts.push(`${entry.isDirectory() ? "d" : "f"}\0${relativePath}\0${Number(stats.mode & 0o7777n)}\0`);
      if (entry.isDirectory()) {
        await walk(absolute, relativePath);
      } else {
        const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const content = await handle.readFile();
          const after = await handle.stat({ bigint: true });
          if (after.dev !== stats.dev || after.ino !== stats.ino || after.size !== stats.size || after.mtimeNs !== stats.mtimeNs) {
            throw new Error(`${absolute} changed while its tree was inspected`);
          }
          parts.push(content);
        } finally {
          await handle.close();
        }
      }
    }
  };
  await walk(path, "");
  return hash(parts);
}

export async function fingerprintPath(path: string): Promise<PathFingerprint> {
  let stats;
  try {
    stats = await lstat(path, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { kind: "absent" };
    throw error;
  }
  const identity = { dev: stats.dev.toString(), ino: stats.ino.toString() };
  if (stats.isSymbolicLink()) return { kind: "link", ...identity, target: await readlink(path) };
  if (stats.isFile()) {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const content = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (after.dev !== stats.dev || after.ino !== stats.ino || after.mtimeNs !== stats.mtimeNs || after.size !== stats.size) {
        throw new Error(`${path} changed while it was inspected`);
      }
      return {
        kind: "file", ...identity, size: stats.size.toString(), mtimeNs: stats.mtimeNs.toString(),
        mode: Number(stats.mode & 0o7777n), sha256: hash([content]),
      };
    } finally {
      await handle.close();
    }
  }
  if (stats.isDirectory()) {
    return { kind: "tree", ...identity, mode: Number(stats.mode & 0o7777n), sha256: await fingerprintTree(path) };
  }
  throw new Error(`${path} is a special file and cannot be mutated`);
}

function sameFingerprint(left: PathFingerprint, right: PathFingerprint): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameTreeContent(left: PathFingerprint, right: PathFingerprint): boolean {
  return left.kind === "tree" && right.kind === "tree" && left.mode === right.mode && left.sha256 === right.sha256;
}

async function inspectLinkTarget(root: string, absolute: string, target: string, operationPath: string): Promise<ReviewedLinkTarget> {
  const path = resolve(dirname(absolute), target);
  if (!inside(root, path)) throw new Error(`Reviewed link escapes target: ${operationPath}`);
  const expected = await fingerprintPath(path);
  if (expected.kind === "absent") throw new Error(`Reviewed link target is missing: ${operationPath}`);
  const realRoot = await realpath(root);
  const realPath = await realpath(path);
  if (!inside(realRoot, realPath)) throw new Error(`Reviewed link escapes target: ${operationPath}`);
  const realExpected = await fingerprintPath(realPath);
  if (realExpected.kind !== "tree") throw new Error(`Reviewed link target is not a regular tree: ${operationPath}`);
  return { path, expected, realPath, realExpected };
}

export async function inspectMutationPlan(targetDir: string, operations: MutationOperation[]): Promise<MutationPlan> {
  const root = resolve(targetDir);
  const seen = new Set<string>();
  const inspected: InspectedMutationOperation[] = [];
  for (const operation of operations) {
    const absolute = absoluteInside(root, operation.path);
    if (seen.has(absolute)) throw new Error(`Mutation plan contains duplicate path: ${operation.path}`);
    seen.add(absolute);
    const expected = await fingerprintPath(absolute);
    if (operation.kind === "replace-tree") {
      const sourceExpected = await fingerprintPath(operation.sourcePath);
      if (sourceExpected.kind !== "tree") throw new Error(`Replacement source is not a regular tree: ${operation.sourcePath}`);
      inspected.push({ ...operation, expected, sourceExpected });
      continue;
    }
    if (operation.kind === "remove-tree") {
      if (expected.kind !== "tree") throw new Error(`Removal target is not a regular tree: ${operation.path}`);
    }
    if (operation.kind === "link") {
      inspected.push({ ...operation, expected, linkTarget: await inspectLinkTarget(root, absolute, operation.target, operation.path) });
      continue;
    }
    inspected.push({ ...operation, expected });
  }
  return { targetDir: root, operations: inspected };
}

async function ensureRoot(root: string, created: Map<string, CreatedDirectory>): Promise<DirectoryIdentity> {
  const missing: string[] = [];
  let current = root;
  while (true) {
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${current} is not a regular directory`);
      break;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      missing.push(current);
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  await mkdir(root, { recursive: true });
  for (const path of [...missing].reverse()) created.set(path, { path, identity: await directoryIdentity(path) });
  return directoryIdentity(root);
}

async function ensureParents(
  root: string,
  rootIdentity: DirectoryIdentity,
  absolute: string,
  created: Map<string, CreatedDirectory>,
): Promise<void> {
  const rel = relative(root, dirname(absolute));
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Unsafe mutation parent: ${relative(root, current)}`);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      try {
        await mkdir(current);
        created.set(current, { path: current, identity: await directoryIdentity(current) });
      } catch (mkdirError) {
        if (errorCode(mkdirError) !== "EEXIST") throw mkdirError;
        const raced = await lstat(current);
        if (raced.isSymbolicLink() || !raced.isDirectory()) throw new Error(`Unsafe raced mutation parent: ${relative(root, current)}`);
      }
    }
  }
  await assertStableDirectoryChain(root, rootIdentity, dirname(absolute));
}

async function validateSource(operation: InspectedMutationOperation): Promise<void> {
  if (operation.kind !== "replace-tree" || !operation.sourceExpected) return;
  if (!sameFingerprint(await fingerprintPath(operation.sourcePath), operation.sourceExpected)) {
    throw new Error(`Replacement source changed after review: ${operation.path}`);
  }
}

async function validateLinkTarget(root: string, operation: InspectedMutationOperation): Promise<void> {
  if (operation.kind !== "link" || !operation.linkTarget) return;
  const reviewed = operation.linkTarget;
  if (!sameFingerprint(await fingerprintPath(reviewed.path), reviewed.expected)) {
    throw new Error(`Link target changed after review: ${operation.path}`);
  }
  const realRoot = await realpath(root);
  const currentReal = await realpath(reviewed.path);
  if (!inside(realRoot, currentReal) || currentReal !== reviewed.realPath) {
    throw new Error(`Link target changed or escaped after review: ${operation.path}`);
  }
  if (!sameFingerprint(await fingerprintPath(currentReal), reviewed.realExpected)) {
    throw new Error(`Resolved link target changed after review: ${operation.path}`);
  }
}

async function stageTree(operation: InspectedMutationOperation, destination: string): Promise<PathFingerprint> {
  if (operation.kind !== "replace-tree" || !operation.sourceExpected) throw new Error("missing reviewed replacement source");
  await validateSource(operation);
  await cp(operation.sourcePath, destination, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  await validateSource(operation);
  const staged = await fingerprintPath(destination);
  if (!sameTreeContent(staged, operation.sourceExpected)) throw new Error(`Replacement source changed while staging: ${operation.path}`);
  return staged;
}

async function removeUnchanged(path: string, expected: PathFingerprint): Promise<void> {
  const current = await fingerprintPath(path);
  if (!sameFingerprint(current, expected)) throw new Error(`${path} changed after Farrier committed it`);
  await rm(path, { recursive: current.kind === "tree" || current.kind === "link", force: true });
}

async function rollback(applied: Applied[]): Promise<string[]> {
  const failures: string[] = [];
  for (const change of [...applied].reverse()) {
    try {
      if (change.output) {
        await removeUnchanged(change.absolutePath, change.output);
      } else {
        const current = await fingerprintPath(change.absolutePath);
        if (current.kind !== "absent") throw new Error(`${change.absolutePath} has unverified output; original retained in recovery backup`);
      }
      if (change.backupPath) await rename(change.backupPath, change.absolutePath);
    } catch (error) {
      failures.push(`${change.operation.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

async function removeBackupRootIfOwned(
  backupRoot: string,
  created: Map<string, CreatedDirectory>,
): Promise<boolean> {
  const owned = created.get(backupRoot);
  if (!owned) return false;
  try {
    const current = await directoryIdentity(backupRoot);
    if (current.dev !== owned.identity.dev || current.ino !== owned.identity.ino) return false;
    await rm(backupRoot, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function cleanupCreatedDirectories(created: Map<string, CreatedDirectory>, failures: string[]): Promise<void> {
  const ordered = [...created.values()].sort((left, right) => right.path.length - left.path.length);
  for (const entry of ordered) {
    try {
      const current = await directoryIdentity(entry.path);
      if (current.dev !== entry.identity.dev || current.ino !== entry.identity.ino) throw new Error("directory identity changed");
      if ((await readdir(entry.path)).length === 0) await rmdir(entry.path);
    } catch (error) {
      if (errorCode(error) !== "ENOENT" && error instanceof Error && error.message === "directory identity changed") {
        failures.push(`${entry.path}: ${error.message}`);
      }
    }
  }
}

export async function applyMutationPlan(plan: MutationPlan, deps: MutationApplyDeps = {}): Promise<MutationResult> {
  const root = resolve(plan.targetDir);
  const transactionId = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const backupRelative = deps.backupBase ?? join(".farrier-staging", "transactions", transactionId);
  safeRelativePath(backupRelative);
  if (backupRelative === "." || normalize(backupRelative) !== backupRelative) {
    throw new Error(`Backup path must be a normalized relative path: ${backupRelative}`);
  }
  const backupRoot = absoluteInside(root, backupRelative);
  for (const operation of plan.operations) {
    const target = absoluteInside(root, operation.path);
    if (inside(backupRoot, target) || inside(target, backupRoot)) {
      throw new Error(`Backup path overlaps mutation target: ${operation.path}`);
    }
  }
  const retainBackups = deps.retainBackupsOnSuccess ?? true;
  const applied: Applied[] = [];
  const written: string[] = [];
  const unchanged: string[] = [];
  const createdDirectories = new Map<string, CreatedDirectory>();
  const backupDirectories = new Map<string, CreatedDirectory>();
  const stagedArtifacts = new Set<string>();
  let hasBackup = false;
  let ownsBackupRoot = false;

  try {
    const rootIdentity = await ensureRoot(root, createdDirectories);
    try {
      await lstat(backupRoot);
      throw new Error(`Backup path already exists: ${backupRelative}`);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    await ensureParents(root, rootIdentity, join(backupRoot, ".farrier-owner"), backupDirectories);
    ownsBackupRoot = backupDirectories.has(backupRoot);
    if (!ownsBackupRoot) throw new Error(`Backup path was not created by this transaction: ${backupRelative}`);
    for (const [index, operation] of plan.operations.entries()) {
      const absolute = absoluteInside(root, operation.path);
      await ensureParents(root, rootIdentity, absolute, createdDirectories);
      const current = await fingerprintPath(absolute);
      if (!sameFingerprint(current, operation.expected)) throw new Error(`${operation.path} changed after review`);
      await validateSource(operation);
      await validateLinkTarget(root, operation);

      if (operation.kind === "write-file") {
        const content = typeof operation.content === "string" ? Buffer.from(operation.content) : operation.content;
        if (current.kind === "file" && current.sha256 === hash([content]) && (operation.mode === undefined || current.mode === operation.mode)) {
          unchanged.push(operation.path);
          continue;
        }
      }

      await deps.beforeCommit?.({ operation, index });
      await assertStableDirectoryChain(root, rootIdentity, dirname(absolute));
      if (!sameFingerprint(await fingerprintPath(absolute), operation.expected)) throw new Error(`${operation.path} changed before commit`);
      await validateSource(operation);
      await validateLinkTarget(root, operation);

      let staged: string | undefined;
      let stagedOutput: PathFingerprint | undefined;
      let stagedFile: Awaited<ReturnType<typeof stageFile>> | undefined;
      if (operation.kind === "write-file") {
        stagedFile = await stageFile(absolute, operation.content, operation.mode ?? (current.kind === "file" ? current.mode : undefined));
        stagedArtifacts.add(stagedFile.path);
        stagedOutput = await fingerprintPath(stagedFile.path);
      }
      if (operation.kind === "replace-tree") {
        staged = join(dirname(absolute), `.farrier-tree-${transactionId}-${index}`);
        stagedArtifacts.add(staged);
        stagedOutput = await stageTree(operation, staged);
      }

      let backupPath: string | undefined;
      await deps.beforeBackup?.({ operation, index });
      if (current.kind !== "absent") {
        backupPath = join(backupRoot, operation.path);
        const owned = backupDirectories.get(backupRoot);
        const currentBackupIdentity = await directoryIdentity(backupRoot);
        if (!owned || currentBackupIdentity.dev !== owned.identity.dev || currentBackupIdentity.ino !== owned.identity.ino) {
          throw new Error(`Transaction backup path changed before use: ${backupRelative}`);
        }
        await ensureParents(root, rootIdentity, backupPath, backupDirectories);
        await rename(absolute, backupPath);
        hasBackup = true;
      }
      const change: Applied = { operation, backupPath, absolutePath: absolute };
      applied.push(change);

      try {
        await deps.afterBackup?.({ operation, index });
        await validateSource(operation);
        await validateLinkTarget(root, operation);
        if (operation.kind === "write-file") {
          if (!stagedFile || !stagedOutput) throw new Error("missing staged file");
          if (current.kind === "absent") await commitStagedCreation(stagedFile, absolute);
          else await commitStagedReplacement(stagedFile, absolute);
          change.output = stagedOutput;
        } else if (operation.kind === "replace-tree") {
          if (!staged || !stagedOutput) throw new Error("missing staged tree");
          await rename(staged, absolute);
          change.output = stagedOutput;
        } else if (operation.kind === "link") {
          await symlink(operation.target, absolute, "dir");
          change.output = await fingerprintPath(absolute);
          const committedReal = await realpath(absolute);
          if (!operation.linkTarget || committedReal !== operation.linkTarget.realPath) {
            throw new Error(`Committed link does not resolve to reviewed target: ${operation.path}`);
          }
          await validateLinkTarget(root, operation);
        } else {
          change.output = { kind: "absent" };
        }
        written.push(operation.path);
        await deps.afterCommit?.({ operation, index });
      } finally {
        if (stagedFile) {
          await rm(stagedFile.path, { force: true }).catch(() => undefined);
          stagedArtifacts.delete(stagedFile.path);
        }
        if (staged) {
          await rm(staged, { recursive: true, force: true }).catch(() => undefined);
          stagedArtifacts.delete(staged);
        }
      }
    }
  } catch (error) {
    await Promise.all([...stagedArtifacts].map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined)));
    const failures = await rollback(applied);
    const incomplete = failures.length > 0;
    if (ownsBackupRoot && (!incomplete || !hasBackup)) {
      await removeBackupRootIfOwned(backupRoot, backupDirectories);
    }
    await cleanupCreatedDirectories(incomplete ? createdDirectories : new Map([...createdDirectories, ...backupDirectories]), failures);
    const rollbackIncomplete = failures.length > 0;
    const message = error instanceof Error ? error.message : String(error);
    throw new MutationTransactionError(
      rollbackIncomplete ? `${message}; rollback incomplete: ${failures.join("; ")}` : message,
      rollbackIncomplete ? "rollback-incomplete" : "rolled-back",
      rollbackIncomplete && hasBackup ? backupRelative : null,
      error,
    );
  }

  if (ownsBackupRoot && (!hasBackup || !retainBackups)) {
    if (!await removeBackupRootIfOwned(backupRoot, backupDirectories)) {
      throw new Error(`Transaction backup path changed before cleanup: ${backupRelative}`);
    }
    const failures: string[] = [];
    await cleanupCreatedDirectories(backupDirectories, failures);
    if (failures.length > 0) throw new Error(`Failed to clean transaction backup directories: ${failures.join("; ")}`);
  }
  return { written, unchanged, backupDir: hasBackup && retainBackups ? backupRelative : null };
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/tests/update.test.ts
```ts
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyUpdate, createUpdateReport, notFarrierProjectMessage } from "../src/engine/update";
import { createRenderPlan, writeRenderPlan } from "../src/engine/render";
import { resolvePack } from "../src/packs/index";
import { loadPackCatalog, type RegistryCatalogClient } from "../src/registry/catalog";
import type { RegistryFetchResult } from "../src/registry/client";
import type { RegistryIndex, RegistryIndexItem, RegistryItem } from "../src/registry/schema";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-update-"));
}

async function renderPack(dir: string, packId: string): Promise<void> {
  const pack = resolvePack(packId);
  const plan = await createRenderPlan({ targetDir: dir, pack });
  await writeRenderPlan(plan);
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function registryResult<T>(value: T, sha256: string): RegistryFetchResult<T> {
  return {
    value,
    raw: JSON.stringify(value),
    sha256,
    fromCache: false
  };
}

function remoteRegistryClient(input: {
  hookVersion: number;
  hookContent: string;
  hookSha: string;
  packSha: string;
}): RegistryCatalogClient {
  const index: RegistryIndex = {
    schemaVersion: 1,
    name: "@acme",
    items: [
      { name: "guard", type: "hook", version: `${input.hookVersion}.0.0` },
      { name: "demo", type: "pack", version: "1.0.0" }
    ]
  };
  const hook: RegistryItem = {
    schemaVersion: 1,
    type: "hook",
    name: "guard",
    version: `${input.hookVersion}.0.0`,
    hook: {
      hookVersion: input.hookVersion,
      events: [{ event: "PreToolUse", matcher: "Bash" }],
      entry: "guard.sh",
      runner: "bash",
      files: [{ path: "guard.sh", content: input.hookContent }]
    }
  };
  const pack: RegistryItem = {
    schemaVersion: 1,
    type: "pack",
    name: "demo",
    version: "1.0.0",
    pack: {
      extends: "generic",
      detect: {
        files: ["acme.toml"]
      },
      skills: [],
      hooks: ["@acme/guard"]
    }
  };

  return {
    async fetchRegistryIndex() {
      return registryResult(index, "index".padEnd(64, "0"));
    },
    async fetchRegistryItem(_namespace: string, _entry: string, item: RegistryIndexItem) {
      if (item.name === "guard") {
        return registryResult(hook, input.hookSha);
      }
      if (item.name === "demo") {
        return registryResult(pack, input.packSha);
      }
      throw new Error(`missing item ${item.name}`);
    }
  };
}

async function remoteCatalog(input: { hookVersion: number; hookContent: string; hookSha: string; packSha: string }) {
  return loadPackCatalog({
    config: {
      useDefaultPacks: true,
      registries: {
        "@acme": "https://registry.example/{name}.json"
      },
      models: {}
    },
    client: remoteRegistryClient(input)
  });
}

describe("update engine", () => {
  test("missing manifest errors as non-farrier project", async () => {
    const dir = await tempDir();

    await expect(createUpdateReport({ targetDir: dir })).rejects.toThrow(notFarrierProjectMessage);
  });

  test("reports stack drift but apply does not switch packs", async () => {
    const dir = await tempDir();
    await renderPack(dir, "python-uv");

    await writeFile(
      join(dir, "pyproject.toml"),
      `[project]
name = "example"
dependencies = ["fastapi>=0.110"]
`,
      "utf8"
    );

    const report = await createUpdateReport({ targetDir: dir });

    expect(report.currentPackId).toBe("python-uv");
    expect(report.currentPackIds).toEqual(["python-uv"]);
    expect(report.stackDrift.detectedPackIds).toEqual(["python-fastapi", "python-uv"]);
    expect(report.stackDrift.hasDrift).toBe(true);
    expect(report.stackDrift.suggestedPackId).toBe("python-fastapi");
    expect(report.stackDrift.message).toContain("will not switch packs automatically");

    const result = await applyUpdate({ targetDir: dir });
    expect(result.report.stackDrift.hasDrift).toBe(true);

    const manifest = await readJson(join(dir, ".farrier.json"));
    expect(manifest.packIds).toEqual(["python-uv"]);
  });

  test("reports and repairs missing files, owned drift, hook drift, and preserves user-mutable drift", async () => {
    const dir = await tempDir();
    await renderPack(dir, "python-fastapi");

    await unlink(join(dir, "CLAUDE.md"));
    await writeFile(join(dir, ".claude", "hooks", "test_secret_shield.py"), "# changed owned hook test\n", "utf8");
    await writeFile(join(dir, "AGENTS.md"), "# custom user instructions\n", "utf8");

    const manifestPath = join(dir, ".farrier.json");
    const manifest = await readJson(manifestPath);
    const versions = manifest.versions as { hooks: Record<string, number> };
    versions.hooks["secret-shield"] = 0;
    await writeJson(manifestPath, manifest);

    const report = await createUpdateReport({ targetDir: dir });

    expect(report.missingInventoryFiles).toContain("CLAUDE.md");
    expect(report.outdatedOwnedFiles).toContain(".claude/hooks/test_secret_shield.py");
    expect(report.outdatedUserFiles).toContain("AGENTS.md");
    expect(report.hookDrift).toContainEqual({
      hookId: "secret-shield",
      manifestVersion: 0,
      currentVersion: 4
    });
    expect(report.notes).toContain("Manual review required for outdated user-mutable files; update mode will not overwrite them.");

    const result = await applyUpdate({ targetDir: dir });

    expect(result.repairedFiles).toContain("CLAUDE.md");
    expect(result.repairedFiles).toContain(".claude/hooks/test_secret_shield.py");
    expect(result.repairedFiles).toContain(".farrier.json");
    expect(result.repairedFiles).not.toContain("AGENTS.md");

    expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# custom user instructions\n");
    expect(await readFile(join(dir, ".claude", "hooks", "test_secret_shield.py"), "utf8")).toContain("HOOK = Path(__file__).with_name");

    const repairedManifest = await readJson(manifestPath);
    const repairedVersions = repairedManifest.versions as { hooks: Record<string, number> };
    expect(repairedVersions.hooks["secret-shield"]).toBe(4);
    expect(repairedManifest.farrierVersion).toBe("0.3.0");

    const after = await createUpdateReport({ targetDir: dir });

    expect(after.missingInventoryFiles).toEqual([]);
    expect(after.outdatedOwnedFiles).toEqual([]);
    expect(after.hookDrift).toEqual([]);
    expect(after.outdatedUserFiles).toContain("AGENTS.md");
  });

  test("repairs missing executable hook files with executable mode", async () => {
    const dir = await tempDir();
    await renderPack(dir, "python-fastapi");

    const hookPath = join(dir, ".claude", "hooks", "secret-shield.py");
    await unlink(hookPath);

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.missingInventoryFiles).toContain(".claude/hooks/secret-shield.py");

    const result = await applyUpdate({ targetDir: dir });
    expect(result.repairedFiles).toContain(".claude/hooks/secret-shield.py");

    const mode = (await stat(hookPath)).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  test("defaults old manifests to Claude and preserves an unselected Codex binding", async () => {
    const dir = await tempDir();
    await renderPack(dir, "generic");
    const manifestPath = join(dir, ".farrier.json");
    const manifest = await readJson(manifestPath);
    delete manifest.agents;
    await writeJson(manifestPath, manifest);

    await mkdir(join(dir, ".codex"), { recursive: true });
    const customCodex = '{"hooks":{"PreToolUse":[]},"owner":"user"}\n';
    await writeFile(join(dir, ".codex", "hooks.json"), customCodex, "utf8");

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.agents).toEqual(["claude"]);
    expect(report.missingInventoryFiles).not.toContain(".codex/hooks.json");
    expect(report.outdatedUserFiles).not.toContain(".codex/hooks.json");

    await applyUpdate({ targetDir: dir });
    expect((await readJson(manifestPath)).agents).toEqual(["claude"]);
    expect(await readFile(join(dir, ".codex", "hooks.json"), "utf8")).toBe(customCodex);
  });

  test("repairs a missing selected Codex binding and leaves Claude settings unmanaged", async () => {
    const dir = await tempDir();
    const plan = await createRenderPlan({ targetDir: dir, pack: resolvePack("generic"), agents: ["codex"] });
    await writeRenderPlan(plan);
    const customClaude = '{"hooks":{},"owner":"user"}\n';
    await writeFile(join(dir, ".claude", "settings.json"), customClaude, "utf8");
    await unlink(join(dir, ".codex", "hooks.json"));

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.agents).toEqual(["codex"]);
    expect(report.missingInventoryFiles).toContain(".codex/hooks.json");
    expect(report.outdatedUserFiles).not.toContain(".claude/settings.json");

    const result = await applyUpdate({ targetDir: dir });
    expect(result.repairedFiles).toContain(".codex/hooks.json");
    expect(existsSync(join(dir, ".codex", "hooks.json"))).toBe(true);
    expect(await readFile(join(dir, ".claude", "settings.json"), "utf8")).toBe(customClaude);
  });

  test("reports but does not overwrite a modified selected Codex binding", async () => {
    const dir = await tempDir();
    const plan = await createRenderPlan({
      targetDir: dir,
      pack: resolvePack("generic"),
      agents: ["claude", "codex"]
    });
    await writeRenderPlan(plan);
    const customCodex = '{"hooks":{},"owner":"reviewed-user-change"}\n';
    await writeFile(join(dir, ".codex", "hooks.json"), customCodex, "utf8");

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.outdatedUserFiles).toContain(".codex/hooks.json");

    const result = await applyUpdate({ targetDir: dir });
    expect(result.repairedFiles).not.toContain(".codex/hooks.json");
    expect(await readFile(join(dir, ".codex", "hooks.json"), "utf8")).toBe(customCodex);
  });

  test("reports and acknowledges Rails Hotwire secondary findings", async () => {
    const dir = await tempDir();
    await renderPack(dir, "rails");

    await writeFile(
      join(dir, "Gemfile"),
      `source "https://rubygems.org"

gem "rails"
gem "turbo-rails"
`,
      "utf8"
    );

    const report = await createUpdateReport({ targetDir: dir });

    expect(report.currentPackId).toBe("rails");
    expect(report.stackDrift.hasDrift).toBe(false);
    expect(report.unacknowledgedSecondaryFindings.map((finding) => finding.id)).toEqual(["rails-hotwire"]);

    const result = await applyUpdate({ targetDir: dir });

    expect(result.acknowledgedSecondaryIds).toEqual(["rails-hotwire"]);
    expect(result.suggestedSkillsNotInstalled).toEqual([]);
    expect(result.repairedFiles).toContain(".farrier.json");

    const manifest = await readJson(join(dir, ".farrier.json"));
    expect(manifest.secondaryAcknowledged).toEqual(["rails-hotwire"]);

    const after = await createUpdateReport({ targetDir: dir });
    expect(after.unacknowledgedSecondaryFindings).toEqual([]);
  });

  test("detects Rails Hotwire secondary findings from app/javascript and acknowledges once", async () => {
    const dir = await tempDir();
    await renderPack(dir, "rails");

    await writeFile(
      join(dir, "Gemfile"),
      `source "https://rubygems.org"

gem "rails"
`,
      "utf8"
    );
    await mkdir(join(dir, "app", "javascript"), { recursive: true });
    await writeFile(join(dir, "app", "javascript", "application.js"), "import '@hotwired/turbo-rails'\n", "utf8");

    const report = await createUpdateReport({ targetDir: dir });
    expect(report.unacknowledgedSecondaryFindings.map((finding) => finding.id)).toEqual(["rails-hotwire"]);

    await applyUpdate({ targetDir: dir });
    const secondApply = await applyUpdate({ targetDir: dir });

    expect(secondApply.acknowledgedSecondaryIds).toEqual([]);

    const manifest = await readJson(join(dir, ".farrier.json"));
    expect(manifest.secondaryAcknowledged).toEqual(["rails-hotwire"]);
  });

  test("reports and repairs remote hook drift, registry pin drift, and remote owned files", async () => {
    const dir = await tempDir();
    const initialCatalog = await remoteCatalog({
      hookVersion: 1,
      hookContent: "echo v1\n",
      hookSha: "hook-v1".padEnd(64, "0"),
      packSha: "pack-v1".padEnd(64, "0")
    });
    const initialPlan = await createRenderPlan({
      targetDir: dir,
      pack: initialCatalog.resolvePack("@acme/demo"),
      registryPins: initialCatalog.registryPins()
    });
    await writeRenderPlan(initialPlan);

    const updatedCatalog = await remoteCatalog({
      hookVersion: 2,
      hookContent: "echo v2\n",
      hookSha: "hook-v2".padEnd(64, "0"),
      packSha: "pack-v1".padEnd(64, "0")
    });
    const report = await createUpdateReport({ targetDir: dir, catalog: updatedCatalog });

    expect(report.hookDrift).toContainEqual({
      hookId: "@acme/guard",
      manifestVersion: 1,
      currentVersion: 2
    });
    expect(report.registryPinDrift).toContainEqual({
      id: "@acme/guard",
      type: "hook",
      manifestVersion: "1.0.0",
      currentVersion: "2.0.0",
      manifestSha256: "hook-v1".padEnd(64, "0"),
      currentSha256: "hook-v2".padEnd(64, "0")
    });
    expect(report.outdatedOwnedFiles).toContain(".claude/hooks/@acme/guard/guard.sh");

    const result = await applyUpdate({ targetDir: dir, catalog: updatedCatalog });
    expect(result.repairedFiles).toContain(".claude/hooks/@acme/guard/guard.sh");
    expect(result.repairedFiles).toContain(".farrier.json");

    expect(await readFile(join(dir, ".claude", "hooks", "@acme", "guard", "guard.sh"), "utf8")).toBe("echo v2\n");

    const manifest = await readJson(join(dir, ".farrier.json"));
    expect((manifest.versions as { hooks: Record<string, number> }).hooks["@acme/guard"]).toBe(2);
    expect((manifest.registry as { items: Record<string, { sha256: string }> }).items["@acme/guard"].sha256).toBe(
      "hook-v2".padEnd(64, "0")
    );
  });

  test("rejects a concurrent edit after review without overwriting it", async () => {
    const dir = await tempDir();
    await renderPack(dir, "python-fastapi");
    const path = join(dir, ".claude", "hooks", "write-guard.py");
    await writeFile(path, "reviewed drift\n", "utf8");

    await expect(applyUpdate({ targetDir: dir }, {
      beforeTransaction: () => writeFile(path, "concurrent user edit\n", "utf8")
    })).rejects.toThrow("changed after review");
    expect(await readFile(path, "utf8")).toBe("concurrent user edit\n");
  });
});

```

File: /Users/ivor/src/tries/2026-07-02-farrier/docs/plans/provider-native-authoring-shared-skills-2026-07-14.md
```md
# Provider-Native Authoring and Shared Skills Plan

## Goal

Give Farrier one public author choice for agent-generated project artifacts: Claude authors Claude-native files and Codex authors Codex-native files. For skills intentionally shared by both, keep one real tree under `.agents/skills/<name>` and expose it to Claude through a reviewed relative symlink under `.claude/skills/<name>`.

## Background

- Project advice already enforces one provider for backend, session evidence, recommendation targets, and created artifacts, making the separately exposed `--targets` redundant (`src/engine/project-advice.ts:370-381`, `src/cli/advise.ts:40-68`).
- Standalone skill creation still models destinations and authorship through `--agents` plus `author-claude`, `author-codex`, or `per-agent`; single-author runs write `skills/<name>` and install copies, while advice writes directly to native roots (`src/cli/skill-new.ts:47-105`, `src/engine/create-skill.ts:341-437`, `src/engine/advice-apply.ts:253-276`).
- Native project roots are `.claude/skills` for Claude and `.agents/skills` for Codex (`src/engine/skill-paths.ts:23-32`). The mutation engine already supports reviewed in-root relative links, and evaluation winner resolution already replaces a losing native copy with a relative link transactionally (`src/engine/mutation-transaction.ts:20-24`, `src/engine/eval-skill.ts:358-425`).
- Current help and README still advertise multi-provider advice targets that the parser rejects (`src/cli.ts:39-61`, `README.md:260-291`).

## Open Questions

None at scaffold time. The builder should make compatibility, repeatable author selection, shared-skill collision handling, manifest/lock representation, TUI parity, and migration behavior explicit.

## References

- `README.md:70-89`, `README.md:287-342`
- `src/engine/backend.ts:51-82`
- `src/engine/advice-types.ts:132-151`
- `src/engine/advice-catalog.ts:16-66`
- `src/engine/skill-paths.ts:6-41`
- `src/engine/create-skill.ts:321-437`
- `src/engine/eval-skill.ts:338-425`
- `src/engine/mutation-transaction.ts:180-207`, `src/engine/mutation-transaction.ts:344-496`
- `tests/project-advice.test.ts`, `tests/create-skill.test.ts`, `tests/skill-new-cli.test.ts`, `tests/eval-skill.test.ts`

```

File: /Users/ivor/src/tries/2026-07-02-farrier/package.json
```json
{
  "name": "farrier",
  "version": "0.3.0",
  "description": "Create, understand, validate, and evolve reliable coding-agent harnesses.",
  "type": "module",
  "bin": {
    "farrier": "./src/cli.ts"
  },
  "files": [
    "src/**/*.ts",
    "src/**/*.tsx",
    "src/templates/**/*.py",
    "src/templates/**/*.txt",
    "src/templates/**/*.md",
    "README.md"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ivorpad/farrier.git"
  },
  "homepage": "https://github.com/ivorpad/farrier#readme",
  "bugs": {
    "url": "https://github.com/ivorpad/farrier/issues"
  },
  "keywords": [
    "ai-agents",
    "coding-agents",
    "claude-code",
    "codex",
    "developer-tools"
  ],
  "engines": {
    "bun": ">=1.2.0"
  },
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "test:hooks": "uvx pytest src/templates/hooks",
    "check": "bun test && tsc --noEmit && uvx pytest src/templates/hooks",
    "konsistent": "konsistent check --error-on-warnings"
  },
  "dependencies": {
    "@opentui/core": "0.4.2",
    "@opentui/react": "0.4.2",
    "effect": "^3.21.4",
    "react": "^19.1.0",
    "skills": "^1.5.14"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/react": "^19",
    "konsistent": "^1.0.0-beta.1",
    "typescript": "latest"
  }
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/tui/create-eval.tsx
```tsx
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { CreateAgent, SkillCreationOutcome } from "../engine/create-skill";
import {
  evaluatePerAgentSkill,
  perAgentEvalCandidates,
  resolvePerAgentSkillWinner,
  type PerAgentSkillNames,
  type SkillEvalCandidate,
  type SkillEvalVerdict,
  type SkillWinnerResolution
} from "../engine/eval-skill";
import { nativeSkillRoots } from "../engine/create-skill";
import { KeyHints, palette, truncateTo, useSpinner } from "./chrome";
import { binding, bindingsHint, defineBindings, destructiveConfirmationBindings, resolveIntent, runningCancellationBindings } from "./keymap";

export type PendingSkillEval = SkillEvalCandidate;

export const eligiblePerAgentEvals = perAgentEvalCandidates;

/**
 * Decided on the creation form, before authoring starts. "auto" is the only
 * consent that lets the flow delete without a per-verdict confirmation, which
 * is why it must be chosen explicitly upfront and is never the default.
 */
export type SkillEvalPolicy = "ask" | "auto" | "skip";

export const evalPolicyLabels: Record<SkillEvalPolicy, string> = {
  ask: "compare copies & I pick the winner",
  auto: "compare & auto-apply the winner (loser kept in trash)",
  skip: "skip the compare"
};

export function nextEvalPolicy(current: SkillEvalPolicy): SkillEvalPolicy {
  return current === "ask" ? "auto" : current === "auto" ? "skip" : "ask";
}

export function EvalProgressScreen(props: { skillName: string; onCancel: () => void; onQuit: () => void }) {
  const spinner = useSpinner(true);
  const bindings = defineBindings(
    ...runningCancellationBindings,
    binding(["escape", "b"], "back", "cancel evaluation"),
    binding("q", "quit", "quit")
  );

  useKeyboard((key) => {
    const intent = resolveIntent(bindings, key);
    if (intent === "back") props.onCancel();
    else if (intent === "quit" || intent === "interrupt") props.onQuit();
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>{`${spinner}  Evaluating ${props.skillName} copies with the pinned skill-creator guidance…`}</text>
      <text fg={palette.muted}>This is read-only. The recommendation is advisory until you explicitly pick a winner.</text>
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

export function EvalErrorScreen(props: { message: string; onBack: () => void; onQuit: () => void }) {
  const bindings = defineBindings(
    binding(["enter", "escape", "b"], "back", "back to results"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );
  useKeyboard((key) => {
    const intent = resolveIntent(bindings, key);
    if (intent === "back") props.onBack();
    else if (intent === "quit") props.onQuit();
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.warn}>{`✗ Eval failed: ${props.message}`}</text>
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

export function EvalVerdictScreen(props: {
  verdict: SkillEvalVerdict;
  onPick: (winner: CreateAgent) => void;
  onKeepBoth: () => void;
  onQuit: () => void;
}) {
  const [choice, setChoice] = useState(0);
  const choices = ["claude", "codex", "both"] as const;
  const bindings = defineBindings(
    binding(["up", "down"], "move", "move"),
    binding("enter", "activate", "choose"),
    binding(["escape", "b"], "back", "keep both and go back"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );
  useKeyboard((key) => {
    const intent = resolveIntent(bindings, key);
    if (intent === "move") setChoice((current) => Math.min(Math.max(current + (key.name === "down" ? 1 : -1), 0), choices.length - 1));
    else if (intent === "activate" && choices[choice] === "both") props.onKeepBoth();
    else if (intent === "activate") props.onPick(choices[choice] as CreateAgent);
    else if (intent === "back") props.onKeepBoth();
    else if (intent === "quit") props.onQuit();
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>{`Eval verdict for ${props.verdict.skillName} — judged blind, twice, candidates swapped`}</text>
      <text>
        <span fg={palette.gold}>{"recommended: "}</span>
        <span fg={palette.text}>{props.verdict.recommendedWinner}</span>
        <span fg={palette.faint}>{"  (advisory — nothing happens until you choose)"}</span>
      </text>
      <text fg={palette.muted}>{truncateTo(props.verdict.rationale, 110)}</text>
      {(["claude", "codex"] as const).map((agent, index) => {
        const copy = props.verdict.copies[agent];
        const mark = props.verdict.recommendedWinner === agent ? "★ " : "  ";
        return (
          <box key={agent} style={{ flexDirection: "column", gap: 0 }}>
            <text bg={choice === index ? palette.selBg : undefined}>
              <span fg={palette.accent}>{choice === index ? "▸ " : "  "}</span>
              <span fg={palette.gold}>{mark}</span>
              <span fg={palette.text}>{`${agent} ${copy.score}/10`}</span>
              <span fg={palette.faint}>{`  ${copy.path}`}</span>
            </text>
            <text fg={palette.muted}>{`    ${truncateTo(copy.rationale, 100)}`}</text>
            <text fg={palette.success}>{`    + ${truncateTo(copy.strengths.join("; ") || "none noted", 96)}`}</text>
            <text fg={palette.warn}>{`    − ${truncateTo(copy.weaknesses.join("; ") || "none noted", 96)}`}</text>
          </box>
        );
      })}
      {props.verdict.notes.map((note) => (
        <text key={note} fg={palette.faint}>{`- ${truncateTo(note, 108)}`}</text>
      ))}
      {props.verdict.reportPaths ? (
        <text fg={palette.muted}>{`Full reports: ${props.verdict.reportPaths.claude} · ${props.verdict.reportPaths.codex}`}</text>
      ) : null}
      <text bg={choice === 2 ? palette.selBg : undefined}>
        <span fg={palette.accent}>{choice === 2 ? "▸ " : "  "}</span>
        <span fg={palette.text}>Keep both copies</span>
      </text>
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

export function EvalConfirmScreen(props: { names: PerAgentSkillNames; winner: CreateAgent; onConfirm: () => void; onBack: () => void; onQuit: () => void }) {
  const loser = props.winner === "claude" ? "codex" : "claude";
  const deletePath = `${nativeSkillRoots[loser]}/${props.names[loser]}`;
  const linkPath = `${nativeSkillRoots[loser]}/${props.names[props.winner]}`;

  const bindings = defineBindings(
    ...destructiveConfirmationBindings,
    binding("b", "reject", "back"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );
  useKeyboard((key) => {
    const intent = resolveIntent(bindings, key);
    if (intent === "confirm") props.onConfirm();
    else if (intent === "reject") props.onBack();
    else if (intent === "quit") props.onQuit();
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.warn}>{`Delete the ${loser} copy and symlink it to the ${props.winner} copy?`}</text>
      <text fg={palette.muted}>
        {deletePath === linkPath
          ? `${deletePath} will be replaced by a relative symlink.`
          : `${deletePath} will be deleted; ${linkPath} will become a relative symlink.`}
      </text>
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

type EvalFlowPhase = "evaluating" | "verdict" | "confirm" | "applying" | "applied" | "error";

/**
 * The full opt-in eval flow for one per-agent skill pair: run the read-only
 * eval, show the verdict, and only delete+symlink after the user picks a
 * winner AND confirms. "Keep both" (or any cancel) calls onClose unchanged.
 */
export function SkillEvalFlow(props: {
  targetDir: string;
  candidate: PendingSkillEval;
  backend?: CreateAgent;
  /** Upfront consent from the creation form: apply a clear winner without the per-verdict confirm; ties still keep both. */
  autoApply?: boolean;
  onClose: () => void;
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<EvalFlowPhase>("evaluating");
  const [verdict, setVerdict] = useState<SkillEvalVerdict | null>(null);
  const [winner, setWinner] = useState<CreateAgent | null>(null);
  const [resolution, setResolution] = useState<SkillWinnerResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const closeAfterApplyRef = useRef(false);

  const backend = props.backend;

  useEffect(() => {
    if (phase !== "evaluating") {
      return;
    }

    if (!backend) {
      setError("No backend CLI is available to run the read-only eval.");
      setPhase("error");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    evaluatePerAgentSkill({
      targetDir: props.targetDir,
      skillName: props.candidate.skillName,
      names: props.candidate.names,
      description: props.candidate.description,
      backend,
      signal: controller.signal
    })
      .then((result) => {
        if (cancelled) {
          return;
        }

        setVerdict(result);

        // Auto-apply only ever fires on a clear, swap-consistent winner; a
        // tie always falls back to the manual verdict screen.
        if (props.autoApply && result.recommendedWinner !== "tie") {
          setPhase("applying");
          void applyWinner(result.recommendedWinner, true);
        } else {
          setPhase("verdict");
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setPhase("error");
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [backend, phase, props.candidate, props.targetDir]);

  async function applyWinner(picked: CreateAgent, retainBackupInTrash: boolean): Promise<void> {
    try {
      const applied = await resolvePerAgentSkillWinner({
        targetDir: props.targetDir,
        skillName: props.candidate.skillName,
        names: props.candidate.names,
        winner: picked,
        confirmDeleteAndLink: true,
        retainBackupInTrash
      });
      if (closeAfterApplyRef.current) {
        props.onExit();
        return;
      }
      setResolution(applied);
      setPhase("applied");
    } catch (cause) {
      if (closeAfterApplyRef.current) {
        props.onExit();
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
    }
  }

  switch (phase) {
    case "evaluating":
      return (
        <EvalProgressScreen
          skillName={props.candidate.skillName}
          onCancel={() => {
            abortRef.current?.abort();
            props.onClose();
          }}
          onQuit={() => {
            abortRef.current?.abort();
            props.onExit();
          }}
        />
      );

    case "verdict":
      return verdict ? (
        <EvalVerdictScreen
          verdict={verdict}
          onPick={(picked) => {
            setWinner(picked);
            setPhase("confirm");
          }}
          onKeepBoth={props.onClose}
          onQuit={props.onExit}
        />
      ) : (
        <EvalErrorScreen message="Eval finished without a verdict." onBack={props.onClose} onQuit={props.onExit} />
      );

    case "confirm":
      return winner ? (
        <EvalConfirmScreen
          names={props.candidate.names}
          winner={winner}
          onConfirm={() => void applyWinner(winner, false)}
          onBack={() => setPhase("verdict")}
          onQuit={props.onExit}
        />
      ) : (
        <EvalErrorScreen message="No winner is selected." onBack={props.onClose} onQuit={props.onExit} />
      );

    case "applying":
      return (
        <EvalApplyingScreen skillName={props.candidate.skillName} onCloseAfterApply={() => { closeAfterApplyRef.current = true; }} />
      );

    case "applied":
      return resolution ? (
        <EvalAppliedScreen resolution={resolution} onExit={props.onExit} />
      ) : (
        <EvalErrorScreen message="Winner resolution finished without a report." onBack={props.onClose} onQuit={props.onExit} />
      );

    case "error":
      return <EvalErrorScreen message={error ?? "Unknown eval error."} onBack={props.onClose} onQuit={props.onExit} />;
  }
}

function EvalApplyingScreen(props: { skillName: string; onCloseAfterApply: () => void }) {
  const bindings = defineBindings(binding(["ctrl+c", "q"], "interrupt", "close after transaction"));
  useKeyboard((key) => {
    if (resolveIntent(bindings, key) === "interrupt") props.onCloseAfterApply();
  });
  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.accent}>{`Applying the recommended winner for ${props.skillName}…`}</text>
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

export function EvalAppliedScreen(props: { resolution: SkillWinnerResolution; onExit: () => void }) {
  const bindings = defineBindings(
    binding(["enter", "escape", "b"], "close", "close"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );
  useKeyboard((key) => {
    if (resolveIntent(bindings, key)) props.onExit();
  });

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <text fg={palette.success}>{`✓ Kept ${props.resolution.winner} as the ${props.resolution.skillName} winner.`}</text>
      {props.resolution.deleted.map((path) => (
        <text key={path} fg={palette.muted}>{`Deleted ${path}`}</text>
      ))}
      {props.resolution.links.map((link) => (
        <text key={link.path} fg={palette.muted}>{`Linked ${link.path} -> ${link.target}`}</text>
      ))}
      {props.resolution.backupPath ? (
        <text fg={palette.muted}>{`Deleted copy kept at ${props.resolution.backupPath} in case you change your mind.`}</text>
      ) : null}
      <KeyHints hint={bindingsHint(bindings)} />
    </box>
  );
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/project-advice.ts
```ts
import { resolve } from "node:path";
import type { ReasoningEffort } from "../config/farrier-config";
import { invokeBackend, defaultBackendRunner, type BackendCommandRunner } from "./backend";
import { compareEvidence, createEvidenceSet } from "./behavior-evidence";
import { builtinAdviceRegistry, adviceRouteArtifacts, adviceRoutes, type AdviceRegistryEntry } from "./advice-catalog";
import { collectProjectSessionEvidence } from "./advice-sessions";
import {
  adviceCategories,
  adviceCategoryBenefit,
  adviceSessionLookbackLabel,
  type AdviceCategory,
  type AdviceCoverage,
  type AdviceEvidence,
  type AdviceEvidenceFunnel,
  type AdviceRecommendation,
  type AdviceReport,
  type AdviceSessionEvidence,
  type AdviceSessionLookback,
  type AdviceVendor,
  isAdviceCategory
} from "./advice-types";
import type { CodexAppServerFactory } from "./codex-app-server";
import { profileProject, projectProfileSummary } from "./project-profile";
import { searchSkills, type SkillSearchResult } from "./skills";

export type ProjectAdviceInput = {
  targetDir: string;
  backend: AdviceVendor;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  sessions?: "auto" | "none";
  lookback?: AdviceSessionLookback;
  targets?: AdviceVendor[];
  sessionSources?: AdviceVendor[];
  only?: AdviceCategory[];
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
  search?: (query: string) => Promise<SkillSearchResult[]>;
  codexClientFactory?: CodexAppServerFactory;
  sessionEvidence?: AdviceSessionEvidence;
  onProgress?: (event: AdviceProgressEvent) => void;
};

export type AdviceProgressEvent = {
  stage: "profile" | "sessions" | "catalog" | "backend" | "validation" | "complete";
  message: string;
};

type RawRecommendation = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function skillQueries(stacks: string[], languages: string[]): string[] {
  const values = [...stacks, ...languages.map((language) => language.toLowerCase())]
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
    .slice(0, 3);
  return values.length > 0 ? values : ["software engineering"];
}

async function collectSkillRegistry(input: {
  categories: AdviceCategory[];
  stacks: string[];
  languages: string[];
  search: (query: string) => Promise<SkillSearchResult[]>;
}): Promise<{ entries: AdviceRegistryEntry[]; notes: string[] }> {
  if (!input.categories.includes("skills")) return { entries: [], notes: [] };
  const queries = skillQueries(input.stacks, input.languages);
  const outcomes = await Promise.allSettled(queries.map((query) => input.search(query)));
  const entries = new Map<string, AdviceRegistryEntry>();
  const notes: string[] = [];
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === "rejected") {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      notes.push(`Skill registry search for '${queries[index]}' failed: ${message}`);
      continue;
    }
    for (const result of outcome.value.slice(0, 10)) {
      const ref = `${result.source}@${result.skillId}`;
      if (!entries.has(ref)) entries.set(ref, { ref, category: "skills", name: result.name, vendors: ["claude", "codex"] });
    }
  }
  return { entries: Array.from(entries.values()).slice(0, 30), notes };
}

function buildPrompt(input: {
  profileText: string;
  evidence: AdviceEvidence[];
  categories: AdviceCategory[];
  targets: AdviceVendor[];
  registry: AdviceRegistryEntry[];
  focused: boolean;
  selectedProvider: AdviceVendor;
}): string {
  const cap = input.focused ? 5 : 2;
  const evidence = input.evidence.slice(0, 120).map((item) => ({
    id: item.id,
    source: item.source,
    kind: item.kind,
    path: item.path,
    summary: item.summary,
    occurrences: item.occurrences
    ,distinctSessionCount: item.distinctSessions
    ,allowedCategories: item.allowedCategories
    ,targetVendors: item.targetVendors
    ,supportedImplementationRoutes: adviceRoutes.filter((route) =>
      (item.allowedCategories ?? input.categories).includes(route.category) && route.vendors.some((vendor) => input.targets.includes(vendor))
    ).map((route) => route.id)
    ,selectedProvider: item.selectedProvider
  }));
  return `You are Farrier's project advisor. Return JSON only with this shape:
{"recommendations":[{"id":"<category>:<stable-kebab-id>","category":"guidance|hooks|skills|subagents|plugins|mcp","targetVendors":["${input.selectedProvider}"],"reason":"observed problem or opportunity in one concise sentence","benefit":"concrete user-facing outcome in one concise sentence","evidence":["evidence-id"],"confidence":"high|medium|low","routeId":"catalog route id","registryRef":"optional exact catalog ref"}],"coverage":[{"category":"guidance","reason":"why this category did or did not produce a strong recommendation"}]}

Rules:
- Analyze only the bounded project/session signals below. They contain visible prompts, responses, tool events, failures, and outcomes; never claim access to hidden reasoning.
- Evidence summaries are the complete factual boundary. A path-only summary proves existence only; never claim what a file contains unless its summary explicitly says so.
- A short vendor guidance file that delegates to shared guidance is not missing guidance; never recommend duplicating the shared file solely because the vendor file is short.
- Recommend no more than ${cap} items per applicable category. Skip categories without strong evidence.
- Evaluate every requested category independently and include exactly one coverage record for each.
- Treat occurrence count and distinct-session count separately. Repetition across sessions is stronger than repetition inside one session.
- ${input.focused ? "Return every distinct strong recommendation in the focused category." : "Aim for 3–8 distinct recommendations overall when the evidence supports them; do not invent filler to hit a count."}
- Use only requested categories (${input.categories.join(", ")}) and target vendors (${input.targets.join(", ")}).
- The selected provider is ${input.selectedProvider}. Use only ${input.selectedProvider} evidence and ${input.selectedProvider}-native or shared routes; never reference the other provider.
- Every recommendation must cite one or more evidence IDs exactly and use one route ID exactly.
- reason must explain why the recommendation exists using the cited evidence. benefit must explain why implementing it is useful; do not repeat the reason or route description.
- registryRef is optional, but when used it must exactly copy a compatible catalog ref.
- Hooks must remain declarative. Never output executable hook code, scripts, shell fragments, or configuration payloads.
- Do not suggest applying changes. Farrier is producing a report only.
- No markdown or prose outside the JSON object.

Project profile:
${input.profileText}

Allowed route catalog:
${JSON.stringify(adviceRoutes.filter((route) => input.categories.includes(route.category) && route.vendors.some((vendor) => input.targets.includes(vendor))).map(({ id, category, vendors, description }) => ({ id, category, vendors, description })))}

Validated registry catalog:
${JSON.stringify(input.registry)}

Evidence signals:
${JSON.stringify(evidence)}
`;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return undefined;
  return value as string[];
}

function validateRecommendation(input: {
  raw: unknown;
  evidenceIds: Set<string>;
  categories: AdviceCategory[];
  targets: AdviceVendor[];
  routesById: Map<string, (typeof adviceRoutes)[number]>;
  registryByRef: Map<string, AdviceRegistryEntry>;
  evidenceById: Map<string, AdviceEvidence>;
  selectedProvider: AdviceVendor;
}): { recommendation?: AdviceRecommendation; note?: string } {
  if (!isRecord(input.raw)) return { note: "Dropped recommendation: record must be an object." };
  const raw = input.raw as RawRecommendation;
  const category = typeof raw.category === "string" && isAdviceCategory(raw.category) ? raw.category : undefined;
  const id = typeof raw.id === "string" ? raw.id : undefined;
  if (!category || !input.categories.includes(category)) return { note: `Dropped recommendation '${id ?? "unknown"}': unsupported category.` };
  if (!id || !new RegExp(`^${category}:[a-z0-9]+(?:-[a-z0-9]+)*$`).test(id)) return { note: `Dropped recommendation '${id ?? "unknown"}': id must be stable and category-prefixed.` };
  const vendors = stringArray(raw.targetVendors);
  if (!vendors || vendors.length !== 1 || vendors[0] !== input.selectedProvider) {
    return { note: `Dropped recommendation '${id}': invalid target vendors.` };
  }
  const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : undefined;
  if (!reason || reason.length > 320) return { note: `Dropped recommendation '${id}': reason is missing or too long.` };
  const rawBenefit = typeof raw.benefit === "string" && raw.benefit.trim() ? raw.benefit.trim() : undefined;
  if (raw.benefit !== undefined && (!rawBenefit || rawBenefit.length > 240)) {
    return { note: `Dropped recommendation '${id}': benefit is invalid or too long.` };
  }
  const benefit = rawBenefit ?? adviceCategoryBenefit(category);
  const evidence = stringArray(raw.evidence);
  if (!evidence || evidence.length === 0 || evidence.some((evidenceId) => !input.evidenceIds.has(evidenceId))) {
    return { note: `Dropped recommendation '${id}': evidence contains an unknown or missing reference.` };
  }
  if (evidence.some((evidenceId) => {
    const source = input.evidenceById.get(evidenceId)?.source;
    return source !== "project" && source !== input.selectedProvider;
  })) {
    return { note: `Dropped recommendation '${id}': evidence references a different provider.` };
  }
  const confidence = raw.confidence;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") return { note: `Dropped recommendation '${id}': invalid confidence.` };
  const routeId = typeof raw.routeId === "string" ? raw.routeId : "";
  const route = input.routesById.get(routeId);
  if (!route || route.category !== category || !(vendors as AdviceVendor[]).every((vendor) => route.vendors.includes(vendor))) {
    return { note: `Dropped recommendation '${id}': unsupported implementation route.` };
  }
  const registryRef = typeof raw.registryRef === "string" ? raw.registryRef : undefined;
  if (registryRef) {
    const entry = input.registryByRef.get(registryRef);
    if (!entry || entry.category !== category || !(vendors as AdviceVendor[]).every((vendor) => entry.vendors.includes(vendor))) {
      return { note: `Dropped recommendation '${id}': registry ref '${registryRef}' is unsupported.` };
    }
  }
  if (Object.keys(raw).some((key) => /(?:code|script|payload|command)/i.test(key))) {
    return { note: `Dropped recommendation '${id}': executable payloads are not accepted.` };
  }
  if (category === "hooks" && /```|#!|[{}]|(?:^|\s)(?:bash|node|python(?:3)?)\s+-/i.test(`${reason}\n${benefit}`)) {
    return { note: `Dropped recommendation '${id}': executable hook content is not accepted.` };
  }
  const creates = adviceRouteArtifacts(route, vendors as AdviceVendor[]);
  const otherProvider = input.selectedProvider === "claude" ? "codex" : "claude";
  if (creates.some((artifact) => artifact.vendor === otherProvider || artifact.path.toLowerCase().includes(`.${otherProvider}/`))) {
    return { note: `Dropped recommendation '${id}': generated artifacts reference a different provider.` };
  }
  return {
    recommendation: {
      id,
      category,
      targetVendors: vendors as AdviceVendor[],
      reason,
      benefit,
      evidence: Array.from(new Set(evidence)),
      confidence,
      implementationRoute: { id: route.id, description: route.description },
      creates,
      ...(registryRef ? { registryRef } : {})
    }
  };
}

function validateRecommendations(input: {
  parsed: unknown;
  evidence: AdviceEvidence[];
  categories: AdviceCategory[];
  targets: AdviceVendor[];
  registry: AdviceRegistryEntry[];
  selectedProvider: AdviceVendor;
}): { recommendations: AdviceRecommendation[]; notes: string[]; rejectedCategories: Set<AdviceCategory>; returned: number } {
  if (!isRecord(input.parsed) || !Array.isArray(input.parsed.recommendations)) {
    throw new Error('advice backend JSON must have shape {"recommendations":[...]}');
  }
  const notes: string[] = [];
  const recommendations: AdviceRecommendation[] = [];
  const seenIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const cap = input.categories.length === 1 ? 5 : 2;
  const counts = new Map<AdviceCategory, number>();
  const rejectedCategories = new Set<AdviceCategory>();
  const context = {
    evidenceIds: new Set(input.evidence.map((item) => item.id)),
    categories: input.categories,
    targets: input.targets,
    routesById: new Map(adviceRoutes.map((route) => [route.id, route])),
    registryByRef: new Map(input.registry.map((entry) => [entry.ref, entry]))
    , evidenceById: new Map(input.evidence.map((item) => [item.id, item]))
    , selectedProvider: input.selectedProvider
  };
  for (const raw of input.parsed.recommendations) {
    const result = validateRecommendation({ raw, ...context });
    if (!result.recommendation) {
      if (result.note) notes.push(result.note);
      if (isRecord(raw) && typeof raw.category === "string" && isAdviceCategory(raw.category)) rejectedCategories.add(raw.category);
      continue;
    }
    const recommendation = result.recommendation;
    const signature = `${recommendation.category}:${recommendation.reason.toLowerCase()}:${recommendation.targetVendors.join(",")}`;
    if (seenIds.has(recommendation.id) || seenSignatures.has(signature)) {
      notes.push(`Dropped duplicate recommendation '${recommendation.id}'.`);
      continue;
    }
    if ((counts.get(recommendation.category) ?? 0) >= cap) {
      notes.push(`Dropped recommendation '${recommendation.id}' beyond the ${cap} ${recommendation.category} limit.`);
      continue;
    }
    seenIds.add(recommendation.id);
    seenSignatures.add(signature);
    counts.set(recommendation.category, (counts.get(recommendation.category) ?? 0) + 1);
    recommendations.push(recommendation);
  }
  return { recommendations, notes, rejectedCategories, returned: input.parsed.recommendations.length };
}

function validateCoverage(input: {
  parsed: unknown;
  categories: AdviceCategory[];
  recommendations: AdviceRecommendation[];
  weakLeads: AdviceRecommendation[];
  sessionEvidence: AdviceEvidence[];
  rejectedCategories: Set<AdviceCategory>;
  targets: AdviceVendor[];
}): AdviceCoverage[] {
  const { parsed, categories, recommendations } = input;
  const rawCoverage = isRecord(parsed) && Array.isArray(parsed.coverage) ? parsed.coverage : [];
  const reasons = new Map<AdviceCategory, string>();
  for (const raw of rawCoverage) {
    if (!isRecord(raw) || typeof raw.category !== "string" || !isAdviceCategory(raw.category) || !categories.includes(raw.category)) continue;
    if (typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.length > 240 || reasons.has(raw.category)) continue;
    reasons.set(raw.category, raw.reason.trim());
  }
  return categories.map((category): AdviceCoverage => {
    const count = recommendations.filter((item) => item.category === category).length;
    const patterns = input.sessionEvidence.filter((item) => item.allowedCategories?.includes(category));
    const supported = patterns.filter((item) => (item.distinctSessions ?? 0) >= 2 || (item.occurrences ?? 1) >= 3);
    const hasRoute = adviceRoutes.some((route) => route.category === category && route.vendors.some((vendor) => input.targets.includes(vendor)));
    if (count > 0) return {
      category, status: "accepted",
      reason: reasons.get(category) ?? `${count} supported recommendation${count === 1 ? "" : "s"} passed validation.`
    };
    if (input.weakLeads.some((item) => item.category === category)) return {
      category, status: "weak-evidence",
      reason: reasons.get(category) ?? "The candidate remained low confidence; recurrence in another distinct session or a second independent signal would strengthen it."
    };
    if (input.rejectedCategories.has(category)) return {
      category, status: "validation-rejection",
      reason: `The backend returned this category, but every candidate failed evidence, route, registry, duplicate, or limit validation.`
    };
    if (supported.length > 0 && !hasRoute) return {
      category, status: "supported-no-route",
      reason: `${supported.length} recurring pattern${supported.length === 1 ? "" : "s"} supported this category, but no validated implementation route matched the selected targets.`
    };
    if (supported.length > 0) return {
      category, status: "backend-omission",
      reason: reasons.get(category) ?? `Recurring actionable evidence supported this category, but the backend returned no recommendation that passed validation.`
    };
    if (patterns.length > 0) return {
      category, status: "weak-evidence",
      reason: reasons.get(category) ?? "Evidence was isolated or repeated only within one session; recurrence across distinct sessions would strengthen it."
    };
    return {
      category,
      status: "no-evidence",
      reason: reasons.get(category) ?? "No visible recurring actionable evidence mapped to this category."
    };
  });
}

function emptyEvidenceFunnel(targets: AdviceVendor[]): AdviceEvidenceFunnel {
  return {
    sources: targets.map((source) => ({ source, discovered: 0, eligible: 0, read: 0, parsed: 0, visibleEvents: 0,
      discarded: { filtering: 0, redaction: 0, deduplication: 0, malformed: 0, limits: 0 }, retainedPatterns: 0 })),
    visibleEvents: 0,
    recurringPatterns: 0
  };
}

function isolateSessionEvidence(evidence: AdviceSessionEvidence, provider: AdviceVendor): AdviceSessionEvidence {
  const signals = evidence.signals
    .filter((item) => item.source === provider && (!item.targetVendors || item.targetVendors.includes(provider)))
    .map((item) => ({
      ...item,
      targetVendors: [provider],
      implementationRoutes: item.implementationRoutes?.filter((routeId) =>
        adviceRoutes.some((route) => route.id === routeId && route.vendors.includes(provider)))
    }));
  const source = evidence.sources.find((item) => item.source === provider) ?? { source: provider, count: 0 };
  const funnelSource = evidence.funnel?.sources.find((item) => item.source === provider);
  const visibleEvents = funnelSource?.visibleEvents
    ?? signals.reduce((sum, item) => sum + (item.occurrences ?? 1), 0);
  const retainedPatterns = signals.length;
  return {
    sources: [source],
    signals,
    notes: [...evidence.notes],
    funnel: {
      sources: funnelSource ? [{ ...funnelSource, retainedPatterns }] : emptyEvidenceFunnel([provider]).sources,
      visibleEvents,
      recurringPatterns: signals.filter((item) => (item.distinctSessions ?? 0) >= 2 || (item.occurrences ?? 1) >= 2).length
    }
  };
}

export async function adviseProject(input: ProjectAdviceInput): Promise<AdviceReport> {
  const targetDir = resolve(input.targetDir);
  const sessions = input.sessions ?? "auto";
  const lookback = input.lookback ?? "7d";
  if (input.targets && (input.targets.length !== 1 || input.targets[0] !== input.backend)) {
    throw new Error(`Advice targets must equal the selected backend (${input.backend}); choose --targets ${input.backend} or omit --targets.`);
  }
  if (input.sessionSources && (input.sessionSources.length !== 1 || input.sessionSources[0] !== input.backend)) {
    throw new Error(`Advice session sources must equal the selected backend (${input.backend}).`);
  }
  const targets: AdviceVendor[] = [input.backend];
  const sessionSources: AdviceVendor[] = [input.backend];
  const categories = input.only?.length ? input.only : [...adviceCategories];
  const progress = (stage: AdviceProgressEvent["stage"], message: string): void => {
    try {
      input.onProgress?.({ stage, message });
    } catch {
      // A display callback must not break analysis.
    }
  };
  progress("profile", "Profiling project structure and agent configuration…");
  progress("sessions", sessions === "auto"
    ? `Finding exact-project sessions from the ${adviceSessionLookbackLabel(lookback)}…`
    : "Skipping project sessions; using codebase evidence only…");
  const [profile, collectedSessionEvidence] = await Promise.all([
    profileProject(targetDir),
    sessions === "auto"
      ? input.sessionEvidence ?? collectProjectSessionEvidence({ targetDir, targets: sessionSources, lookback, codexClientFactory: input.codexClientFactory })
      : Promise.resolve<AdviceSessionEvidence>({ sources: sessionSources.map((source) => ({ source, count: 0 })), signals: [], notes: [], funnel: emptyEvidenceFunnel(sessionSources) })
  ]);
  const sessionEvidence = isolateSessionEvidence(collectedSessionEvidence, input.backend);
  const sessionCount = sessionEvidence.sources.reduce((sum, source) => sum + source.count, 0);
  progress("sessions", sessions === "auto"
    ? `Found ${sessionCount} matching session(s); retained ${sessionEvidence.signals.length} bounded signal(s).`
    : "Session evidence disabled.");
  progress("catalog", categories.includes("skills") ? "Checking the skill registry for supported candidates…" : "Building supported implementation routes…");
  const skills = await collectSkillRegistry({ categories, stacks: profile.stacks, languages: profile.languages, search: input.search ?? searchSkills });
  const registry = [...builtinAdviceRegistry, ...skills.entries].filter((entry) => categories.includes(entry.category) && entry.vendors.some((vendor) => targets.includes(vendor)));
  const reportEvidenceSet = createEvidenceSet({
    workflow: "advice",
    items: [
      { id: `provenance:selected-provider:${input.backend}`, source: "project" as const, kind: "provenance", summary: `Advice evidence is isolated to selected provider ${input.backend}.`, selectedProvider: input.backend },
      ...profile.evidence,
      ...sessionEvidence.signals
    ],
    maxItems: 200,
    maxItemBytes: 8_000,
    maxTotalBytes: 1_600_000
  });
  profile.evidence = reportEvidenceSet.items.filter((item) => item.source === "project");
  sessionEvidence.signals = reportEvidenceSet.items.filter((item) => item.source !== "project");
  const evidenceSet = createEvidenceSet({ workflow: "advice", items: reportEvidenceSet.items });
  const evidence = evidenceSet.items;
  progress("backend", `Asking ${input.backend} for bounded recommendations…`);
  const invoke = (requestCategories: AdviceCategory[]) => invokeBackend({
    backend: input.backend,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prompt: buildPrompt({ profileText: projectProfileSummary(profile), evidence, categories: requestCategories, targets, registry, focused: requestCategories.length === 1, selectedProvider: input.backend }),
    targetDir,
    ephemeral: true,
    runner: input.runner ?? defaultBackendRunner,
    signal: input.signal
  });
  const firstParsed = await invoke(categories);
  progress("validation", "Validating evidence, routes, registry references, duplicates, and category limits…");
  const firstValidated = validateRecommendations({ parsed: firstParsed, evidence, categories, targets, registry, selectedProvider: input.backend });
  const supportedCategories = categories.filter((category) => sessionEvidence.signals.some((item) =>
    item.allowedCategories?.includes(category) && ((item.distinctSessions ?? 0) >= 2 || (item.occurrences ?? 1) >= 3)));
  const firstStrongCategories = new Set(firstValidated.recommendations.filter((item) => item.confidence !== "low").map((item) => item.category));
  const recoveryCategories = supportedCategories.filter((category) => !firstStrongCategories.has(category));
  const shouldRecover = categories.length > 1
    && firstValidated.recommendations.filter((item) => item.confidence !== "low").length < 3
    && supportedCategories.length >= 3
    && recoveryCategories.length > 0;
  let recoveryParsed: unknown;
  if (shouldRecover) {
    progress("backend", `Recovering omitted evidence-supported categories: ${recoveryCategories.join(", ")}…`);
    recoveryParsed = await invoke(recoveryCategories);
  }
  const combinedParsed = recoveryParsed && isRecord(recoveryParsed) && Array.isArray(recoveryParsed.recommendations)
    ? {
        recommendations: [
          ...(isRecord(firstParsed) && Array.isArray(firstParsed.recommendations) ? firstParsed.recommendations : []),
          ...recoveryParsed.recommendations
        ],
        coverage: [
          ...(isRecord(firstParsed) && Array.isArray(firstParsed.coverage) ? firstParsed.coverage : []),
          ...(Array.isArray(recoveryParsed.coverage) ? recoveryParsed.coverage : [])
        ]
      }
    : firstParsed;
  const validated = validateRecommendations({ parsed: combinedParsed, evidence, categories, targets, registry, selectedProvider: input.backend });
  const recommendations = validated.recommendations.filter((item) => item.confidence !== "low");
  const weakLeads = validated.recommendations.filter((item) => item.confidence === "low");
  const coverage = validateCoverage({
    parsed: combinedParsed, categories, recommendations, weakLeads,
    sessionEvidence: sessionEvidence.signals, rejectedCategories: validated.rejectedCategories, targets
  });
  const notes = [...sessionEvidence.notes, ...skills.notes, ...validated.notes];
  if (reportEvidenceSet.truncated) notes.push(`Advice report evidence was bounded: retained ${reportEvidenceSet.itemCount}/${reportEvidenceSet.inputItemCount} items; ${reportEvidenceSet.truncatedItemCount} truncated and ${reportEvidenceSet.omittedItemCount} omitted.`);
  if (evidenceSet.truncated) notes.push(`Backend evidence was bounded to ${evidenceSet.itemCount}/${evidenceSet.inputItemCount} items (${evidenceSet.byteCount} bytes); the report retains the larger redacted inventory.`);
  if (sessions === "none") notes.unshift("Project sessions were disabled; recommendations use codebase evidence only.");
  else if (sessionCount === 0) notes.unshift("No matching project sessions were found; recommendations use codebase evidence only.");
  notes.push("Report only: Farrier did not install recommendations or change project configuration.");
  if (weakLeads.length > 0) notes.push(`${weakLeads.length} low-confidence item(s) are shown as weak leads, not supported recommendations.`);
  progress("complete", `Report ready with ${validated.recommendations.length} validated recommendation(s): ${recommendations.length} supported and ${weakLeads.length} weak lead(s).`);

  const evidenceCases = evidence.map((item) => ({ id: item.id, outcome: "inconclusive" as const }));
  const evidenceComparison = compareEvidence({ beforeSet: evidenceSet, afterSet: evidenceSet, before: evidenceCases, after: evidenceCases });
  const funnel = sessionEvidence.funnel ?? emptyEvidenceFunnel(targets);
  funnel.recommendation = {
    patternsSent: sessionEvidence.signals.length,
    returned: validated.returned,
    accepted: validated.recommendations.length,
    merged: recoveryParsed ? Math.max(validated.recommendations.length - firstValidated.recommendations.length, 0) : 0,
    rejected: Math.max(validated.returned - validated.recommendations.length, 0),
    rejectionReasons: validated.notes,
    recoveryCalls: recoveryParsed ? 1 : 0
  };

  return {
    schemaVersion: 1,
    targetDir,
    backend: input.backend,
    ...(input.model ? { model: input.model } : {}),
    reportOnly: true,
    targets,
    sessions: {
      mode: sessions,
      lookback,
      included: sessions === "auto" && sessionCount > 0,
      requestedSources: sessionSources,
      sources: sessionEvidence.sources,
      evidence: sessions === "auto" ? sessionEvidence.signals : [],
      funnel
    },
    profile,
    recommendations,
    weakLeads,
    coverage,
    evidence: evidenceComparison,
    notes
  };
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/skills.ts
```ts
import { Effect } from "effect";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillRef } from "../packs/types";
import { applyMutationPlan, inspectMutationPlan, type MutationOperation } from "./mutation-transaction";
import { withIsolatedExecution, type IsolationFact, type IsolatedInput } from "./execution-isolation";

export type SkillSearchResult = {
  skillId: string;
  name: string;
  installs: number;
  source: string;
};

export type CommandRunnerInput = {
  cmd: string[];
  cwd: string;
  signal?: AbortSignal;
  env?: Record<string, string>;
};

export type CommandRunnerOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (input: CommandRunnerInput) => Promise<CommandRunnerOutput>;

export type InstallSkillResult = {
  ref: SkillRef;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
  isolation?: IsolationFact;
};

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeSkill(value: unknown): SkillSearchResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const skillId = stringField(record.skillId) ?? stringField(record.id);
  const source = stringField(record.source);

  if (!skillId || !source) {
    return undefined;
  }

  const installs = typeof record.installs === "number" && Number.isFinite(record.installs) ? record.installs : 0;

  return {
    skillId,
    name: stringField(record.name) ?? skillId,
    installs,
    source
  };
}

function isSkillSearchResult(value: SkillSearchResult | undefined): value is SkillSearchResult {
  return value !== undefined;
}

export async function searchSkills(q: string, options?: { signal?: AbortSignal }): Promise<SkillSearchResult[]> {
  const query = q.trim();

  if (query.length === 0) {
    return [];
  }

  const baseUrl = (process.env.SKILLS_API_URL || "https://skills.sh").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=10`, {
    signal: options?.signal
  });

  if (!response.ok) {
    throw new Error(`skills search failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as { skills?: unknown[] };
  const skills = Array.isArray(body.skills) ? body.skills : [];

  return skills
    .map(normalizeSkill)
    .filter(isSkillSearchResult)
    .sort((a, b) => b.installs - a.installs);
}

function parseSkillRef(ref: SkillRef): { source: string; skillId: string } | undefined {
  const separator = ref.lastIndexOf("@");

  if (separator <= 0 || separator === ref.length - 1) {
    return undefined;
  }

  const source = ref.slice(0, separator);
  const skillId = ref.slice(separator + 1);

  if (!source || !skillId) {
    return undefined;
  }

  return { source, skillId };
}

// The external CLI owns a shared lock/manifest surface. Run sources one at a
// time so reviewed staged transactions cannot race each other.
const INSTALL_CONCURRENCY = 1;
const skillsEnvironmentPassthrough = [
  "GITHUB_TOKEN", "GH_TOKEN", "GITLAB_TOKEN", "GITLAB_PRIVATE_TOKEN",
  "BITBUCKET_TOKEN", "BITBUCKET_USERNAME", "BITBUCKET_APP_PASSWORD",
  "SSH_AUTH_SOCK", "GIT_ASKPASS", "SSH_ASKPASS", "GIT_SSH_COMMAND", "GIT_SSH_VARIANT",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "all_proxy", "no_proxy"
] as const;

async function readLockedSkillIds(targetDir: string): Promise<Set<string> | undefined> {
  try {
    const content = await readFile(join(targetDir, "skills-lock.json"), "utf-8");
    const parsed = JSON.parse(content) as { skills?: Record<string, unknown> };

    if (!parsed.skills || typeof parsed.skills !== "object") {
      return undefined;
    }

    return new Set(Object.keys(parsed.skills));
  } catch {
    return undefined;
  }
}

export type ResolveSkillsCommandDeps = {
  which: (bin: string) => string | null;
  exists: (path: string) => boolean;
};

const defaultResolveDeps: ResolveSkillsCommandDeps = {
  which: (bin) => Bun.which(bin),
  exists: (path) => existsSync(path)
};

function bundledSkillsBinPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "..", "..", "node_modules", ".bin", "skills");
}

export function resolveSkillsCommand(deps: ResolveSkillsCommandDeps = defaultResolveDeps): string[] {
  const envBin = process.env.FARRIER_SKILLS_BIN;

  if (envBin && envBin.trim().length > 0) {
    return envBin.trim().split(/\s+/);
  }

  const bundledBin = bundledSkillsBinPath();

  if (deps.exists(bundledBin)) {
    return [bundledBin];
  }

  if (deps.which("skills")) {
    return ["skills"];
  }

  if (deps.which("bunx")) {
    return ["bunx", "skills"];
  }

  if (deps.which("pnpm")) {
    return ["pnpm", "dlx", "skills"];
  }

  throw new Error(
    "Could not find the skills CLI. Install it as a dependency (bundled at node_modules/.bin/skills), " +
      "add it to PATH, set FARRIER_SKILLS_BIN, or ensure bunx or pnpm is available."
  );
}

async function defaultRunner(input: CommandRunnerInput): Promise<CommandRunnerOutput> {
  const proc = Bun.spawn({
    cmd: input.cmd,
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: input.env,
    detached: true
  });

  const abort = () => {
    try { process.kill(-proc.pid, "SIGTERM"); } catch { proc.kill(); }
  };
  input.signal?.addEventListener("abort", abort, { once: true });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("")
  ]);

  input.signal?.removeEventListener("abort", abort);
  return {
    exitCode,
    stdout,
    stderr
  };
}

export const defaultInstallAgents = ["claude-code", "codex"];

export async function installSkills(
  refs: SkillRef[],
  targetDir: string,
  runner: CommandRunner = defaultRunner,
  resolveDeps: ResolveSkillsCommandDeps = defaultResolveDeps,
  agents: string[] = defaultInstallAgents,
  global = false
): Promise<InstallSkillResult[]> {
  const uniqueRefs = Array.from(new Set(refs));
  const resultByRef = new Map<SkillRef, InstallSkillResult>();

  let commandHead: string[];

  try {
    commandHead = resolveSkillsCommand(resolveDeps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return uniqueRefs.map((ref) => ({
      ref,
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: 1,
      error: message
    }));
  }

  const commandLabel = commandHead.join(" ");
  const refsBySource = new Map<string, { ref: SkillRef; skillId: string }[]>();

  for (const ref of uniqueRefs) {
    const parsed = parseSkillRef(ref);

    if (!parsed) {
      resultByRef.set(ref, {
        ref,
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: 1,
        error: `Invalid skill ref '${ref}'. Expected <source>@<skillId>.`
      });
      continue;
    }

    const group = refsBySource.get(parsed.source) ?? [];
    group.push({ ref, skillId: parsed.skillId });
    refsBySource.set(parsed.source, group);
  }

  const installSource = async (source: string, skillIds: string[]): Promise<InstallSkillResult[]> => {
    const cmd = [...commandHead, "add", source, "-s", ...skillIds, "-a", ...agents, ...(global ? ["-g"] : []), "-y"];
    const refs = skillIds.map((skillId): SkillRef => `${source}@${skillId}`);

    let output: CommandRunnerOutput;
    let runError: string | undefined;

    let isolation: IsolationFact | undefined;
    let workspace: string | undefined;
    try {
      const inputs: IsolatedInput[] = [];
      const localSource = source.startsWith("./") ? join(targetDir, source.slice(2)) : undefined;
      if (localSource && (await lstat(localSource).catch(() => undefined))) inputs.push({ source: localSource, path: source.slice(2) });
      const lockPath = join(targetDir, "skills-lock.json");
      if (!global && (await lstat(lockPath).catch(() => undefined))) inputs.push({ source: lockPath, path: "skills-lock.json" });
      const isolated = await withIsolatedExecution({
        targetDir,
        inputs,
        nativeConfinement: false,
        environmentPassthrough: skillsEnvironmentPassthrough,
        environmentOverrides: {
          GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL ?? join(homedir(), ".gitconfig")
        },
        retainWorkspace: true,
        run: async (context) => ({
          output: await runner({ cmd, cwd: context.workspace, signal: context.signal, env: context.environment }),
          workspace: context.workspace
        })
      });
      output = isolated.value.output;
      workspace = isolated.value.workspace;
      isolation = isolated.isolation;
      if (output.exitCode === 0) {
        const allowed = new Set([".claude", ".agents", ".codex", "skills-lock.json", "skills", "home", "tmp"]);
        const unexpected = (await readdir(workspace)).filter((entry) => !allowed.has(entry));
        if (unexpected.length > 0) throw new Error(`skills CLI produced unexpected output: ${unexpected.sort().join(", ")}`);

        const outputRoot = global ? join(workspace, "home") : workspace;
        const destinationRoot = global ? (process.env.HOME || homedir()) : targetDir;
        const roots = agents.map((agent) => global
          ? (agent === "claude-code" ? ".claude/skills" : ".codex/skills")
          : (agent === "claude-code" ? ".claude/skills" : ".agents/skills"));
        const operations: MutationOperation[] = [];
        for (const root of roots) {
          for (const skillId of skillIds) {
            const staged = join(outputRoot, root, skillId);
            if ((await lstat(staged).catch(() => undefined))?.isDirectory()) {
              operations.push({ kind: "replace-tree", path: `${root}/${skillId}`, sourcePath: staged });
            }
          }
        }
        const stagedLock = join(workspace, "skills-lock.json");
        if (!global && (await lstat(stagedLock).catch(() => undefined))?.isFile()) {
          const stagedDocument = JSON.parse(await readFile(stagedLock, "utf8")) as { version?: unknown; skills?: Record<string, unknown> };
          const currentDocument = await readFile(join(targetDir, "skills-lock.json"), "utf8")
            .then((value) => JSON.parse(value) as { version?: unknown; skills?: Record<string, unknown> })
            .catch(() => ({ version: stagedDocument.version, skills: {} }));
          const merged = {
            ...currentDocument,
            ...stagedDocument,
            skills: { ...(currentDocument.skills ?? {}), ...(stagedDocument.skills ?? {}) }
          };
          operations.push({ kind: "write-file", path: "skills-lock.json", content: `${JSON.stringify(merged, null, 2)}\n` });
        }
        if (operations.length > 0) await applyMutationPlan(await inspectMutationPlan(destinationRoot, operations));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output = { exitCode: 1, stdout: "", stderr: "" };
      runError = `${message} (ran '${commandLabel}'). Try installing the skills CLI or set FARRIER_SKILLS_BIN.`;
    } finally {
      if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }

    return refs.map((ref) => ({
      ref,
      ok: !runError && output.exitCode === 0,
      stdout: output.stdout,
      stderr: output.stderr,
      exitCode: output.exitCode,
      isolation,
      error:
        runError ??
        (output.exitCode === 0
          ? undefined
          : `${commandLabel} add exited with code ${output.exitCode}. Try installing the skills CLI or set FARRIER_SKILLS_BIN.`)
    }));
  };

  // One `skills add` per source (the -s flag takes multiple skill ids), so each
  // source repo is cloned once. Sources run concurrently, capped so a long
  // source list doesn't spawn unbounded clones.
  const sourceResults = await Effect.runPromise(
    Effect.forEach(
      Array.from(refsBySource.entries()),
      ([source, group]) =>
        Effect.promise(() => installSource(source, group.map((entry) => entry.skillId))),
      { concurrency: INSTALL_CONCURRENCY }
    )
  );

  for (const result of sourceResults.flat()) {
    resultByRef.set(result.ref, result);
  }

  // The skills CLI updates skills-lock.json via read-modify-write with no file
  // locking, so concurrent invocations can drop each other's lock entries even
  // when every install succeeded. Verify the lock and re-run the raced skills
  // sequentially (sequential = no race, so one repair pass converges).
  if (refsBySource.size > 1) {
    const lockedSkillIds = await readLockedSkillIds(targetDir);

    if (lockedSkillIds) {
      for (const [source, group] of refsBySource) {
        const missing = group.filter(
          (entry) => resultByRef.get(entry.ref)?.ok && !lockedSkillIds.has(entry.skillId)
        );

        if (missing.length === 0) {
          continue;
        }

        const repaired = await installSource(source, missing.map((entry) => entry.skillId));

        for (const result of repaired) {
          resultByRef.set(result.ref, result);
        }
      }
    }
  }

  return uniqueRefs
    .map((ref) => resultByRef.get(ref))
    .filter((result): result is InstallSkillResult => result !== undefined);
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/cli/skill-new.ts
```ts
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadFarrierConfig, resolveModelSettings, type ModelsConfig } from "../config/farrier-config";
import { probeAgents } from "../engine/backend";
import {
  canonicalSkillRoot,
  createSkills,
  installLocalSkill,
  recordSkillInManifest,
  scaffoldSkillDraft,
  type AuthoringMode,
  type CollisionDecision,
  type CreateAgent,
  type SkillCreationOutcome
} from "../engine/create-skill";
import { detectPacks } from "../engine/detect";
import { evaluatePerAgentSkill, perAgentEvalCandidates, type SkillEvalVerdict } from "../engine/eval-skill";
import {
  applyRefinements,
  generateNextGrillQuestion,
  maxGrillQuestions,
  type RefineAnswer,
  type RefineQuestion
} from "../engine/refine-skill";
import { writeRenderPlan } from "../engine/render";

export type SkillNewCliOptions = {
  description?: string;
  dir: string;
  name?: string;
  agents?: CreateAgent[];
  mode?: AuthoringMode;
  model?: string;
  noLlm: boolean;
  refine: boolean;
  force: boolean;
  noInstall: boolean;
  dryRun: boolean;
  yes: boolean;
  eval: boolean;
  json: boolean;
  help: boolean;
};

function skillNewUsage(): string {
  return `farrier skill new — create a new agent skill with each vendor's own skill-creator

Usage:
  farrier skill new "<description>" [--dir <target>] [--agents claude,codex] [--mode <mode>] --yes

Authoring is delegated to the vendor's recommended creator: claude uses the pinned
anthropics/skills skill-creator (installed into the target on first use), codex uses its
built-in $skill-creator. Farrier validates the result and installs it via the skills CLI.

Options:
  --dir <path>       Target directory. Defaults to current working directory.
  --agents <list>    Comma-separated targets: claude, codex, or both. Defaults to the agents
                     whose CLIs answer --version on PATH.
  --mode <mode>      Required when more than one agent is selected:
                       author-claude  claude authors one canonical skills/<name>/, installed to all agents
                       author-codex   codex authors the canonical copy, installed to all agents
                       per-agent      each agent authors its own copy in its native skill dir
  --name <kebab>     Ask the creator for this exact skill name.
  --model <name>     Backend model override for the authoring run (overrides the models config).
  --no-llm           Skip agent authoring; write a deterministic SKILL.md scaffold instead.
  --refine           Grill the brief first: clarifying questions one at a time (interactive; requires a terminal).
  --force            Replace an existing skill directory on collision (scaffold and authored).
  --no-install       Skip the 'skills add ./skills' install step after authoring.
  --dry-run          Preview the scaffold without writing (only valid with --no-llm).
  --yes, -y          Required for writes.
  --eval             After a per-agent creation with both copies, run the read-only blind
                     eval and include the verdict (never deletes; apply a winner with
                     farrier skill eval --apply-winner ... --delete-loser-and-link).
  --json             Emit { name, mode, agents, files, installed, notes, error, eval? }.
  --help             Show this help.

Exits 0 on success; exits 1 on refusal, authoring failure, or install failure (authored files
are kept on disk with a retry command).`;
}

function parseAgentsList(value: string): CreateAgent[] {
  const agents = value
    .split(",")
    .map((agent) => agent.trim())
    .filter((agent) => agent.length > 0);

  for (const agent of agents) {
    if (agent !== "claude" && agent !== "codex") {
      throw new Error("--agents accepts a comma-separated list of: claude, codex");
    }
  }

  if (agents.length === 0) {
    throw new Error("--agents requires at least one of: claude, codex");
  }

  return Array.from(new Set(agents)) as CreateAgent[];
}

function parseMode(value: string): AuthoringMode {
  if (value === "author-claude" || value === "author-codex" || value === "per-agent") {
    return value;
  }

  throw new Error("--mode must be author-claude, author-codex, or per-agent");
}

export function parseSkillNewArgs(args: string[]): SkillNewCliOptions {
  const options: SkillNewCliOptions = {
    dir: process.cwd(),
    noLlm: false,
    refine: false,
    force: false,
    noInstall: false,
    dryRun: false,
    yes: false,
    eval: false,
    json: false,
    help: false
  };

  const takesValue: Array<{ flag: string; set: (value: string) => void }> = [
    { flag: "--dir", set: (value) => (options.dir = value) },
    { flag: "--name", set: (value) => (options.name = value) },
    { flag: "--agents", set: (value) => (options.agents = parseAgentsList(value)) },
    { flag: "--mode", set: (value) => (options.mode = parseMode(value)) },
    { flag: "--model", set: (value) => (options.model = value) }
  ];

  const booleans: Record<string, () => void> = {
    "--help": () => (options.help = true),
    "-h": () => (options.help = true),
    "--no-llm": () => (options.noLlm = true),
    "--refine": () => (options.refine = true),
    "--force": () => (options.force = true),
    "--no-install": () => (options.noInstall = true),
    "--dry-run": () => (options.dryRun = true),
    "--yes": () => (options.yes = true),
    "-y": () => (options.yes = true),
    "--eval": () => (options.eval = true),
    "--json": () => (options.json = true)
  };

  outer: for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const setBoolean = booleans[arg];

    if (setBoolean) {
      setBoolean();
      continue;
    }

    for (const { flag, set } of takesValue) {
      if (arg === flag) {
        const value = args[i + 1];
        if (!value || value.startsWith("--")) {
          throw new Error(`${flag} requires a value`);
        }
        set(value);
        i += 1;
        continue outer;
      }

      if (arg.startsWith(`${flag}=`)) {
        set(arg.slice(flag.length + 1));
        continue outer;
      }
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown skill new argument: ${arg}`);
    }

    if (options.description !== undefined) {
      throw new Error("skill new takes a single description. Quote it: farrier skill new \"...\"");
    }

    options.description = arg;
  }

  return options;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Best-effort model config load; a broken/absent config falls back to no overrides. */
async function loadModelsConfig(targetDir: string): Promise<ModelsConfig> {
  try {
    return (await loadFarrierConfig({ projectDir: targetDir })).config.models;
  } catch {
    return {};
  }
}

function emit(options: SkillNewCliOptions, result: Record<string, unknown>, lines: string[]): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const line of lines) {
    console.log(line);
  }
}

async function runScaffold(options: SkillNewCliOptions, targetDir: string): Promise<number> {
  const draft = scaffoldSkillDraft({ description: options.description!, nameOverride: options.name });
  const skillDir = join(targetDir, canonicalSkillRoot, draft.name);

  if (!options.force && existsSync(skillDir)) {
    console.error(
      `farrier skill new: ${canonicalSkillRoot}/${draft.name} already exists. Use --force to overwrite or --name to choose another name.`
    );
    return 1;
  }

  if (options.dryRun) {
    emit(options, { name: draft.name, mode: "scaffold", files: draft.files.map((file) => file.path), installed: false, notes: draft.notes, dryRun: true }, [
      `Would write ${draft.files.map((file) => file.path).join(", ")} (nothing written):`,
      "",
      draft.files[0]!.content
    ]);
    return 0;
  }

  if (!options.yes) {
    console.error("farrier skill new: refusing to write without --yes. Use --dry-run to preview.");
    return 1;
  }

  await writeRenderPlan({ targetDir, files: draft.files });
  const notes = [...draft.notes];
  let installed = false;

  if (options.noInstall) {
    notes.push(`Skipped install; run: skills add ./${canonicalSkillRoot} -s ${draft.name} -a claude-code codex -y`);
  } else {
    const install = await installLocalSkill(draft.name, targetDir, options.agents ?? ["claude", "codex"]);

    if (!install.ok) {
      console.error(
        `farrier skill new: scaffold written to ${canonicalSkillRoot}/${draft.name}/ but install failed: ${install.error ?? install.stderr}`
      );
      return 1;
    }

    installed = true;

    if (await recordSkillInManifest(targetDir, `./${canonicalSkillRoot}@${draft.name}`)) {
      notes.push("Recorded in .farrier.json skills.");
    }
  }

  emit(
    options,
    { name: draft.name, mode: "scaffold", files: draft.files.map((file) => file.path), installed, notes },
    [
      `✓ Scaffolded ${canonicalSkillRoot}/${draft.name}/SKILL.md${installed ? " and installed it" : ""}.`,
      "  Edit the TODO sections before relying on it.",
      ...notes.map((note) => `  - ${note}`)
    ]
  );
  return 0;
}

/** Maps a typed reply to an answer: blank = creator decides, a number picks that option, anything else is literal. */
export function resolveRefineAnswer(line: string, options: string[]): string {
  const trimmed = line.trim();

  if (trimmed.length === 0) {
    return "";
  }

  const pick = Number(trimmed);

  if (Number.isInteger(pick) && pick >= 1 && pick <= options.length) {
    return options[pick - 1]!;
  }

  return trimmed;
}

/** A trimmed lowercase "q" ends the grill early — "that's enough, proceed". */
export function isGrillFinish(line: string): boolean {
  return line.trim().toLowerCase() === "q";
}

/**
 * Interactive grill loop: ask the backend for one adaptive question at a time,
 * fold each answer into the running transcript so the next question responds to
 * it. Any failure stops the interview and proceeds with the answers so far —
 * grilling never blocks creation.
 */
async function refineDescription(
  options: SkillNewCliOptions,
  targetDir: string,
  backend: CreateAgent,
  models: ModelsConfig
): Promise<string> {
  const packId = (await detectPacks(targetDir).catch(() => [] as string[]))[0];
  const refineSettings = resolveModelSettings({ models, backend, role: "refine", explicitModel: options.model });

  const stdinLines = (console as unknown as AsyncIterable<string>)[Symbol.asyncIterator]();
  const readLine = async (): Promise<string> => String((await stdinLines.next()).value ?? "");

  const answers: RefineAnswer[] = [];

  for (let questionNumber = 1; questionNumber <= maxGrillQuestions; questionNumber += 1) {
    console.log(
      questionNumber === 1 ? `Asking ${backend} for its first question…` : `${backend} is thinking about your answer…`
    );

    let question: RefineQuestion | null;

    try {
      question = await generateNextGrillQuestion({
        description: options.description!,
        backend,
        targetDir,
        packId,
        priorAnswers: answers,
        questionNumber,
        model: refineSettings.model,
        reasoningEffort: refineSettings.reasoningEffort
      });
    } catch (error) {
      console.log(`Grilling stopped (${errorMessage(error)}); proceeding with ${answers.length} answer(s).`);
      break;
    }

    if (question === null) {
      console.log(
        questionNumber === 1
          ? "No open decisions — the brief is specific enough."
          : "No more questions — the brief is pinned down."
      );
      break;
    }

    console.log(`\n[${questionNumber}/≤${maxGrillQuestions}] ${question.question}`);
    question.options.forEach((option, optionIndex) => {
      console.log(`  ${optionIndex + 1}) ${option}${optionIndex === 0 ? "   (recommended)" : ""}`);
    });
    console.log(
      "  number picks an option · free text is used verbatim · empty = let the creator decide · q = that's enough"
    );
    process.stdout.write("> ");

    const line = await readLine();

    if (isGrillFinish(line)) {
      break;
    }

    answers.push({ question: question.question, answer: resolveRefineAnswer(line, question.options) });
  }

  return applyRefinements(options.description!, answers);
}

function outcomeLines(outcome: SkillCreationOutcome): string[] {
  if (outcome.error) {
    return [`✗ ${outcome.error}`, ...outcome.notes.map((note) => `  - ${note}`)];
  }

  return [
    `✓ Created ${outcome.name}${outcome.installed ? " (installed)" : ""}:`,
    ...outcome.files.map((file) => `    ${file}`),
    ...outcome.notes.map((note) => `  - ${note}`)
  ];
}

export async function runSkillNew(args: string[]): Promise<number> {
  let options: SkillNewCliOptions;

  try {
    options = parseSkillNewArgs(args);
  } catch (error) {
    console.error(`farrier skill new: ${errorMessage(error)}`);
    return 1;
  }

  if (options.help) {
    console.log(skillNewUsage());
    return 0;
  }

  if (!options.description || options.description.trim().length === 0) {
    // Bare `farrier skill new` (optionally with --dir) on a terminal opens the
    // standalone create TUI, mirroring how bare `farrier` opens the wizard.
    // Headless-intent flags keep the hard error instead of surprising a script.
    const headlessIntent = options.json || options.yes || options.noLlm || options.dryRun || options.noInstall;

    if (process.stdout.isTTY === true && !headlessIntent) {
      const { runCreateWizard } = await import("../tui/create-app");
      return runCreateWizard(resolve(options.dir));
    }

    console.error('farrier skill new: a description is required. Usage: farrier skill new "<description>" [--help]');
    return 1;
  }

  const targetDir = resolve(options.dir);

  try {
    if (options.eval && (options.noLlm || (options.mode && options.mode !== "per-agent"))) {
      console.error("farrier skill new: --eval compares per-agent copies; it requires --mode per-agent (not --no-llm).");
      return 1;
    }

    if (options.noLlm) {
      return await runScaffold(options, targetDir);
    }

    if (options.dryRun) {
      console.error("farrier skill new: --dry-run only supports --no-llm scaffolds; delegated authoring cannot dry-run.");
      return 1;
    }

    const availability = await probeAgents();
    const agents = options.agents ?? (["claude", "codex"] as CreateAgent[]).filter((agent) => availability[agent]);

    if (agents.length === 0) {
      console.error(
        "farrier skill new: no agent CLI answered --version. Install claude or codex, pass --agents, or use --no-llm."
      );
      return 1;
    }

    const mode: AuthoringMode | undefined =
      agents.length === 1 ? (agents[0] === "claude" ? "author-claude" : "author-codex") : options.mode;

    if (!mode) {
      console.error(
        "farrier skill new: --mode is required when more than one agent is selected (author-claude, author-codex, or per-agent)."
      );
      return 1;
    }

    const authoringAgents: CreateAgent[] =
      mode === "per-agent" ? agents : [mode === "author-claude" ? "claude" : "codex"];

    for (const agent of authoringAgents) {
      if (!availability[agent]) {
        console.error(`farrier skill new: mode '${mode}' needs the ${agent} CLI, but ${agent} --version failed.`);
        return 1;
      }
    }

    if (!options.yes) {
      console.error("farrier skill new: authoring writes into the target. Refusing without --yes.");
      return 1;
    }

    const models = await loadModelsConfig(targetDir);

    let description = options.description;

    if (options.refine) {
      if (process.stdin.isTTY !== true) {
        console.error("farrier skill new: --refine is interactive and requires a terminal.");
        return 1;
      }

      description = await refineDescription(options, targetDir, authoringAgents[0]!, models);
    }

    // Explicit --model stays on the request (it wins everywhere); config-derived
    // skillCreation settings fill in per backend when no --model was given.
    const outcomes = await createSkills(
      [{ description, agents, mode, nameOverride: options.name, model: options.model }],
      targetDir,
      {
        install: !options.noInstall,
        onCollision: options.force ? async (): Promise<CollisionDecision> => "replace" : undefined,
        modelSettings: {
          claude: resolveModelSettings({ models, backend: "claude", role: "skillCreation" }),
          codex: resolveModelSettings({ models, backend: "codex", role: "skillCreation" })
        }
      }
    );
    const outcome = outcomes[0]!;
    let verdict: SkillEvalVerdict | undefined;
    const evalLines: string[] = [];

    if (options.eval && !outcome.error) {
      const candidate = perAgentEvalCandidates(outcomes)[0];

      if (!candidate) {
        console.error("farrier skill new: --eval needs a per-agent creation with both copies in place.");
        return 1;
      }

      const evalSettings = resolveModelSettings({
        models,
        backend: authoringAgents[0]!,
        role: "eval",
        explicitModel: options.model
      });
      verdict = await evaluatePerAgentSkill({
        targetDir,
        ...candidate,
        backend: authoringAgents[0]!,
        model: evalSettings.model,
        reasoningEffort: evalSettings.reasoningEffort
      });

      const scores = `claude ${verdict.copies.claude.score}/10 · codex ${verdict.copies.codex.score}/10`;
      evalLines.push(
        `Eval recommendation: ${verdict.recommendedWinner} (${scores}) — nothing deleted.`,
        ...(verdict.reportPaths ? [`  Reports: ${verdict.reportPaths.claude} · ${verdict.reportPaths.codex}`] : []),
        `  Apply one with: farrier skill eval ${candidate.skillName} --apply-winner claude|codex|recommended --delete-loser-and-link`
      );
    }

    emit(
      options,
      {
        name: outcome.name,
        mode,
        agents,
        files: outcome.files,
        installed: outcome.installed,
        notes: outcome.notes,
        error: outcome.error,
        eval: verdict
      },
      [...outcomeLines(outcome), ...evalLines]
    );

    return outcome.error ? 1 : 0;
  } catch (error) {
    console.error(`farrier skill new: ${errorMessage(error)}`);
    return 1;
  }
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/tests/project-advice.test.ts
```ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatAdviceReport, parseAdviseArgs } from "../src/cli/advise";
import { adviseProject } from "../src/engine/project-advice";
import type { AdviceCategory } from "../src/engine/advice-types";
import { defaultBackendRunner, type BackendCommandRunner, type BackendCommandRunnerInput } from "../src/engine/backend";

async function projectFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "farrier-project-advice-"));
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await mkdir(join(root, "src", "hooks", "__pycache__"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "# Commands\n\nRun the checks.\n", "utf8");
  await writeFile(join(root, "CLAUDE.md"), "@AGENTS.md\n", "utf8");
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "bun test", check: "tsc --noEmit" }, devDependencies: { typescript: "latest" } }), "utf8");
  await writeFile(join(root, "tests", "unit.test.ts"), "export {};\n", "utf8");
  await writeFile(join(root, ".github", "workflows", "ci.yml"), "name: ci\n", "utf8");
  await writeFile(join(root, "src", "hooks", "__pycache__", "ignored.pyc"), "generated", "utf8");
  return root;
}

function queuedRunner(output: unknown): { runner: BackendCommandRunner; calls: BackendCommandRunnerInput[] } {
  const calls: BackendCommandRunnerInput[] = [];
  return {
    calls,
    runner: async (input) => {
      calls.push(input);
      return { exitCode: 0, stdout: JSON.stringify(output), stderr: "" };
    }
  };
}

function sequentialRunner(outputs: unknown[]): { runner: BackendCommandRunner; calls: BackendCommandRunnerInput[] } {
  const calls: BackendCommandRunnerInput[] = [];
  return {
    calls,
    runner: async (input) => {
      calls.push(input);
      return { exitCode: 0, stdout: JSON.stringify(outputs[calls.length - 1] ?? outputs.at(-1)), stderr: "" };
    }
  };
}

describe("project advice", () => {
  test("profiles code, validates evidence/catalog references, deduplicates, and caps categories", async () => {
    const root = await projectFixture();
    const hook = (id: string, reason: string) => ({
      id: `hooks:${id}`,
      category: "hooks",
      targetVendors: ["claude"],
      reason,
      benefit: "Makes verification consistent while removing a repeated manual step.",
      evidence: ["project:package-scripts"],
      confidence: "high",
      routeId: "hooks:shared-policy"
    });
    const { runner, calls } = queuedRunner({ recommendations: [
      hook("verify", "Run the established checks after changes."),
      hook("protect", "Protect the established project workflow."),
      hook("extra", "A third lower-value hook."),
      hook("verify", "Duplicate id."),
      hook("executable", "```bash\necho unsafe\n```"),
      {
        id: "mcp:unknown",
        category: "mcp",
        targetVendors: ["codex"],
        reason: "Use an invented integration.",
        evidence: ["project:root"],
        confidence: "low",
        routeId: "mcp:codex-project",
        registryRef: "mcp@invented"
      }
    ], coverage: [{ category: "guidance", reason: "The existing shared guidance already covers the observed workflow." }] });

    const progress: string[] = [];
    const controller = new AbortController();
    const report = await adviseProject({
      targetDir: root,
      backend: "claude",
      sessions: "none",
      runner,
      signal: controller.signal,
      search: async () => [],
      onProgress: (event) => progress.push(event.stage)
    });

    expect(report.reportOnly).toBe(true);
    expect(report.sessions.lookback).toBe("7d");
    expect(JSON.stringify(report.profile)).not.toContain("__pycache__");
    expect(report.profile.evidence.find((item) => item.path === "AGENTS.md")?.summary).toContain("headings: Commands");
    expect(report.profile.evidence.find((item) => item.path === "CLAUDE.md")?.summary).toContain("delegates to: AGENTS.md");
    expect(report.recommendations.map((item) => item.id)).toEqual(["hooks:verify", "hooks:protect"]);
    expect(report.coverage).toHaveLength(6);
    expect(report.coverage.find((item) => item.category === "hooks")?.status).toBe("accepted");
    expect(report.coverage.find((item) => item.category === "guidance")?.status).toBe("no-evidence");
    expect(report.coverage.find((item) => item.category === "guidance")?.reason).toContain("already covers");
    expect(report.notes.some((note) => note.includes("beyond the 2 hooks limit"))).toBe(true);
    expect(report.notes.some((note) => note.includes("executable hook content"))).toBe(true);
    expect(report.notes.some((note) => note.includes("mcp:unknown") && note.includes("invalid target vendors"))).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal).toBe(controller.signal);
    expect(calls[0]?.cmd).toContain("--no-session-persistence");
    expect(calls[0]?.stdin).toContain("Never output executable hook code");
    expect(calls[0]?.stdin).toContain("benefit must explain why implementing it is useful");
    expect(calls[0]?.stdin).toContain("A path-only summary proves existence only");
    expect(calls[0]?.stdin).toContain("Aim for 3–8 distinct recommendations overall");
    expect(calls[0]?.stdin).not.toContain('"source":"claude"');
    expect(calls[0]?.stdin).not.toContain('"source":"codex"');
    const human = formatAdviceReport(report);
    for (const recommendation of report.recommendations) {
      expect(human).toContain(recommendation.id);
      expect(human).toContain(recommendation.reason);
      expect(human).toContain(recommendation.benefit);
    }
    expect(human).toContain("report only");
    expect(progress).toEqual(["profile", "sessions", "sessions", "catalog", "backend", "validation", "complete"]);
  });

  test("propagates recommendation backend failure", async () => {
    const root = await projectFixture();
    const runner: BackendCommandRunner = async () => ({ exitCode: 2, stdout: "", stderr: "backend unavailable" });
    expect(adviseProject({ targetDir: root, backend: "claude", sessions: "none", runner, search: async () => [] })).rejects.toThrow(
      "claude backend exited with code 2: backend unavailable"
    );
  });

  test("aborting project advice terminates its running backend process", async () => {
    const root = await projectFixture();
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const runner: BackendCommandRunner = (input) => {
      markStarted?.();
      return defaultBackendRunner({ ...input, cmd: ["sleep", "30"] });
    };
    const beganAt = Date.now();
    const run = adviseProject({
      targetDir: root,
      backend: "claude",
      sessions: "none",
      only: ["guidance"],
      runner,
      signal: controller.signal,
      search: async () => []
    });

    await started;
    controller.abort();

    await expect(run).rejects.toThrow(/claude backend exited with code/);
    expect(Date.now() - beganAt).toBeLessThan(5_000);
  });

  test("falls back to codebase evidence when auto session discovery finds nothing", async () => {
    const root = await projectFixture();
    const { runner } = queuedRunner({ recommendations: [] });
    const report = await adviseProject({
      targetDir: root,
      backend: "claude",
      sessions: "auto",
      sessionEvidence: { sources: [{ source: "claude", count: 0 }, { source: "codex", count: 0 }], signals: [], notes: [] },
      runner,
      search: async () => []
    });

    expect(report.sessions.included).toBe(false);
    expect(report.notes).toContain("No matching project sessions were found; recommendations use codebase evidence only.");
  });

  test("isolates mixed session evidence, targets, artifacts, and funnel counts to the selected provider", async () => {
    for (const provider of ["claude", "codex"] as const) {
      const opposite = provider === "claude" ? "codex" : "claude";
      const root = await projectFixture();
      const selectedId = `session:${provider}:verification:selected`;
      const oppositeId = `session:${opposite}:verification:dominant`;
      const incompatibleId = `session:${provider}:verification:incompatible-target`;
      const { runner, calls } = queuedRunner({ recommendations: [
        {
          id: `guidance:shared-${provider}`,
          category: "guidance",
          targetVendors: [provider],
          reason: `Repeated ${provider} verification should be documented.`,
          benefit: "Keeps the shared workflow visible to the selected provider.",
          evidence: [selectedId],
          confidence: "high",
          routeId: "guidance:agents-md"
        },
        {
          id: "hooks:opposite-provider",
          category: "hooks",
          targetVendors: [opposite],
          reason: `Create an opposite-provider hook.`,
          benefit: "Invalid cross-provider candidate.",
          evidence: [oppositeId],
          confidence: "high",
          routeId: provider === "claude" ? "hooks:codex-hooks-json" : "hooks:claude-settings"
        }
      ], coverage: [] });
      const funnelSource = (source: "claude" | "codex", count: number, visibleEvents: number) => ({
        source, discovered: count, eligible: count, read: count, parsed: count, visibleEvents,
        discarded: { filtering: 0, redaction: 0, deduplication: 0, malformed: 0, limits: 0 }, retainedPatterns: 1
      });
      const report = await adviseProject({
        targetDir: root,
        backend: provider,
        runner,
        search: async () => [],
        sessionEvidence: {
          sources: [{ source: provider, count: 5 }, { source: opposite, count: 41 }],
          signals: [
            { id: selectedId, source: provider, kind: "verification", summary: `${provider}-selected-check`, occurrences: 5, distinctSessions: 5, allowedCategories: ["guidance", "hooks"] },
            { id: incompatibleId, source: provider, kind: "verification", summary: `${provider}-source-${opposite}-only-target`, occurrences: 9, distinctSessions: 9, allowedCategories: ["hooks"], targetVendors: [opposite] },
            { id: oppositeId, source: opposite, kind: "verification", summary: `${opposite}-dominant-check`, occurrences: 41, distinctSessions: 41, allowedCategories: ["guidance", "hooks"] }
          ],
          notes: [],
          funnel: {
            sources: [funnelSource(provider, 5, 5), funnelSource(opposite, 41, 41)],
            visibleEvents: 46,
            recurringPatterns: 2
          }
        }
      });

      expect(report.targets).toEqual([provider]);
      expect(report.sessions.requestedSources).toEqual([provider]);
      expect(report.sessions.sources).toEqual([{ source: provider, count: 5 }]);
      expect(report.sessions.evidence.every((item) => item.source === provider)).toBe(true);
      expect(report.sessions.funnel?.visibleEvents).toBe(5);
      expect(report.sessions.funnel?.recommendation?.patternsSent).toBe(1);
      expect(report.recommendations.map((item) => item.id)).toEqual([`guidance:shared-${provider}`]);
      expect(report.recommendations[0]?.targetVendors).toEqual([provider]);
      expect(report.recommendations[0]?.creates).toEqual([{ vendor: "shared", path: "AGENTS.md", kind: "guidance" }]);
      const prompt = calls[0]?.stdin ?? calls[0]?.cmd.at(-1) ?? "";
      expect(prompt).toContain(`${provider}-selected-check`);
      expect(prompt).toContain(`"targetVendors":["${provider}"]`);
      expect(prompt).not.toContain(`"targetVendors":["${opposite}"]`);
      expect(prompt).not.toContain(`${opposite}-dominant-check`);
      expect(prompt).not.toContain(oppositeId);
      expect(prompt).not.toContain(incompatibleId);
      expect(prompt).not.toContain(`.${opposite}/hooks`);
      expect(prompt).not.toContain(`.${opposite}/agents`);
      expect(JSON.stringify(report.recommendations)).not.toContain(`.${opposite}/`);
    }
  });

  test("rejects explicitly incompatible advice targets and session sources", async () => {
    const root = await projectFixture();
    const { runner } = queuedRunner({ recommendations: [] });
    await expect(adviseProject({ targetDir: root, backend: "claude", targets: ["codex"], runner })).rejects.toThrow("targets must equal the selected backend (claude)");
    await expect(adviseProject({ targetDir: root, backend: "codex", sessionSources: ["claude"], runner })).rejects.toThrow("session sources must equal the selected backend (codex)");
  });

  test("allows up to five recommendations for a focused non-legacy category", async () => {
    const root = await projectFixture();
    const recommendations = Array.from({ length: 6 }, (_, index) => ({
      id: `guidance:route-${index}`,
      category: "guidance",
      targetVendors: ["claude"],
      reason: `Project guidance improvement ${index}.`,
      evidence: ["project:root"],
      confidence: "medium",
      routeId: "guidance:agents-md"
    }));
    const { runner } = queuedRunner({ recommendations });
    const report = await adviseProject({ targetDir: root, backend: "claude", sessions: "none", only: ["guidance"], runner, search: async () => [] });

    expect(report.recommendations).toHaveLength(5);
    expect(report.recommendations[0]?.benefit).toContain("persistent and visible");
    expect(report.notes.some((note) => note.includes("beyond the 5 guidance limit"))).toBe(true);
  });

  test("recovers only omitted evidence-supported categories in an evidence-rich 34-session run", async () => {
    const root = await projectFixture();
    const patterns = [
      { id: "p:verify", kind: "verification", allowedCategories: ["hooks", "guidance", "skills"] },
      { id: "p:correct", kind: "correction", allowedCategories: ["guidance", "skills"] },
      { id: "p:delegate", kind: "delegation", allowedCategories: ["subagents", "skills"] },
      { id: "p:lookup", kind: "external-lookup", allowedCategories: ["mcp", "plugins", "skills"] },
      { id: "p:release", kind: "manual-workflow", allowedCategories: ["skills", "subagents", "hooks"] },
      { id: "p:config", kind: "guidance-edit", allowedCategories: ["guidance", "skills"] }
    ].map((item, index) => ({
      ...item, source: "claude" as const,
      allowedCategories: item.allowedCategories as AdviceCategory[],
      summary: `Recurring actionable pattern ${index}`, occurrences: 6, distinctSessions: 5,
      targetVendors: ["claude" as const]
    }));
    const recommendation = (category: string, evidence: string, routeId: string) => ({
      id: `${category}:fixture`, category, targetVendors: ["claude"],
      reason: `Recurring ${category} evidence supports a bounded improvement.`,
      benefit: `Makes the repeated ${category} workflow more reliable.`, evidence: [evidence], confidence: "high", routeId
    });
    const { runner, calls } = sequentialRunner([
      { recommendations: [recommendation("guidance", "p:correct", "guidance:agents-md")], coverage: [] },
      { recommendations: [
        recommendation("hooks", "p:verify", "hooks:shared-policy"),
        recommendation("skills", "p:release", "skills:agents-shared"),
        recommendation("subagents", "p:delegate", "subagents:cross-vendor"),
        recommendation("mcp", "p:lookup", "mcp:shared-project")
      ], coverage: [] }
    ]);

    const report = await adviseProject({
      targetDir: root, backend: "claude", runner, search: async () => [],
      sessionEvidence: {
        sources: [{ source: "claude", count: 20 }, { source: "codex", count: 14 }], signals: patterns, notes: [],
        funnel: { sources: [], visibleEvents: 187, recurringPatterns: 6 }
      }
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.stdin).toContain("hooks, skills, subagents, plugins, mcp");
    expect(report.recommendations).toHaveLength(5);
    expect(new Set(report.recommendations.map((item) => item.category)).size).toBe(5);
    expect(report.sessions.funnel?.recommendation?.recoveryCalls).toBe(1);
    expect(formatAdviceReport(report)).toContain("20 sessions → 36 visible events → 6 recurring patterns → 5 supported recommendations");
  });

  test("stays sparse without recurring actionable evidence and does not call recovery", async () => {
    const root = await projectFixture();
    const { runner, calls } = sequentialRunner([{ recommendations: [], coverage: [] }]);
    const report = await adviseProject({
      targetDir: root, backend: "claude", runner, search: async () => [],
      sessionEvidence: {
        sources: [{ source: "claude", count: 20 }, { source: "codex", count: 14 }], signals: [], notes: [],
        funnel: { sources: [], visibleEvents: 34, recurringPatterns: 0 }
      }
    });

    expect(calls).toHaveLength(1);
    expect(report.recommendations).toEqual([]);
    expect(report.weakLeads).toEqual([]);
    expect(report.coverage.every((item) => item.status === "no-evidence")).toBe(true);
    expect(formatAdviceReport(report)).toContain("No visible recurring actionable evidence");
  });

  test("moves low-confidence candidates into weak leads with strengthening guidance", async () => {
    const root = await projectFixture();
    const { runner } = queuedRunner({ recommendations: [{
      id: "skills:possible-review", category: "skills", targetVendors: ["claude"],
      reason: "One session requested a review workflow.", benefit: "Could make reviews repeatable.",
      evidence: ["project:root"], confidence: "low", routeId: "skills:agents-shared"
    }], coverage: [] });
    const report = await adviseProject({ targetDir: root, backend: "claude", sessions: "none", runner, search: async () => [] });
    expect(report.recommendations).toEqual([]);
    expect(report.weakLeads?.map((item) => item.id)).toEqual(["skills:possible-review"]);
    const human = formatAdviceReport(report);
    expect(human).toContain("Weak leads");
    expect(human).toContain("Would strengthen: recurrence in another distinct session");
  });

  test("parses complete headless controls and preserves both legacy skill-only spellings", () => {
    const parsed = parseAdviseArgs(["--dir", ".", "--sessions", "none", "--since", "14d", "--targets", "codex", "--only", "guidance,hooks", "--backend", "codex", "--model", "gpt-x", "--json"]);
    expect(parsed.sessions).toBe("none");
    expect(parsed.since).toBe("14d");
    expect(parsed.targets).toEqual(["codex"]);
    expect(parsed.only).toEqual(["guidance", "hooks"]);
    expect(parsed.backend).toBe("codex");
    expect(parsed.model).toBe("gpt-x");
    expect(parsed.json).toBe(true);
    expect(parseAdviseArgs(["skills"]).legacySkills).toBe(true);
    expect(parseAdviseArgs(["--only", "skills"]).legacySkills).toBe(true);
    expect(() => parseAdviseArgs(["--since", "30d"])).toThrow("--since must be 7d, 14d, or all");
    expect(() => parseAdviseArgs(["--targets", "claude,codex"])).toThrow("--targets must be exactly one provider");
  });
});

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/agent-selection.ts
```ts
export const enforcementAgentOrder = ["claude", "codex"] as const;

export type EnforcementAgent = (typeof enforcementAgentOrder)[number];

const enforcementAgentSet = new Set<string>(enforcementAgentOrder);

export function isEnforcementAgent(value: unknown): value is EnforcementAgent {
  return typeof value === "string" && enforcementAgentSet.has(value);
}

export function normalizeAgents(
  value: unknown,
  fallback: readonly EnforcementAgent[] = ["claude"]
): EnforcementAgent[] {
  const candidate = value === undefined ? [...fallback] : value;

  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error("agents must be a non-empty array containing claude, codex, or both");
  }

  if (!candidate.every(isEnforcementAgent)) {
    throw new Error("agents must contain only claude and codex");
  }

  const selected = new Set<EnforcementAgent>(candidate);
  return enforcementAgentOrder.filter((agent) => selected.has(agent));
}

export function parseAgents(value: string): EnforcementAgent[] {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return normalizeAgents(values);
}

export function formatAgents(agents: readonly EnforcementAgent[]): string {
  return normalizeAgents(agents).map((agent) => agent === "claude" ? "Claude" : "Codex").join(" + ");
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/README.md
```md
# 🐴 farrier

**The craftsman who equips your coding agents.**

farrier generates an *agents-first harness* for any project: the hooks, rules, skills, verification verbs, and context files that let Claude Code and Codex work in your repo safely and productively — without you hand-assembling the same setup for the hundredth time.

You pick a stack (or farrier detects it), and farrier writes a complete, tested harness:

- **Hooks that protect** — no reading `.env`, no writing lockfiles, no `pip install` in a uv project (the deny message tells the agent the *right* command instead).
- **Hooks that verify** — `just check` after every edit, structure linting (konpy for Python, konsistent for TypeScript) before the agent yields.
- **Skills that teach** — stack-appropriate skills from [skills.sh](https://skills.sh), pinned in a lockfile.
- **Context that steers** — one `AGENTS.md` source of truth (`CLAUDE.md` imports it via Claude Code's `@AGENTS.md` syntax, so Codex and Claude read the same rules).
- **A harness that evolves** — it detects stack drift, repairs itself, and *learns new rules from your session transcripts*.
- **Enterprise registries** — teams publish private packs, hook payloads, and skill bundles behind namespaced refs (`@acme/demo`); farrier fetches, schema-validates, caches, and pins them exactly like a built-in pack.

Everything is declarative data + tested templates. The LLM never writes hook code; it only proposes data that farrier's tested engine renders.

---

## 5-minute quickstart

Prereqs: [bun](https://bun.sh), [uv](https://docs.astral.sh/uv/) (for Python stacks + hook tests), [just](https://github.com/casey/just) (verification verbs). The [skills](https://www.npmjs.com/package/skills) CLI ships as a farrier dependency (`bun install` pulls it into `node_modules/.bin/skills`), so no global CLI install is required; fetching a skill source can still require network access. Override with `FARRIER_SKILLS_BIN` if you need a different binary.

Run the published CLI with any npm-compatible launcher:

```bash
bunx farrier
pnpm dlx farrier
npx farrier
```

Bare `farrier` on a terminal opens exactly three primary workflows: **⚒ Create a harness**, **✚ Create a skill**, and **✦ Advise this project**. Advice inspects the project and optionally its exact-project Claude/Codex sessions, then reports configuration improvements without changing the project.

Every launcher accepts the same headless flags, for example `bunx farrier --detect --dry-run --dir .`. Bun is still required because the published executable runs Farrier's TypeScript entry point directly.

```bash
cd ~/src/tries/2026-07-02-farrier
bun install
```

### A. New project, interactive (the wizard)

```bash
mkdir ~/src/my-api && cd ~/src/my-api
uv init --package .                                # native generator makes the code
bun run ~/src/tries/2026-07-02-farrier/src/cli.ts  # bare farrier on a TTY = wizard
```

The wizard walks: **Stack → Skills → Create → Hooks → Learn → Review → write**. Claude and Codex enforcement targets are checkboxes at the top of the existing Hooks screen; this does not add another wizard step.

**Navigation (same on every step):**

- **Enter** — continue (on lists it picks the highlighted item; in toggle lists it toggles).
- **Space** — toggle the highlighted item in Skills/Create/Hooks/Learn.
- **Tab** — cycle focus zones: input → list → the button bar at the bottom.
- **Button bar** — `←`/`→` choose between `← Back` / `Next →`, Enter activates; press `↑` (or `←` past the leftmost button) to jump back up to the content.
- **Esc** — always goes back one step (on the first step: exits without writing anything).

Step by step:

- *Stack*: your detected stack is preselected and annotated; Enter continues with it.
- *Skills*: recommended skills are pre-ticked; type to live-search skills.sh; Space/Enter toggles.
- *Hooks*: choose Claude, Codex, or both enforcement targets, then toggle any of the six pre-ticked protections. At least one target remains selected. CLI availability is informational and never removes an option or changes the saved selection.
- *Learn*: opt this project into the self-learning loop (records intent in `.farrier.json`; see the learn walkthrough below).
- *Review*: the same creation plan used by headless mode, including per-file create/merge/unchanged/replace/blocked actions and why each file exists. Enter writes only an accepted plan, then installs skills into `.claude/skills/` and `.agents/skills/` for Claude Code and Codex.

### B. New project, headless (for scripts, CI, or agents driving farrier)

```bash
farrier --detect --dry-run --dir ./existing-repo          # inspect evidence and every planned action
farrier --detect --yes --dir ./existing-repo              # apply a clean detected plan + install skills
farrier --stack python-fastapi --yes --dir ./my-api       # apply a clean explicitly selected plan
farrier --stack python-fastapi --agents codex --yes --dir ./my-api
farrier --stack python-fastapi --agents claude,codex --yes --dir ./my-api
farrier --stack rails --dry-run --json --dir ./app        # machine-readable preview
farrier --stack python-fastapi --yes --no-skills --dir .  # offline: write files, record skills, skip install
```

(When developing from this repository, substitute `bun run src/cli.ts` for `farrier`; `bun link` also makes the checkout available globally.)

Creation is deliberately **plan, then apply**. `--dry-run` shows the selected stack, every detected stack with the signals that actually matched, any selection assumptions, the resulting harness behavior (rules, hooks, commands, skills, judge defaults), and each file's action and purpose. Add `--json` to either preview or apply for the same information as structured output, including machine-readable failures.

`--agents claude|codex|claude,codex` selects native enforcement bindings and defaults to `claude` for backward compatibility. Farrier normalizes the selection into deterministic order and persists it as the non-empty `agents` array in `.farrier.json`. Environment variables, installed CLIs, backend discovery, and fallback behavior never alter that value.

`--yes` by itself accepts only a clean plan: new files, unchanged files, safe `.gitignore` additions, and metadata/permission updates. If an existing file differs, review it in `--dry-run`, then opt into replacement with `--yes --force`; Farrier first copies the old version under `.farrier-staging/backups/<timestamp>/`. Writes are staged, path identities are revalidated, and complete files are committed atomically so symlinks and hard-linked peers are not followed or mutated. If rollback encounters a concurrent edit, Farrier preserves it, retains an ignored recovery backup, and reports the incomplete state instead of overwriting the edit. `--force` cannot bypass unsafe paths such as symlinks, directories where files belong, or non-directory parents. If `.farrier.json` already exists, creation refuses even with `--force` and directs you to `farrier update --dir <target>` so lifecycle settings are not reset.

Headless creation installs the selected pack skills for Claude Code and Codex by default. A failed install is an explicit partial result: harness files remain applied, Farrier reports an exact `skills add ...` retry command for each failure (in human and JSON output), and the process exits nonzero. Use `--no-skills` when deliberately working offline; the selected refs remain in the manifest, but no install or lockfile mutation is attempted.

Some packs declare a native project generator such as `uv init` or `rails new`. Farrier reports that command in the harness behavior summary but does **not** execute it; run the project generator yourself before or after creating the harness as appropriate.

### C. See it work

Open a selected agent in the generated project and try to misbehave:

```
> cat .env
⛔ Blocked secret access. Use .env.example, documented configuration, or ask the user.

> pip install requests
⛔ Do not use pip in this uv-managed project.
   Redirect: Use `uv add <package>`.

> (edit uv.lock directly)
⛔ Lockfiles are owned by their package manager. Use `uv`.
```

Meanwhile every edit triggers `just check`, and when the agent tries to end its turn, the structure linter (`just konpy` on Python, `just konsistent` on TypeScript) verifies the project structure — failures block the stop with actionable feedback, so the agent fixes them before yielding.

For Codex, trust the project and review the exact project hook commands in `/hooks`; command definitions are approved separately by content hash. Matching Codex hooks can run concurrently, so every Farrier hook is independent and the binding does not rely on handler order. See [Codex enforcement coverage](#codex-enforcement-coverage) for the released interception limits.

### How skill search & installs run

The wizard's Skills step is tuned so neither the network nor the skills CLI ever makes you wait twice. Headless creation uses the same installer for the pack's selected defaults unless `--no-skills` is present:

- **Search** is debounced (300 ms), and a superseded keystroke *aborts* the in-flight HTTP request rather than just discarding its result. Results are cached per query for the wizard session, so backspacing to an earlier query renders instantly. Search runs concurrently with agent advise — neither blocks the other.
- **Installs** are grouped by source: one `skills add <source> -s a b c` per source, so each source repo is cloned once no matter how many of its skills you picked. Different sources install concurrently (capped at 4 via [Effect](https://effect.website)).
- **Lockfile repair**: the skills CLI updates `skills-lock.json` with an unlocked read-modify-write, so concurrent installs can drop each other's lock entries. After a multi-source install, farrier verifies the lock and sequentially re-runs any skills whose entries were clobbered — sequential runs can't race, so one repair pass converges.

---

## What got generated (and why each file exists)

For `python-fastapi` with the default Claude-only binding, 33 rendered harness files, plus the selected installed skills and their `skills-lock.json` entries (selecting both agents adds `.codex/hooks.json`):

| File | Job |
|---|---|
| `AGENTS.md` | Source of truth: commands, hard rules, accepted risks. Read by every agent. |
| `CLAUDE.md` | Imports AGENTS.md via Claude Code's `@AGENTS.md` syntax, so its content actually loads into every session (not just an advisory pointer) — keeps Claude + Codex on one ruleset. |
| `.claude/settings.json` | Wires the hooks to Claude Code events. |
| `.codex/hooks.json` | Wires the same shared policy scripts to released Codex hook events when Codex is selected. |
| `.claude/hooks/*.py` + `test_*.py` | The six hooks, each with its pytest suite alongside. |
| `.claude/hooks/tool-policy-rules.json` | **Declarative** wrong-tool rules (this is where `farrier learn` appends). |
| `.claude/hooks/prompts/*.txt` | Versioned prompts for the LLM judges. |
| `.claude/skills/harness-advisor/SKILL.md` | Teaches the in-session agent to manage the harness itself. |
| `.claude/skills/claude-automation-recommender/` | Claude wrapper plus an unchanged, pinned Anthropic reference snapshot with Apache-2.0 attribution, provenance, and SHA-256 hashes. |
| `.agents/skills/farrier-project-advisor/SKILL.md` | Codex-native wrapper for the same shared, report-only advice engine. |
| `justfile` | The stable verbs: `just check` / `test` / `fmt` / `konpy` (Python) or `konsistent` (TypeScript). |
| `konpy.json` / `konsistent.json` | Structure conventions (v1 grammar) enforced at Stop — `konpy.json` on Python, `konsistent.json` on TypeScript. |
| `.farrier.json` | Manifest: selected enforcement agents, packs, hooks, skills, judge config. **Never edit by hand.** |
| `.gitignore` | Gains `.env`, `.env.*`, `!.env.example`. |

With the default Claude-only binding, Rails renders 32 (no structure linter — konpy/konsistent are TS/Python-only) and `generic` renders 27.

Binding files are selected independently: Claude uses `.claude/settings.json`, Codex uses `.codex/hooks.json`, and selecting both emits both. The six scripts, their colocated tests, prompts, and the one canonical `.claude/hooks/tool-policy-rules.json` remain shared; Farrier does not generate a second `.rules` translation. An unselected vendor binding is outside the render/update/doctor inventory, so an existing user-owned file is preserved and left unmanaged.

### The six hooks

| Hook | Event | What it does |
|---|---|---|
| `secret-shield` | PreToolUse | Denies reading `.env*` / private keys (tracked examples like `.env.example` allowed). |
| `tool-policy` | PreToolUse | Denies wrong-tool commands per the declarative rules file; every denial names the right tool. |
| `write-guard` | PreToolUse | Denies writes to lockfiles, `.git/`, `skills-lock.json`, `.farrier.json`. |
| `verb-runner` | PostToolUse + Stop | Runs `just check` after edits; the structure check (`just konpy` / `just konsistent`) at Stop (blocks the stop on failure). |
| `quality-judge` | PostToolUse | Always: warns when a file exceeds `quality.maxFileLines` (500). Optional: haiku judge for gross cohesion violations. |
| `stop-judge` | Stop | Optional: sonnet/gpt-5.5 reviews the whole turn's diff; blocks only *serious* findings. |

**LLM judge tiers ship disabled** — a generated project never surprise-calls an LLM. Enable in `.farrier.json`:

```jsonc
"judge": {
  "perEdit": { "enabled": true, "backend": "claude", "model": "haiku" },
  "stop":    { "enabled": true, "backend": "claude", "model": "sonnet" }   // or "codex" + "gpt-5.5"
}
```

Judge failures follow the selected hook event. PostToolUse quality feedback is non-destructive. A selected Stop judge fails closed on malformed input, invalid configuration, timeout, or internal failure and reports how to retry or disable the judge through Farrier's managed configuration.

### Codex enforcement coverage

Farrier uses the released Codex project-hooks surface, not `.codex/config.toml` or a parallel Codex rules language:

| Codex event | Matcher | Shared Farrier hooks |
|---|---|---|
| `PreToolUse` | `^Bash$` | `secret-shield`, `tool-policy` |
| `PreToolUse` | `^apply_patch$` | `write-guard` |
| `PostToolUse` | `^apply_patch$` | `verb-runner`, `quality-judge` |
| `Stop` | none | `verb-runner`, `stop-judge` |

The coverage boundary matters:

- Released `PreToolUse`/`PostToolUse` interception covers simple Bash and `apply_patch` calls (plus supported MCP tools), but `unified_exec` coverage is incomplete. Native reads, native search, WebSearch, and other non-shell paths are not all intercepted.
- `PostToolUse` feedback can tell Codex what to repair, but it cannot undo a patch or another effect that already happened.
- Project trust and separately approved hook definitions are runtime state. `farrier doctor` validates static files, required Farrier entries, executable shared targets, and allows unrelated user hooks, but it cannot prove trust, administrative policy, enablement, or complete interception. Inspect `/hooks` in Codex.
- Remote registry hooks remain Claude-only because the current registry schema has no explicit Codex event/payload compatibility metadata. Their payload files may be rendered as shared inventory, but they are never inserted into `.codex/hooks.json`.
- `AGENTS.md` and the project verification commands remain mandatory on every path, including paths no hook can intercept.

---

## Living with the harness: the day-2 loop

### `farrier update` — did the project drift?

```bash
farrier update --dir .          # report only
farrier update --dir . --json   # machine-readable
farrier update --dir . --yes    # repair
```

Reports: stack drift (e.g. hotwire files appeared in your Rails repo → suggests JS skills), hook version drift, missing/outdated harness files, unacknowledged secondary findings.

Repair (`--yes`) is deliberately conservative — it restores missing files and overwrites **only farrier-owned files** (hooks, prompts, advisor skill). Selected binding files (`.claude/settings.json` and/or `.codex/hooks.json`) and other files you customize — `AGENTS.md`, `justfile`, `tool-policy-rules.json`, `konpy.json`/`konsistent.json` — are *reported* for manual review when modified, never clobbered; a missing selected binding is restored. Unselected vendor bindings are ignored and preserved. Manifests created before the `agents` field are treated as Claude-only. Update never switches packs and never installs skills without you.

### `farrier learn` — the harness improves itself

The self-learning loop turns *things that went wrong in your sessions* into *rules that prevent them next time* — as declarative data, never generated code.

**How to use it, start to finish:**

1. **Just work.** Use Claude Code in the project normally. Every session is transcribed automatically to `~/.claude/projects/<your-project-path-with-dashes>/*.jsonl` — you don't set anything up. (The wizard's Learn toggle only records intent in `.farrier.json`; learn runs either way.)

2. **After a few sessions, ask farrier what it noticed:**

   ```bash
   farrier learn --dir .
   ```

   It mines the transcripts for Bash commands that were repeatedly denied by hooks or kept failing, then proposes new tool-policy rules. Nothing is written yet — this is report-only. Add `--json` for machine-readable output.

3. **Read the proposals.** Each one is a complete declarative rule — id, regex, deny message, redirect — e.g. after `docker compose up` failed in three sessions:

   ```text
   learn-ban-docker-compose
     pattern:  (^|[;&|()\s])docker\s+compose\b
     message:  Avoid `docker compose` in this project. Learned from repeated failing transcript events.
   ```

   Proposals are validated hard before you ever see them: the regex must compile, the id must be new kebab-case, `tool` must be `"Bash"`. Invalid or duplicate proposals are dropped.

4. **Accept them:**

   ```bash
   farrier learn --dir . --yes
   ```

   Accepted rules are **appended** to `.claude/hooks/tool-policy-rules.json` — existing rules are never modified or removed. The tool-policy hook enforces new rules immediately: the very next time an agent tries the banned command, it gets the deny + redirect.

**Options:**

```bash
farrier learn --dir . --no-llm                      # deterministic only: bans commands that failed ≥2 times
farrier learn --dir . --backend claude --model haiku    # default LLM proposal mode
farrier learn --dir . --backend codex --model gpt-5.5   # or via Codex
farrier learn --dir . --transcripts ./some/dir      # explicit transcript location (tests, other layouts)
```

LLM mode sends the extracted candidates (not your whole transcript) to the backend and falls back to deterministic mode on any failure. Run `farrier doctor --dir .` afterwards if you want confirmation the rules file is still healthy.

### `farrier doctor` — is the harness healthy?

```bash
farrier doctor --dir .          # exit 1 if problems
farrier doctor --dir . --json
```

Static checks: manifest and its non-empty agent selection parse, all selected inventory files exist, executable digests and permissions match, generated hook tests are present, selected Claude/Codex bindings contain their required Farrier entries, every tool-policy regex compiles, skill provenance/cases are reported, and judge/quality config is shape-valid. Doctor does not run hooks or project tests. Unrelated user-authored Codex hooks are allowed. Runtime Codex trust/approval remains a `/hooks` check. Good in CI: `farrier doctor --dir . || exit 1`.

### `farrier advise` — evidence-backed project advice

Farrier deterministically profiles the resolved project directory—stack, languages, tests, CI, services, structure, and existing agent configuration—then recommends high-value guidance, hooks, skills, subagents, plugins, and MCP servers:

```bash
farrier advise --dir .
farrier advise --dir . --sessions none                         # codebase evidence only
farrier advise --dir . --since 14d                             # exact-project sessions from the past 14 days
farrier advise --dir . --since all                             # explicit full-history opt-in
farrier advise --dir . --targets claude,codex
farrier advise --dir . --only guidance,hooks,mcp
farrier advise --dir . --backend codex --model <name> --json
```

With `--sessions auto` (the default), Farrier includes only the past 7 days of exact-project sessions. Use `--since 14d` for a two-week window or `--since all` to opt into full history. Claude JSONL is accepted only from the matching project directory. Codex history is read through Codex App Server: Farrier pages `thread/list` newest-first by `updated_at` with the exact resolved `cwd`, applies the window before any `thread/read`, verifies the returned directory, and calls read-only `thread/read`. It consumes visible prompts, responses, corrections, tool events, failures, and outcomes; reasoning records are ignored. Equivalent events are normalized into bounded patterns with separate occurrence and distinct-session counts. Secrets and personal identifiers are redacted locally, and at most 40 patterns—not complete transcripts—reach the recommendation backend. Evidence selection is balanced across requested sources before the global limit, so one high-volume source cannot starve another. If no matching sessions exist, the same command cleanly falls back to codebase-only analysis.

Session count measures input volume; it does not measure recommendation strength. Recurring actionable patterns across distinct sessions determine strength. Reports expose the full funnel by source—sessions discovered, eligible, read, and parsed; visible events; filtering, redaction, deduplication, malformed-record, and limit drops; recurring patterns; and backend acceptance or rejection. A compact summary such as `34 sessions → 187 visible events → 12 recurring patterns → 5 supported recommendations` makes low-output runs explainable.

The interactive advice workflow starts with a visible **Reasoning backend** picker and shows Claude/Codex counts for **past 7 days**, **past 14 days**, and **all history**. When both backends are available, Claude is initially selected for compatibility and Left/Right switches to Codex; when only one is available, Farrier selects it and labels the other unavailable. Claude selection consumes Claude sessions and targets Claude artifacts; Codex selection consumes Codex sessions and targets Codex artifacts. Compatible shared routes remain available. Move to a visible setup control with Up/Down or Tab, then use Left/Right to change that control's value. In the report, Up/Down selects a recommendation and immediately shows the observed problem, expected value, strongest evidence, and exact artifact Farrier would create. PageUp/PageDown scrolls the full report. The visible action row contains **Create selected** and **Create all (N)**; Left/Right focuses an action and Enter activates it, so individual creation remains the default.

**Create all** coordinates every supported recommendation in the report. Farrier plans file recommendations and authors skill recommendations concurrently, with at most three backend jobs running at once. The backend recorded in `report.backend` authors every job, including skills; target vendors and session sources never select the authoring backend. Model and reasoning settings for that backend are reloaded when the batch starts, and a backend failure is reported without falling back to the other agent. Unsupported/manual routes such as unverified plugin installation are retained in the result as **skipped** with an explanation. Each recommendation shows queued/running progress followed by **planned**, **created**, **skipped**, **failed**, or **cancelled**; retry runs only failed/cancelled work and preserves successful work.

Concurrent backend work does not mean concurrent filesystem commits. Skill-creator output stays in disposable staging and becomes reviewed project files; cancellation before confirmation leaves no project artifact. Farrier rejects different plans for the same path as an explicit conflict instead of choosing a last writer. All conflict-free results appear in one aggregated review with the exact create/update/replace manifest and complete paged content previews. Nothing is written until confirmation. One transaction then applies the reviewed files, retains backups for replacements, detects changes since review, and rolls back on failure. Any creator installation or other lock-sensitive preparation is serialized.

While batch planning/authoring runs, Ctrl+C or Command-Z requests cancellation through the batch's one abort signal, stops queued work, terminates running backend process groups, and waits for all jobs to settle. A cancellation arriving after the atomic file transaction begins does not interrupt it mid-commit; the transaction finishes or rolls back first. OpenTUI exposes Command as the `super` modifier, so the binding is `super+z`, never plain `z`. The host terminal must deliver an enhanced Super-modified key event (for example through the Kitty keyboard protocol); terminals that intercept Command-Z or cannot encode Super will not deliver it, and Ctrl+C remains the portable cancellation key. Headless users continue to choose with `--backend claude|codex`; headless advice remains report-only, progress stages go to stderr, and `--json` stdout remains valid machine-readable JSON.

Every accepted recommendation has a stable ID, category, target vendors, concise evidence-backed reason, distinct expected benefit, validated project/session evidence IDs, confidence, and a catalogued implementation route. The reason says what observed problem or opportunity triggered the recommendation; the benefit says how the user or workflow improves if it is implemented. Registry references must match Farrier's candidate catalog. Malformed, duplicated, unsupported, hallucinated, or over-limit results are dropped with reasons. The normal report is capped at two recommendations per applicable category; a focused single category may return up to five. Every requested category reports one outcome: accepted, no evidence, weak evidence, supported evidence without a route, backend omission, or validation rejection. Low-confidence ideas appear under **Weak leads**, with the missing evidence stated, rather than counting as successful recommendations. When at least three categories have recurring support but the broad response returns fewer than three medium/high-confidence items, Farrier may make one recovery call limited to omitted supported categories; session volume alone never triggers recovery. Hook output is declarative—the LLM never supplies executable hook code.

Advice analysis is always read-only, and headless advice remains report-only. The interactive TUI may create one selected recommendation or a reviewed batch only after opening a separate review screen and receiving explicit confirmation; no report result is applied automatically. Human and JSON output remain two renderings of the same validated report.

The earlier skills.sh advisor remains available through both spellings:

```bash
farrier advise skills --dir . --context ./docs/brief.md
farrier advise --dir . --only skills --backend codex --json
```

It generates registry queries, validates every selected ref against the returned candidates, and also remains available as the optional ★ advice toggle in the harness wizard's Skills step.

### `farrier skill new` — create a skill with each vendor's own skill-creator

Farrier does not own a skill-authoring prompt. It delegates to the vendor's recommended creator — Claude uses the pinned `anthropics/skills` **skill-creator** (installed into the target on first use, refreshed by `skills update`), Codex uses its **built-in `$skill-creator`** (ships with the codex CLI) — then deterministically validates the result (exactly one new kebab-case skill directory, parseable frontmatter, description ≤ 500 chars; frontmatter name repaired to match the directory) and installs it through the same `skills add` path as any third-party skill.

The wizard has a **Create** step (Stack → Skills → Create → Hooks → Learn → Review): describe the skill, check the target agents (`[x] claude [x] codex` — only agents whose CLI answers `--version` are selectable), and when both are checked, pick who authors:

- **Claude authors, install to both** — one canonical `skills/<name>/`, lock-tracked, installed via `skills add ./skills -a claude-code codex`.
- **Codex authors, install to both** — same, codex writes the canonical copy.
- **Each agent authors its own copy** — claude writes `.claude/skills/<name>/`, codex writes `.agents/skills/<name>/`; truest to each vendor, but the copies may diverge and are not lock-tracked.

Vague briefs make dumb skills, so the standalone create flow **asks first**: before authoring, farrier makes one read-only backend call (`claude -p` / `codex exec`) that proposes 2–4 concrete questions about whatever the description leaves open — language, specific libraries, input/output formats — each with recommended options, a "let the creator decide" escape hatch, and free-text input. Escape leaves a focused text field first; outside the field, Escape or `b` finishes the interview with the answers so far. Your answers are folded into the brief as an "Implementation decisions (follow these exactly)" block before it reaches the skill-creator. Toggle it off with the "ask clarifying questions first" checkbox; the wizard's Create step asks the same questions at queue time. Headless `farrier skill new` asks only with `--refine` (interactive: numbers pick options, free text is used verbatim, empty lets the creator decide) — otherwise put the decisions in the description yourself. If the authored skill's directory already exists, the standalone flow and the harness wizard both pause with the shared confirmation grammar: `y` replaces it, while `n` or Escape keeps the existing copy (the new one stays in `.farrier-staging/`); headless replaces only with `--force`.

You don't need the full wizard to create a skill: bare `farrier` opens the three-workflow launcher—**⚒ Create a harness**, **✚ Create a skill**, or **✦ Advise this project**—and bare `farrier skill new` (optionally with `--dir`) on a terminal opens the same standalone create flow directly: describe → check agents → ⚒ Create → per-skill results.

#### Interactive keyboard grammar

| Key | Behavior |
| --- | --- |
| Up / Down | Move through the focused list. |
| Left / Right | Change the value inside the focused control; never change wizard pages. |
| Tab / Shift+Tab | Move between visible focus zones. |
| Space | Toggle the focused option. |
| Enter | Activate the focused row or visible action. |
| Escape / `b` | Leave a text field first, otherwise go back or close the transient screen. |
| `q` | Quit when a text field is not focused. |
| Ctrl+C | Interrupt running work and its child processes; otherwise quit. |
| Command-Z | Cancel advice batch planning/authoring when the terminal delivers OpenTUI's `super+z` event. |
| PageUp / PageDown | Scroll long reports and file previews. |
| `r` | Retry or rerun only. |
| `y` | Confirm replacement, overwrite, deletion, or another destructive operation. |
| `n` / Escape | Reject a destructive operation. |

Every screen renders its hints from the same typed bindings used by its handler. Ordinary letters stay in a focused text field, and Enter in the skill-description field only leaves that field—it cannot submit the workflow. Use Tab to focus the visible **Queue another** or **Create/Next** action, then Enter to activate it.

Queue as many skills as you like with the visible **Queue another** action, then activate **Create**. They are authored **in parallel** — up to 3 agent runs at once, each in its own staging root so runs can't cross-contaminate, with lockfile-touching installs serialized — while a progress screen shows each skill's phase (pinning creator → authoring via claude/codex → validating → installing → ✓/✗). Each run is a full agent session, so expect minutes. Headless:

```bash
farrier skill new "Convert financial tables to markdown before sending them to the LLM" --yes
farrier skill new "Mask PII in outgoing prompts" --agents claude,codex --mode per-agent --yes
farrier skill new "Route queries to docs or the balance API" --name query-router --yes --json
farrier skill new "Log token costs as JSON" --no-llm --yes    # offline scaffold, no agent run
farrier skill eval pii-masker --json                         # compare per-agent copies, read-only
```

`--mode` is required when more than one agent is selected (headless never guesses). Authoring failures never silently downgrade: a failed backend or a malformed result exits 1 with the files left on disk for inspection, and a failed install prints the exact `skills add` retry command. Override the pinned creators with `FARRIER_CREATOR_CLAUDE` / `FARRIER_CREATOR_CODEX` (`<source>@<skillId>`).

When `per-agent` creates both copies successfully, Farrier compares them and asks you to pick a winner. The creation form carries an eval policy (space cycles): **compare & I pick** (default), **compare & auto-apply the winner**, or **skip**. The eval is deliberately bias-hardened: both copies are staged at neutral paths and judged blind — the judge never sees which vendor wrote which — twice with the candidates swapped, using the pinned Anthropic skill-creator's comparator/analyzer guidance; a winner is only recommended when both passes agree, otherwise it's a tie. Per-copy reports land in `.farrier-staging/eval/<name>/` for you to open. The verdict screen then requires an explicit choice — `c` picks Claude, `x` picks Codex, `k` keeps both; there is no silent enter-through — and a picked winner still needs a `y` confirmation before Farrier deletes the losing directory and replaces it with a relative symlink to the survivor (created under the winner's name when the copies chose different names, so both agents keep discovering the skill). Auto-apply only fires on a clear winner, keeps the deleted copy in `.farrier-staging/trash/`, and falls back to the manual screen on a tie. Changed your mind later? `farrier skill eval <name>` reruns the comparison any time (add `--claude-name`/`--codex-name` for diverged copies). Headless mirrors the same safety shape: `farrier skill new ... --eval` folds a read-only verdict into the output, and deletion+symlink always requires both `--apply-winner claude|codex|recommended` and `--delete-loser-and-link` (`recommended` keeps the trash backup and refuses to act on a tie).

### The harness-advisor skill

Every generated project carries `.claude/skills/harness-advisor/SKILL.md`, so the *in-session agent* knows this loop too: it runs `farrier update` when it notices new file types, suggests skills.sh searches for new frameworks, points at `skill-creator` when you repeat yourself, and refuses to hand-edit `.farrier.json`.

Generated projects also carry a Claude automation-recommender wrapper and a Codex-native project-advisor skill. Both delegate to `farrier advise --sessions auto --since 7d` instead of implementing separate transcript or recommendation logic. The Claude skill includes Anthropic's upstream `claude-automation-recommender` from commit `a5c7fb5d86a4cd34c4f47819658654c3d8f08dda` unchanged under `upstream/`, together with every reference file, the Apache-2.0 license, source provenance, and per-file SHA-256 hashes.

---

## Stacks

| `--stack` | Detected from | Notes |
|---|---|---|
| `python-uv` | `pyproject.toml` | Base Python: uv + ruff + pytest + konpy |
| `python-fastapi` | + `fastapi` dep | Adds layering convention (core ⊬ api) |
| `python-lambda-powertools` | + `aws-lambda-powertools` dep | "No live AWS calls in tests" rules |
| `ts-base` | `package.json` + `tsconfig.json` | bun + tsc + upstream konsistent |
| `ts-react-vite` | + `react` & `vite` deps | |
| `ts-nextjs` | + `next` dep | |
| `ts-lambda` | `aws-cdk-lib` dep or `template.yaml`/`samconfig.toml` | |
| `rails` | `Gemfile` with `rails` | No structure linter; **hotwire secondary detection** suggests JS skills |
| `generic` | never auto-detected | Minimal safety harness for any repo; explicit `--stack generic` only |

Detection returns most-specific-first; packs inherit (`python-fastapi extends python-uv`), and adding a stack is a data module in `src/packs/`, not engine code.

---

## Private registries

A team or enterprise can publish its own packs, hook payloads, and skill bundles as static, schema-validated JSON in a private GitHub/GitLab/Bitbucket repo (or any HTTPS endpoint) and reference them by namespaced ref, alongside the built-in stacks:

```jsonc
// farrier.config.json (project) or ~/.config/farrier/config.json (user)
{
  "registries": {
    "@acme": "github:acme/farrier-registry@main"
  }
}
```

```bash
farrier registry list --dir .                     # namespaces + item counts, no payloads executed
farrier --stack @acme/demo --dry-run --dir .       # preview a registry pack before writing anything
farrier --stack @acme/demo --yes --dir .
```

Registries are something the owning team builds and hosts — farrier does not search or browse across them; every item is resolved by its exact ref (`@acme/demo`, `@acme/guard`, `@acme/platform-skills`). Fetches are cached to disk with a sha256 pin recorded in `.farrier.json`, so `farrier update` can report drift and still work offline once a registry pack has been rendered. A complete, schema-valid worked example — pack, hook, and skill bundle — is checked into this repo at [`examples/registries/acme/`](examples/registries/acme/); it's also the fixture `tests/cli-e2e.test.ts` drives the real CLI against. Full schema and trust-model docs: [`docs/registries.md`](docs/registries.md).

For a **private** GitHub/GitLab/Bitbucket repo, export the matching token (`GITHUB_TOKEN`, `GITLAB_TOKEN`, or `BITBUCKET_TOKEN`) before running farrier. If you forget, farrier tells you which one: these hosts return a plain 404 for unauthenticated access to a private repo (to avoid confirming it exists), so a missing token surfaces as *"If this is a private repository, set GITHUB_TOKEN and retry"* rather than a generic not-found error.

---

## Model configuration

The LLM-backed commands (`skill new`, `skill eval`, `advise`, `learn`) pick a model — and, for codex, a reasoning effort — per backend and per role. Set them under a `models` key in the same config files that hold registries: the user config (`${XDG_CONFIG_HOME:-~/.config}/farrier/config.json`) and the project config (`<project>/farrier.config.json`).

```jsonc
{
  "models": {
    "claude": {
      "default": "sonnet",     // fallback for every claude role
      "skillCreation": "opus"  // authoring uses Opus by default
    },
    "codex": {
      "default": { "model": "gpt-5.5", "reasoningEffort": "medium" },
      "skillCreation": { "reasoningEffort": "xhigh" }  // inherits model from default
    }
  }
}
```

Each backend (`claude`, `codex`) takes a `default` plus any of the roles `skillCreation`, `eval`, `refine`, `advise`, `learn`. An entry is either a model-name string or a `{ model?, reasoningEffort? }` object. `reasoningEffort` is one of `minimal | low | medium | high | xhigh` and is **codex-only** — setting it under `claude` is a config error. Unknown backends or role keys are rejected so typos fail fast.

Precedence for a given call, first match wins: **explicit `--model`** → project role entry → project `default` → user role entry → user `default` → built-in defaults. Field resolution is independent: a role can set only `reasoningEffort` and inherit `model` from `default`.

Built-in defaults when nothing is configured: skill creation authors with **Opus** on claude and **high** reasoning effort on codex; every other claude role uses **sonnet**; `learn` falls back to `haiku` (claude) / `gpt-5.5` (codex). Codex is deliberately left with **no default model** — an explicit `--model` for a model your account lacks fails silently, so omitting it lets codex use your account's default (reasoning effort still applies).

---

## Developing farrier itself

```bash
bun test              # engine + CLI + wizard-machine tests
bun run typecheck     # tsc --noEmit
bun run test:hooks    # pytest for the hook templates (needs uv)
bun run check         # all of the above — the verb the harness itself would run
```

Architecture in one breath: **packs are declarative data** (`src/packs/`), the **engine** renders/detects/updates/learns/doctors (`src/engine/`), **hook templates** are self-contained Python scripts with tests (`src/templates/hooks/`), and the **TUI** is a pure reducer (`src/tui/machine.ts`, zero opentui imports) with thin opentui-react components around it.

## Known caveat

Generated Python projects reference konpy as a **local path dependency** (`/Users/ivor/src/tries/2026-07-02-konsistent-python`) while it's being perfected — they only work on this machine for now. Upgrade path: git dependency, then PyPI.

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/advice-apply.ts
```ts
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ReasoningEffort, ResolvedModelSettings } from "../config/farrier-config";
import { applyHarnessChangePlan, inspectHarnessChangePlan, type ApplyHarnessChangePlanResult, type HarnessChangePlan } from "./create-plan";
import { defaultBackendRunner, invokeBackend, type BackendCommandRunner } from "./backend";
import type { AdviceEvidence, AdviceRecommendation, AdviceReport, AdviceVendor } from "./advice-types";
import type { SkillCreationRequest } from "./create-skill";
import { authorSkillCreationPlan } from "./skill-creation-plan";
import type { RenderPlan, RenderedFile } from "./render";
import { compareEvidence, createEvidenceSet, redactEvidence, type BoundedEvidenceSet, type EvidenceComparison } from "./behavior-evidence";

type UnknownRecord = Record<string, unknown>;

export type AdviceCreationFile = RenderedFile & { purpose: string };

export type AdviceCreationPlan = {
  recommendationId: string;
  summary: string;
  files: AdviceCreationFile[];
  evidence?: EvidenceComparison;
};

export type AdviceCreationSupport =
  | { kind: "files"; description: string }
  | { kind: "skill"; description: string }
  | { kind: "unsupported"; description: string };

type PathPolicy = {
  description: string;
  existingPaths: string[];
  accepts: (path: string) => boolean;
};

const exact = (paths: string[]) => (path: string): boolean => paths.includes(path);
const skillPath = (root: string) => (path: string): boolean => new RegExp(`^${root.replaceAll(".", "\\.")}/[a-z0-9]+(?:-[a-z0-9]+)*/(?:SKILL\\.md|evals/cases\\.json|references/[^/]+\\.md|assets/[^/]+)$`).test(path);

function pathPolicy(recommendation: AdviceRecommendation): PathPolicy | undefined {
  switch (recommendation.implementationRoute.id) {
    case "guidance:agents-md":
      return { description: "AGENTS.md only", existingPaths: ["AGENTS.md"], accepts: exact(["AGENTS.md"]) };
    case "guidance:claude-md":
      return { description: "CLAUDE.md only", existingPaths: ["CLAUDE.md"], accepts: exact(["CLAUDE.md"]) };
    case "guidance:codex-config":
    case "hooks:codex-config":
      return { description: ".codex/config.toml only", existingPaths: [".codex/config.toml"], accepts: exact([".codex/config.toml"]) };
    case "hooks:claude-settings":
      return { description: ".claude/settings.json only", existingPaths: [".claude/settings.json"], accepts: exact([".claude/settings.json"]) };
    case "hooks:shared-policy": {
      const paths = [".claude/settings.json", ".codex/config.toml"];
      return { description: "Claude/Codex declarative config only; no scripts", existingPaths: paths, accepts: exact(paths) };
    }
    case "skills:agents-shared":
      return { description: "one shared skill directory", existingPaths: [], accepts: skillPath(".agents/skills") };
    case "skills:claude-local":
      return { description: "one Claude skill directory", existingPaths: [], accepts: skillPath(".claude/skills") };
    case "subagents:claude-agent":
      return { description: "one Claude agent markdown file", existingPaths: [], accepts: (path) => /^\.claude\/agents\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path) };
    case "subagents:codex-agent":
      return { description: ".codex/config.toml only", existingPaths: [".codex/config.toml"], accepts: exact([".codex/config.toml"]) };
    case "subagents:cross-vendor":
      return {
        description: "Claude agent markdown and/or Codex project config",
        existingPaths: [".codex/config.toml"],
        accepts: (path) => path === ".codex/config.toml" || /^\.claude\/agents\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(path)
      };
    case "mcp:claude-project":
      return { description: ".mcp.json only", existingPaths: [".mcp.json"], accepts: exact([".mcp.json"]) };
    case "mcp:codex-project":
      return { description: ".codex/config.toml only", existingPaths: [".codex/config.toml"], accepts: exact([".codex/config.toml"]) };
    case "mcp:shared-project": {
      const paths = [".mcp.json", ".codex/config.toml"];
      return { description: "Claude/Codex project MCP config only", existingPaths: paths, accepts: exact(paths) };
    }
    default:
      return undefined;
  }
}

export function adviceCreationSupport(recommendation: AdviceRecommendation): AdviceCreationSupport {
  if (recommendation.category === "plugins") {
    return { kind: "unsupported", description: "Plugin installation needs a verified marketplace command and is not file-plan safe yet." };
  }
  if (recommendation.category === "skills") {
    return pathPolicy(recommendation)
      ? { kind: "skill", description: "Author with the existing skill-creator workflow, then include its exact files in the batch review." }
      : { kind: "unsupported", description: "This skill route has no constrained, reviewable project destination." };
  }
  const policy = pathPolicy(recommendation);
  return policy
    ? { kind: "files", description: policy.description }
    : { kind: "unsupported", description: "This implementation route has no constrained creator." };
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function secretLike(value: string): boolean {
  return /\bsk-[A-Za-z0-9_-]{12,}\b|\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s,"']{8,}/i.test(value);
}

async function existingFileContext(targetDir: string, policy: PathPolicy): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  for (const path of policy.existingPaths) {
    try {
      const content = (await readFile(resolve(targetDir, path), "utf8")).slice(0, 40_000);
      if (secretLike(content)) throw new Error(`Refusing to send secret-like values from ${path} to the planning backend.`);
      files.push({ path, content });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return files;
}

function evidenceFor(report: AdviceReport, recommendation: AdviceRecommendation): AdviceEvidence[] {
  const byId = new Map([...report.profile.evidence, ...report.sessions.evidence].map((item) => [item.id, item]));
  return recommendation.evidence.flatMap((id) => byId.get(id) ?? []);
}

function planningPrompt(input: {
  dataset: BoundedEvidenceSet<unknown>;
  policy: PathPolicy;
}): string {
  return `Create a reviewed file plan for one Farrier recommendation. Return JSON only:
{"summary":"one sentence","files":[{"path":"relative/path","purpose":"short explanation","content":"complete final file content"}]}

Rules:
- Implement only the selected recommendation and stay within this path policy: ${input.policy.description}.
- Return complete final content, not a patch. Preserve unrelated existing settings exactly.
- Do not include commands to run, markdown fences, commentary, secrets, placeholders for secrets, or generated executable files.
- Hook plans may edit declarative JSON/TOML configuration only and may reference existing project commands; never create hook scripts or inline script bodies.
- JSON files must parse as JSON objects. Skill files must remain inside one skill directory.
- Return 1–8 files, each at most 50,000 characters.

Bounded redacted planning dataset (reuse this digest for any comparison):
${JSON.stringify({ digest: input.dataset.digest, items: input.dataset.items, truncated: input.dataset.truncated })}
`;
}

function safeRelativePath(path: string): boolean {
  return Boolean(path) && !isAbsolute(path) && !path.includes("\0") && !path.split(/[\\/]/).includes("..");
}

function validateJsonFile(path: string, content: string): void {
  if (!path.endsWith(".json")) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Creation plan file '${path}' is not valid JSON.`);
  }
  if (!isRecord(parsed)) throw new Error(`Creation plan file '${path}' must contain a JSON object.`);
}

function assertExistingJsonPreserved(
  existing: Array<{ path: string; content: string }>,
  files: AdviceCreationFile[],
  recommendation: AdviceRecommendation
): void {
  const mutableKeys = recommendation.category === "hooks" ? new Set(["hooks"]) : recommendation.category === "mcp" ? new Set(["mcpServers"]) : new Set<string>();
  for (const current of existing.filter((item) => item.path.endsWith(".json"))) {
    const planned = files.find((file) => file.path === current.path);
    if (!planned) continue;
    const before = JSON.parse(current.content) as UnknownRecord;
    const after = JSON.parse(planned.content) as UnknownRecord;
    for (const [key, value] of Object.entries(before)) {
      if (!mutableKeys.has(key) && JSON.stringify(after[key]) !== JSON.stringify(value)) {
        throw new Error(`Creation plan for '${current.path}' changed unrelated top-level key '${key}'.`);
      }
    }
  }
}

function validateRawPlan(
  raw: unknown,
  recommendation: AdviceRecommendation,
  policy: PathPolicy,
  existing: Array<{ path: string; content: string }>
): AdviceCreationPlan {
  if (!isRecord(raw) || typeof raw.summary !== "string" || !raw.summary.trim() || raw.summary.length > 240 || !Array.isArray(raw.files)) {
    throw new Error("creation backend JSON must contain a concise summary and files array");
  }
  if (raw.files.length < 1 || raw.files.length > 8) throw new Error("creation plan must contain 1–8 files");
  const seen = new Set<string>();
  const files = raw.files.map((value): AdviceCreationFile => {
    if (!isRecord(value) || typeof value.path !== "string" || typeof value.content !== "string" || typeof value.purpose !== "string") {
      throw new Error("every creation plan file needs path, purpose, and content strings");
    }
    const path = value.path.replaceAll("\\", "/");
    if (!safeRelativePath(path) || !policy.accepts(path)) throw new Error(`Creation plan path '${path}' is outside the selected route policy.`);
    if (seen.has(path)) throw new Error(`Creation plan repeats path '${path}'.`);
    if (!value.content || value.content.length > 50_000 || value.content.includes("\0")) throw new Error(`Creation plan content for '${path}' is empty or too large.`);
    if (!value.purpose.trim() || value.purpose.length > 180) throw new Error(`Creation plan purpose for '${path}' is invalid.`);
    if (secretLike(value.content)) throw new Error(`Creation plan content for '${path}' contains a secret-like value.`);
    if (recommendation.category === "hooks" && (/^#!|```/m.test(value.content) || !new Set([".claude/settings.json", ".codex/config.toml"]).has(path))) {
      throw new Error("Hook creation plans may contain declarative configuration only; executable content was rejected.");
    }
    validateJsonFile(path, value.content);
    seen.add(path);
    return { path, content: value.content, purpose: value.purpose.trim() };
  });
  assertExistingJsonPreserved(existing, files, recommendation);
  return { recommendationId: recommendation.id, summary: raw.summary.trim(), files };
}

export async function planAdviceRecommendation(input: {
  report: AdviceReport;
  recommendation: AdviceRecommendation;
  backend: AdviceVendor;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
}): Promise<AdviceCreationPlan> {
  const policy = pathPolicy(input.recommendation);
  if (!policy) throw new Error(adviceCreationSupport(input.recommendation).description);
  const existing = await existingFileContext(input.report.targetDir, policy);
  const dataset = createEvidenceSet({
    workflow: "advice",
    items: [
      { kind: "recommendation", value: input.recommendation },
      { kind: "evidence", value: evidenceFor(input.report, input.recommendation) },
      { kind: "existing", value: existing }
    ],
    maxItemBytes: 16_000,
    maxTotalBytes: 32_000
  });
  const raw = await invokeBackend({
    backend: input.backend,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prompt: planningPrompt({ dataset, policy }),
    targetDir: input.report.targetDir,
    runner: input.runner ?? defaultBackendRunner,
    signal: input.signal,
    ephemeral: true
  });
  const plan = validateRawPlan(raw, input.recommendation, policy, existing);
  const cases = [{ id: input.recommendation.id, outcome: "inconclusive" as const }];
  return { ...plan, evidence: compareEvidence({ beforeSet: dataset, afterSet: dataset, before: cases, after: cases }) };
}

export async function planAdviceSkillRecommendation(input: {
  report: AdviceReport;
  recommendation: AdviceRecommendation;
  request: SkillCreationRequest;
  modelSettings: ResolvedModelSettings;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
  creatorReady?: boolean;
}): Promise<AdviceCreationPlan> {
  const expectedMode = input.report.backend === "claude" ? "author-claude" : "author-codex";
  if (input.request.mode !== expectedMode) {
    throw new Error(`Skill authoring mode must come from the ${input.report.backend} report backend.`);
  }
  const policy = pathPolicy(input.recommendation);
  if (input.recommendation.category !== "skills" || !policy) {
    throw new Error(adviceCreationSupport(input.recommendation).description);
  }
  const outputRoot = input.recommendation.implementationRoute.id === "skills:agents-shared"
    ? ".agents/skills"
    : ".claude/skills";
  const authored = await authorSkillCreationPlan({
    request: { ...input.request, description: redactEvidence(input.request.description) },
    targetDir: input.report.targetDir,
    outputRoot,
    creatorReady: input.creatorReady,
    deps: {
      backendRunner: input.runner,
      signal: input.signal,
      modelSettings: { [input.report.backend]: input.modelSettings }
    }
  });
  const files = authored.files.map((file): AdviceCreationFile => {
    if (!policy.accepts(file.path)) throw new Error(`Authored skill path '${file.path}' is outside the selected route policy.`);
    if (secretLike(file.content)) throw new Error(`Authored skill file '${file.path}' contains a secret-like value.`);
    return { ...file, purpose: `Skill-creator output for ${authored.name}.` };
  });
  const dataset = createEvidenceSet({ workflow: "advice", items: [{ recommendation: input.recommendation, request: redactEvidence(input.request) }] });
  const cases = [{ id: input.recommendation.id, outcome: "inconclusive" as const }];
  return {
    recommendationId: input.recommendation.id,
    summary: `Author ${authored.name} with ${input.report.backend} for reviewed project installation.`,
    files,
    evidence: compareEvidence({ beforeSet: dataset, afterSet: dataset, before: cases, after: cases })
  };
}

function renderPlan(targetDir: string, plan: AdviceCreationPlan): RenderPlan {
  return { targetDir, files: plan.files.map(({ path, content }) => ({ path, content })) };
}

export function inspectAdviceCreationPlan(targetDir: string, plan: AdviceCreationPlan): Promise<HarnessChangePlan> {
  return inspectHarnessChangePlan(renderPlan(targetDir, plan));
}

export function applyAdviceCreationPlan(targetDir: string, plan: AdviceCreationPlan, force: boolean): Promise<ApplyHarnessChangePlanResult> {
  return applyHarnessChangePlan(renderPlan(targetDir, plan), { force, allowExistingHarness: true });
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/tui/advice-actions.ts
```ts
import { resolveModelSettings, type ModelsConfig } from "../config/farrier-config";
import { planAdviceBatch, type AdviceBatchState } from "../engine/advice-batch";
import {
  inspectAdviceCreationPlan,
  planAdviceRecommendation,
  planAdviceSkillRecommendation
} from "../engine/advice-apply";
import type {
  AdviceCategory,
  AdviceRecommendation,
  AdviceReport,
  AdviceSessionLookback
} from "../engine/advice-types";
import { probeAgent, type AgentBackend } from "../engine/backend";
import { ensureCreatorInstalled, type SkillCreationRequest } from "../engine/create-skill";
import { adviseProject, type AdviceProgressEvent, type ProjectAdviceInput } from "../engine/project-advice";
import type { AdviceTuiScope } from "./advise-machine";

function backendName(backend: AgentBackend): "Claude" | "Codex" {
  return backend === "claude" ? "Claude" : "Codex";
}

export function adviceSkillCreationRequest(backend: AgentBackend, recommendation: AdviceRecommendation): SkillCreationRequest {
  return {
    description: `${recommendation.reason}\n\nExpected benefit: ${recommendation.benefit}\n\nImplementation route: ${recommendation.implementationRoute.description}`,
    agents: recommendation.targetVendors,
    mode: backend === "claude" ? "author-claude" : "author-codex",
    nameOverride: recommendation.id.slice(recommendation.id.indexOf(":") + 1)
  };
}

type AdviceWizardActionDependencies = {
  isBackendAvailable: (backend: AgentBackend) => Promise<boolean>;
  advise: (input: ProjectAdviceInput) => Promise<AdviceReport>;
  plan: typeof planAdviceRecommendation;
  planSkill: typeof planAdviceSkillRecommendation;
  inspect: typeof inspectAdviceCreationPlan;
  prepareSkillCreator: typeof ensureCreatorInstalled;
};

export function createAdviceWizardActions(
  input: {
    targetDir: string;
    signal: AbortSignal;
    models?: ModelsConfig;
    loadModels?: () => Promise<ModelsConfig>;
  },
  dependencies: Partial<AdviceWizardActionDependencies> = {}
) {
  const isBackendAvailable = dependencies.isBackendAvailable ?? ((backend: AgentBackend) => probeAgent(backend));
  const runAdvice = dependencies.advise ?? adviseProject;
  const planRecommendation = dependencies.plan ?? planAdviceRecommendation;
  const planSkillRecommendation = dependencies.planSkill ?? planAdviceSkillRecommendation;
  const inspectPlan = dependencies.inspect ?? inspectAdviceCreationPlan;
  const prepareSkillCreator = dependencies.prepareSkillCreator ?? ensureCreatorInstalled;
  const loadModels = input.loadModels ?? (async () => input.models ?? {});
  const requireBackend = async (backend: AgentBackend): Promise<void> => {
    if (await isBackendAvailable(backend)) return;
    throw new Error(`Selected ${backendName(backend)} reasoning backend is unavailable. Return to options and choose another available backend.`);
  };

  return {
    onRun: async (
      backend: AgentBackend,
      includeSessions: boolean,
      lookback: AdviceSessionLookback,
      scope: AdviceTuiScope,
      onProgress: (event: AdviceProgressEvent) => void
    ): Promise<AdviceReport> => {
      await requireBackend(backend);
      const settings = resolveModelSettings({ models: await loadModels(), backend, role: "advise" });
      const report = await runAdvice({
        targetDir: input.targetDir,
        backend,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        sessions: includeSessions ? "auto" : "none",
        lookback,
        targets: [backend],
        only: scope === "all" ? undefined : [scope as AdviceCategory],
        signal: input.signal,
        onProgress
      });
      if (report.backend !== backend) {
        throw new Error(`Selected ${backendName(backend)} reasoning backend returned a report attributed to ${backendName(report.backend)}.`);
      }
      return report;
    },
    onPlan: async (report: AdviceReport, recommendation: AdviceRecommendation) => {
      const backend = report.backend;
      await requireBackend(backend);
      const settings = resolveModelSettings({ models: await loadModels(), backend, role: "advise" });
      const plan = await planRecommendation({
        report,
        recommendation,
        backend,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        signal: input.signal
      });
      return { plan, inspection: await inspectPlan(input.targetDir, plan) };
    },
    onPlanBatch: async (
      report: AdviceReport,
      previous: AdviceBatchState | undefined,
      signal: AbortSignal,
      onProgress: (state: AdviceBatchState) => void
    ): Promise<AdviceBatchState> => {
      const backend = report.backend;
      await requireBackend(backend);
      const models = await loadModels();
      const fileSettings = resolveModelSettings({ models, backend, role: "advise" });
      const skillSettings = resolveModelSettings({ models, backend, role: "skillCreation" });
      let creatorPreparation: Promise<void> | undefined;
      const prepareCreatorOnce = () => {
        creatorPreparation ??= prepareSkillCreator(backend, input.targetDir).then((result) => {
          if (result && !result.ok) {
            throw new Error(`Could not install the ${backend} creator skill (${result.ref}): ${result.error ?? result.stderr}`);
          }
        });
        return creatorPreparation;
      };
      return planAdviceBatch({
        report,
        previous,
        signal,
        onProgress,
        dependencies: {
          planFiles: (recommendation, taskSignal) => planRecommendation({
            report,
            recommendation,
            backend,
            model: fileSettings.model,
            reasoningEffort: fileSettings.reasoningEffort,
            signal: taskSignal
          }),
          planSkill: async (recommendation, taskSignal) => {
            await prepareCreatorOnce();
            if (taskSignal.aborted) throw new Error("cancelled");
            return planSkillRecommendation({
              report,
              recommendation,
              request: adviceSkillCreationRequest(report.backend, recommendation),
              modelSettings: skillSettings,
              signal: taskSignal,
              creatorReady: true
            });
          },
          inspect: (plan) => inspectPlan(input.targetDir, plan)
        }
      });
    }
  };
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/templates/skills/harness-advisor/SKILL.md
```md
---
name: harness-advisor
description: Advise on Farrier harness drift, stack changes, hooks, skills, and update workflow.
---

# Harness Advisor

Use this skill when the user asks about Farrier harness drift, stack changes, generated hooks, skill recommendations, or how to evolve this repository's agent harness.

## Operating rules

- Treat `.farrier.json` as Farrier-owned metadata. Never edit `.farrier.json` by hand.
- Inspect `.farrier.json` for:
  - `farrierVersion`
  - `agents`
  - `packIds`
  - `hookIds`
  - `secondaryAcknowledged`
  - `versions.hooks`
- Prefer Farrier commands over manual edits to generated harness files.
- Ask before running repair commands that write files.

## Drift workflow

1. Run a report-only update check:

   ```bash
   farrier update --dir .
   ```

   If `farrier` is not on PATH, use:

   ```bash
   bunx farrier update --dir .
   ```

2. For structured output, run:

   ```bash
   farrier update --dir . --json
   ```

3. If the user approves repairs, run:

   ```bash
   farrier update --dir . --yes
   ```

4. Explain that update mode:
   - reports stack drift without switching packs automatically,
   - repairs missing files, including a missing selected Claude/Codex binding,
   - applies reviewed Farrier-owned repairs transactionally and reports committed, rolled-back, or incomplete rollback state,
   - reports modified selected binding files and other user-mutable files for manual review,
   - preserves and ignores unselected vendor bindings,
   - acknowledges detected secondary findings,
   - does not install suggested skills automatically.

5. Use `farrier doctor --dir .` for static harness health checks and `farrier learn --dir .` to review transcript-derived tool-policy rule proposals. Doctor does not execute hooks or project tests. Run the generated aggregate check separately.

## Skill recommendations

When new frameworks, file types, or secondary stacks appear:

- Search skills.sh with the CLI:

  ```bash
  skills find <query>
  ```

- Or use the API shape:

  ```text
  GET https://skills.sh/api/search?q=<query>
  ```

- Suggest relevant skills to the user, but do not install them without explicit approval.
- If repeated project-specific manual behavior appears, suggest creating a reusable skill with `skill-creator`.

## Advice boundaries

- Do not invent hook code.
- Do not rewrite Farrier-owned hook templates manually in the project.
- Suggest declarative Farrier updates, skill installation, or `skill-creator` for repeatable behavior.
- Keep user-customized files such as `AGENTS.md`, `CLAUDE.md`, `justfile`, `.gitignore`, selected `.claude/settings.json` / `.codex/hooks.json` bindings, `.claude/hooks/tool-policy-rules.json`, and the structure-check config (`konsistent.json` or `konpy.json`) under manual review when they drift.

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/advice-catalog.ts
```ts
import type { AdviceCategory, AdviceImplementationRoute, AdviceVendor } from "./advice-types";
import type { AdviceArtifact } from "./advice-types";

export type AdviceRouteDefinition = AdviceImplementationRoute & {
  category: AdviceCategory;
  vendors: AdviceVendor[];
};

export type AdviceRegistryEntry = {
  ref: string;
  category: "skills" | "plugins" | "mcp";
  name: string;
  vendors: AdviceVendor[];
};

export const adviceRoutes: AdviceRouteDefinition[] = [
  { id: "guidance:agents-md", category: "guidance", vendors: ["claude", "codex"], description: "Add or refine durable project guidance in AGENTS.md." },
  { id: "guidance:claude-md", category: "guidance", vendors: ["claude"], description: "Add Claude-specific guidance in CLAUDE.md." },
  { id: "guidance:codex-config", category: "guidance", vendors: ["codex"], description: "Add Codex-specific project defaults in .codex/config.toml." },
  { id: "hooks:claude-settings", category: "hooks", vendors: ["claude"], description: "Configure a declarative Claude lifecycle hook in .claude/settings.json; implementation code is intentionally not generated." },
  { id: "hooks:codex-hooks-json", category: "hooks", vendors: ["codex"], description: "Configure a Codex-native hook in .codex/hooks.json with project trust review." },
  { id: "hooks:codex-config", category: "hooks", vendors: ["codex"], description: "Configure a declarative Codex hook in .codex/config.toml; implementation code is intentionally not generated." },
  { id: "hooks:shared-policy", category: "hooks", vendors: ["claude", "codex"], description: "Define one reviewed project policy and connect vendor-specific lifecycle hooks to it." },
  { id: "skills:agents-shared", category: "skills", vendors: ["claude", "codex"], description: "Create or install a shared skill under .agents/skills/<name>/SKILL.md." },
  { id: "skills:claude-local", category: "skills", vendors: ["claude"], description: "Create or install a Claude project skill under .claude/skills/<name>/SKILL.md." },
  { id: "subagents:claude-agent", category: "subagents", vendors: ["claude"], description: "Define a focused Claude subagent under .claude/agents/<name>.md." },
  { id: "subagents:codex-agent", category: "subagents", vendors: ["codex"], description: "Define a focused Codex specialist agent in the project Codex configuration surface." },
  { id: "subagents:cross-vendor", category: "subagents", vendors: ["claude", "codex"], description: "Document one specialist role and render vendor-specific subagent definitions." },
  { id: "plugins:claude-install", category: "plugins", vendors: ["claude"], description: "Review and install the referenced Claude plugin through its verified marketplace." },
  { id: "plugins:codex-install", category: "plugins", vendors: ["codex"], description: "Review and install the referenced Codex plugin through its verified marketplace." },
  { id: "mcp:claude-project", category: "mcp", vendors: ["claude"], description: "Configure the verified MCP server for Claude at project scope." },
  { id: "mcp:codex-project", category: "mcp", vendors: ["codex"], description: "Configure the verified MCP server in the project Codex configuration." },
  { id: "mcp:shared-project", category: "mcp", vendors: ["claude", "codex"], description: "Configure the verified MCP integration at project scope for both vendors." }
];

const routeFiles: Record<string, Partial<Record<AdviceVendor | "shared", string[]>>> = {
  "guidance:agents-md": { shared: ["AGENTS.md"] },
  "guidance:claude-md": { claude: ["CLAUDE.md"] },
  "guidance:codex-config": { codex: [".codex/config.toml"] },
  "hooks:claude-settings": { claude: [".claude/settings.json", ".farrier/hooks/claude_verify.py"] },
  "hooks:codex-hooks-json": { codex: [".codex/hooks.json", ".farrier/hooks/codex_verify.py"] },
  "hooks:codex-config": { codex: [".codex/config.toml", ".farrier/hooks/codex_verify.py"] },
  "hooks:shared-policy": {
    claude: [".claude/settings.json", ".farrier/hooks/claude_verify.py"],
    codex: [".codex/hooks.json", ".farrier/hooks/codex_verify.py"]
  },
  "skills:agents-shared": { shared: [".agents/skills/<name>/SKILL.md"] },
  "skills:claude-local": { claude: [".claude/skills/<name>/SKILL.md"] },
  "subagents:claude-agent": { claude: [".claude/agents/<name>.md"] },
  "subagents:codex-agent": { codex: [".codex/agents/<name>.toml", ".codex/config.toml"] },
  "subagents:cross-vendor": { claude: [".claude/agents/<name>.md"], codex: [".codex/agents/<name>.toml", ".codex/config.toml"] },
  "mcp:claude-project": { claude: [".mcp.json"] },
  "mcp:codex-project": { codex: [".codex/config.toml"] },
  "mcp:shared-project": { claude: [".mcp.json"], codex: [".codex/config.toml"] }
};

export function adviceRouteArtifacts(route: AdviceRouteDefinition, targets: AdviceVendor[]): AdviceArtifact[] {
  const files = routeFiles[route.id] ?? {};
  const kind: AdviceArtifact["kind"] = route.category === "hooks" ? "hook"
    : route.category === "guidance" ? "guidance"
    : route.category === "skills" ? "skill"
    : route.category === "subagents" ? "agent"
    : "config";
  const artifacts = targets.flatMap((vendor) => (files[vendor] ?? []).map((path) => ({ vendor, path, kind })));
  return [...artifacts, ...(files.shared ?? []).map((path) => ({ vendor: "shared" as const, path, kind }))];
}

export const builtinAdviceRegistry: AdviceRegistryEntry[] = [
  { ref: "anthropics/claude-plugins-official@frontend-design", category: "plugins", name: "frontend-design", vendors: ["claude"] },
  { ref: "anthropics/claude-plugins-official@feature-dev", category: "plugins", name: "feature-dev", vendors: ["claude"] },
  { ref: "anthropics/claude-plugins-official@hookify", category: "plugins", name: "hookify", vendors: ["claude"] },
  { ref: "mcp@context7", category: "mcp", name: "Context7", vendors: ["claude", "codex"] },
  { ref: "mcp@playwright", category: "mcp", name: "Playwright", vendors: ["claude", "codex"] },
  { ref: "mcp@github", category: "mcp", name: "GitHub", vendors: ["claude", "codex"] },
  { ref: "mcp@supabase", category: "mcp", name: "Supabase", vendors: ["claude", "codex"] },
  { ref: "mcp@sentry", category: "mcp", name: "Sentry", vendors: ["claude", "codex"] },
  { ref: "mcp@aws", category: "mcp", name: "AWS", vendors: ["claude", "codex"] }
];

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/skill-creation-plan.ts
```ts
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stageSkill, type CreateAgent, type CreateSkillDeps, type SkillCreationRequest } from "./create-skill";
import type { RenderedFile } from "./render";

export type SkillCreationFilePlan = {
  name: string;
  files: RenderedFile[];
  notes: string[];
};

/**
 * Uses the normal skill-creator authoring and validation pipeline, but turns
 * the disposable staging output into reviewable files instead of installing
 * or moving anything into the project before confirmation.
 */
export async function authorSkillCreationPlan(input: {
  request: SkillCreationRequest;
  targetDir: string;
  outputRoot: string;
  deps?: CreateSkillDeps;
  creatorReady?: boolean;
}): Promise<SkillCreationFilePlan> {
  if (input.request.mode === "per-agent") throw new Error("Advice batch skill authoring requires one report backend.");
  if (!input.outputRoot || input.outputRoot.startsWith("/") || input.outputRoot.split(/[\\/]/).includes("..")) {
    throw new Error("Advice batch skill output root must stay inside the target directory.");
  }
  const agent: CreateAgent = input.request.mode === "author-claude" ? "claude" : "codex";
  let staged: Awaited<ReturnType<typeof stageSkill>> | undefined;
  try {
    staged = await stageSkill({
      agent,
      description: input.request.description,
      targetDir: input.targetDir,
      model: input.request.model,
      nameOverride: input.request.nameOverride,
      deps: input.deps ?? {},
      creatorReady: input.creatorReady,
      cleanupOnFailure: true
    });
    const sourcePrefix = `.farrier-output/${staged.validated.name}/`;
    const destinationPrefix = `${input.outputRoot}/${staged.validated.name}/`;
    const files = await Promise.all(staged.validated.files.map(async (path): Promise<RenderedFile> => {
      const bytes = await readFile(join(dirname(staged!.stagingRoot), path));
      const content = bytes.toString("utf8");
      if (!Buffer.from(content, "utf8").equals(bytes)) {
        throw new Error(`Advice batch review does not support binary skill asset '${path}'.`);
      }
      return { path: `${destinationPrefix}${path.slice(sourcePrefix.length)}`, content };
    }));
    return { name: staged.validated.name, files, notes: staged.validated.notes };
  } finally {
    if (staged) await rm(dirname(staged.stagingRoot), { recursive: true, force: true });
  }
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/advise.ts
```ts
import { existsSync } from "node:fs";
import { readFile as readFileText } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultBackendRunner,
  invokeBackend,
  type AgentBackend,
  type BackendCommandRunner,
  type BackendCommandRunnerInput,
  type BackendCommandRunnerOutput
} from "./backend";
import type { ReasoningEffort } from "../config/farrier-config";
import { searchSkills, type SkillSearchResult } from "./skills";

export { detectAgentBackend } from "./backend";

export type AdviseBackend = AgentBackend;

export type SkillRecommendation = {
  ref: string;
  name: string;
  installs: number;
  reason: string;
};

export type ResolvedContext = {
  text: string;
  source: string;
};

export type AdviseDeps = {
  which: (bin: string) => string | null;
  exists: (path: string) => boolean;
  readFile: (path: string) => Promise<string>;
};

const defaultAdviseDeps: AdviseDeps = {
  which: (bin) => Bun.which(bin),
  exists: (path) => existsSync(path),
  readFile: (path) => readFileText(path, "utf8")
};

const contextCharLimit = 16_000;
const detectedContextProbes = ["PRP.md", "PRP.txt", join("docs", "PRP.md")];
const defaultMaxRecommendations = 6;
const maxCandidates = 30;

function truncateContext(text: string): string {
  if (text.length <= contextCharLimit) {
    return text;
  }

  return `${text.slice(0, contextCharLimit)}\n\n[context truncated to ${contextCharLimit} characters]`;
}

export async function resolveContext(input: {
  targetDir: string;
  context?: string;
  deps?: Partial<AdviseDeps>;
}): Promise<ResolvedContext | undefined> {
  const deps = { ...defaultAdviseDeps, ...input.deps };

  if (input.context !== undefined) {
    const asGiven = input.context;

    if (deps.exists(asGiven)) {
      const text = await deps.readFile(asGiven);
      return { text: truncateContext(text), source: `file:${asGiven}` };
    }

    const relativeToTarget = join(input.targetDir, asGiven);

    if (deps.exists(relativeToTarget)) {
      const text = await deps.readFile(relativeToTarget);
      return { text: truncateContext(text), source: `file:${relativeToTarget}` };
    }

    return { text: truncateContext(asGiven), source: "text" };
  }

  for (const probe of detectedContextProbes) {
    const path = join(input.targetDir, probe);

    if (deps.exists(path)) {
      const text = await deps.readFile(path);
      return { text: truncateContext(text), source: `detected:${probe}` };
    }
  }

  return undefined;
}

export type AdviseCommandRunnerInput = BackendCommandRunnerInput;

export type AdviseCommandRunnerOutput = BackendCommandRunnerOutput;

export type AdviseCommandRunner = BackendCommandRunner;

export type AdviseSkillsInput = {
  targetDir: string;
  packId: string;
  contextText: string;
  backend: AdviseBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  maxRecommendations?: number;
  runner?: AdviseCommandRunner;
  search?: (query: string) => Promise<SkillSearchResult[]>;
};

export type AdviseResult = {
  backend: AdviseBackend;
  queries: string[];
  recommendations: SkillRecommendation[];
  notes: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildQueriesPrompt(input: { packId: string; contextText: string }): string {
  return `You are farrier's skill-research assistant. Return JSON only, with this exact shape:
{"queries": ["short search query"]}
- 2 to 4 queries, each 1-4 words, suited to a skills registry search (frameworks, tasks, domains).
- No prose, no markdown, no explanations.
Project stack: ${input.packId}
Project description:
${input.contextText}
`;
}

type CandidateSkill = SkillSearchResult & { ref: string };

function buildRecommendationsPrompt(input: {
  packId: string;
  contextText: string;
  maxRecommendations: number;
  candidates: CandidateSkill[];
}): string {
  const candidateSummaries = input.candidates.map(({ ref, name, installs }) => ({ ref, name, installs }));

  return `You are farrier's skill-recommendation assistant. Return JSON only, with this exact shape:
{"recommendations": [{"ref": "<source>@<skillId>", "reason": "one short sentence"}]}
- Choose at most ${input.maxRecommendations} skills from the candidate list below. Copy ref strings exactly.
- Recommend only skills genuinely useful for this project. If none fit, return {"recommendations": []}.
- No prose, no markdown.
Project stack: ${input.packId}
Project description:
${input.contextText}
Candidates:
${JSON.stringify(candidateSummaries, null, 2)}
`;
}

function extractQueries(parsed: unknown, backend: AdviseBackend): string[] {
  if (!isRecord(parsed) || !Array.isArray(parsed.queries)) {
    throw new Error(`${backend} backend JSON must have shape {"queries":[...]}`);
  }

  return parsed.queries.filter((query): query is string => typeof query === "string" && query.trim().length > 0);
}

function extractRawRecommendations(parsed: unknown, backend: AdviseBackend): unknown[] {
  if (!isRecord(parsed) || !Array.isArray(parsed.recommendations)) {
    throw new Error(`${backend} backend JSON must have shape {"recommendations":[...]}`);
  }

  return parsed.recommendations;
}

async function collectCandidates(
  queries: string[],
  search: (query: string) => Promise<SkillSearchResult[]>
): Promise<{ candidates: CandidateSkill[]; notes: string[] }> {
  const settled = await Promise.allSettled(queries.map((query) => search(query)));
  const byRef = new Map<string, CandidateSkill>();
  const notes: string[] = [];

  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      notes.push(`Search for '${queries[index]}' failed: ${message}`);
      continue;
    }

    for (const result of outcome.value) {
      if (byRef.size >= maxCandidates) {
        break;
      }

      const ref = `${result.source}@${result.skillId}`;

      if (!byRef.has(ref)) {
        byRef.set(ref, { ...result, ref });
      }
    }
  }

  return { candidates: Array.from(byRef.values()), notes };
}

function parseRef(ref: string): { source: string; skillId: string } | undefined {
  const separator = ref.lastIndexOf("@");

  if (separator <= 0 || separator === ref.length - 1) {
    return undefined;
  }

  const source = ref.slice(0, separator);
  const skillId = ref.slice(separator + 1);

  return source && skillId ? { source, skillId } : undefined;
}

function validateRecommendation(
  raw: unknown,
  candidatesByRef: Map<string, CandidateSkill>
): { ok: true; recommendation: SkillRecommendation } | { ok: false; reason: string } {
  if (!isRecord(raw)) {
    return { ok: false, reason: "recommendation must be an object" };
  }

  const ref = typeof raw.ref === "string" ? raw.ref : undefined;

  if (!ref) {
    return { ok: false, reason: "recommendation is missing required string field ref" };
  }

  const reason = typeof raw.reason === "string" && raw.reason.trim().length > 0 ? raw.reason : undefined;

  if (!reason) {
    return { ok: false, reason: `recommendation '${ref}' is missing required string field reason` };
  }

  if (!parseRef(ref)) {
    return { ok: false, reason: `recommendation ref '${ref}' is not shaped <source>@<skillId>` };
  }

  const candidate = candidatesByRef.get(ref);

  if (!candidate) {
    return { ok: false, reason: `recommendation ref '${ref}' is not in the candidate set` };
  }

  return {
    ok: true,
    recommendation: {
      ref,
      name: candidate.name,
      installs: candidate.installs,
      reason
    }
  };
}

export async function adviseSkills(input: AdviseSkillsInput): Promise<AdviseResult> {
  const runner = input.runner ?? defaultBackendRunner;
  const search = input.search ?? searchSkills;
  const maxRecommendations = input.maxRecommendations ?? defaultMaxRecommendations;
  const notes: string[] = [];

  const queriesJson = await invokeBackend({
    backend: input.backend,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prompt: buildQueriesPrompt({ packId: input.packId, contextText: input.contextText }),
    targetDir: input.targetDir,
    runner,
    ephemeral: true
  });

  const queries = extractQueries(queriesJson, input.backend);
  const collected = await collectCandidates(queries, search);
  const candidates = collected.candidates;
  notes.push(...collected.notes);

  if (candidates.length === 0) {
    notes.push("No candidate skills found for the generated queries.");
    return { backend: input.backend, queries, recommendations: [], notes };
  }

  const recommendationsJson = await invokeBackend({
    backend: input.backend,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    prompt: buildRecommendationsPrompt({
      packId: input.packId,
      contextText: input.contextText,
      maxRecommendations,
      candidates
    }),
    targetDir: input.targetDir,
    runner,
    ephemeral: true
  });

  const rawRecommendations = extractRawRecommendations(recommendationsJson, input.backend);
  const candidatesByRef = new Map(candidates.map((candidate) => [candidate.ref, candidate]));
  const recommendations: SkillRecommendation[] = [];

  for (const raw of rawRecommendations) {
    if (recommendations.length >= maxRecommendations) {
      notes.push(`Dropped extra recommendation beyond the ${maxRecommendations} cap.`);
      continue;
    }

    const validated = validateRecommendation(raw, candidatesByRef);

    if (validated.ok) {
      recommendations.push(validated.recommendation);
    } else {
      notes.push(validated.reason);
    }
  }

  return { backend: input.backend, queries, recommendations, notes };
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/templates/skills/claude-automation-recommender/SKILL.md
```md
---
name: claude-automation-recommender
description: Analyze this project and its matching Claude sessions through Farrier, then recommend evidence-backed Claude guidance, hooks, skills, subagents, plugins, and MCP servers without changing the project.
tools: Bash
---

# Claude Automation Recommender

This is Farrier's read-only Claude wrapper around the pinned Anthropic automation-recommender reference in `upstream/`.

## Workflow

1. Run Farrier's shared advice engine from the project root:

   ```bash
   farrier advise --dir . --sessions auto --since 7d --targets claude
   ```

   If `farrier` is not installed globally, use `bunx farrier` or `npx farrier` with the same arguments.

2. For one category, pass one of:

   ```text
   --only guidance
   --only hooks
   --only subagents
   --only plugins
   --only mcp
   ```

   `--only skills` intentionally preserves Farrier's registry-backed skill-only advisor.

3. Use `--since 14d` for a wider recent window or `--since all` only when the user explicitly needs full history. Use `--json` when another tool needs the validated report schema.

## Boundaries

- Farrier resolves the project, profiles the codebase, scopes sessions to the exact project directory, redacts locally, and sends only bounded signals to the selected backend.
- Claude selection consumes and targets Claude evidence only. Codex evidence and Codex-only artifact routes are rejected; compatible shared routes remain.
- Do not read raw transcripts separately or claim access to hidden reasoning.
- Treat the output as a report. Do not install or create any recommendation unless the user makes a separate explicit request.
- Hook recommendations are declarative; the recommendation backend is never allowed to generate executable hook code.
- Claude artifact routes include `CLAUDE.md`, `.claude/settings.json`, `.claude/skills/`, `.claude/agents/`, plugins, and project MCP configuration.

See `UPSTREAM.md` for the exact Anthropic commit, Apache-2.0 attribution, and SHA-256 hashes. The files under `upstream/` are an unchanged reference snapshot; Farrier's shared engine owns execution and validation.

```

File: /Users/ivor/src/tries/2026-07-02-farrier/tests/skill-new-cli.test.ts
```ts
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillEvalArgs } from "../src/cli/skill-eval";
import { isGrillFinish, parseSkillNewArgs, resolveRefineAnswer } from "../src/cli/skill-new";
import { loadFarrierConfig, resolveModelSettings } from "../src/config/farrier-config";
import { createSkill } from "../src/engine/create-skill";
import type { BackendCommandRunner, BackendCommandRunnerInput } from "../src/engine/backend";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-skill-new-"));
}

function repoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

async function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", join(repoRoot(), "src", "cli.ts"), ...args],
    cwd: repoRoot(),
    stdout: "pipe",
    stderr: "pipe"
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);

  return { exitCode, stdout, stderr };
}

describe("parseSkillNewArgs", () => {
  test("takes a positional description and both flag forms", () => {
    const options = parseSkillNewArgs([
      "Extract IBANs",
      "--dir",
      "/tmp/x",
      "--agents=claude,codex",
      "--mode",
      "per-agent",
      "--name=iban-extractor",
      "--model",
      "sonnet",
      "--no-llm",
      "--refine",
      "--force",
      "--no-install",
      "--dry-run",
      "-y",
      "--eval",
      "--json"
    ]);

    expect(options.description).toBe("Extract IBANs");
    expect(options.dir).toBe("/tmp/x");
    expect(options.agents).toEqual(["claude", "codex"]);
    expect(options.mode).toBe("per-agent");
    expect(options.name).toBe("iban-extractor");
    expect(options.model).toBe("sonnet");
    expect(options.noLlm).toBe(true);
    expect(options.refine).toBe(true);
    expect(options.force).toBe(true);
    expect(options.noInstall).toBe(true);
    expect(options.dryRun).toBe(true);
    expect(options.yes).toBe(true);
    expect(options.eval).toBe(true);
    expect(options.json).toBe(true);
  });

  test("resolveRefineAnswer maps blank to creator-decides, numbers to options, text to itself", () => {
    const options = ["pdfplumber", "camelot"];
    expect(resolveRefineAnswer("", options)).toBe("");
    expect(resolveRefineAnswer("  ", options)).toBe("");
    expect(resolveRefineAnswer("1", options)).toBe("pdfplumber");
    expect(resolveRefineAnswer("2", options)).toBe("camelot");
    expect(resolveRefineAnswer("3", options)).toBe("3");
    expect(resolveRefineAnswer("use tabula instead", options)).toBe("use tabula instead");
  });

  test("isGrillFinish treats a bare q (any case, trimmed) as done and nothing else", () => {
    expect(isGrillFinish("q")).toBe(true);
    expect(isGrillFinish(" Q ")).toBe(true);
    expect(isGrillFinish("")).toBe(false);
    expect(isGrillFinish("quit it")).toBe(false);
    expect(isGrillFinish("1")).toBe(false);
  });

  test("rejects unknown flags, second positionals, and bad enum values", () => {
    expect(() => parseSkillNewArgs(["desc", "--wat"])).toThrow("Unknown skill new argument: --wat");
    expect(() => parseSkillNewArgs(["one", "two"])).toThrow("single description");
    expect(() => parseSkillNewArgs(["desc", "--mode", "freestyle"])).toThrow("--mode must be");
    expect(() => parseSkillNewArgs(["desc", "--agents", "claude,cursor"])).toThrow("--agents accepts");
    expect(() => parseSkillNewArgs(["desc", "--dir"])).toThrow("--dir requires a value");
  });
});

describe("parseSkillEvalArgs", () => {
  test("takes a skill name and both flag forms", () => {
    const options = parseSkillEvalArgs([
      "pii-masker",
      "--dir",
      "/tmp/x",
      "--backend=codex",
      "--model",
      "gpt-5",
      "--description=Mask PII",
      "--apply-winner",
      "claude",
      "--delete-loser-and-link",
      "--json"
    ]);

    expect(options.skillName).toBe("pii-masker");
    expect(options.dir).toBe("/tmp/x");
    expect(options.backend).toBe("codex");
    expect(options.model).toBe("gpt-5");
    expect(options.description).toBe("Mask PII");
    expect(options.applyWinner).toBe("claude");
    expect(options.deleteLoserAndLink).toBe(true);
    expect(options.json).toBe(true);
  });

  test("takes per-agent name overrides in both flag forms", () => {
    const options = parseSkillEvalArgs(["pdf-tables", "--claude-name", "pdf-tables", "--codex-name=convert-tables"]);

    expect(options.skillName).toBe("pdf-tables");
    expect(options.claudeName).toBe("pdf-tables");
    expect(options.codexName).toBe("convert-tables");
    expect(() => parseSkillEvalArgs(["pdf-tables", "--codex-name"])).toThrow("--codex-name requires a value");
  });

  test("accepts --apply-winner recommended and still rejects tie", () => {
    expect(parseSkillEvalArgs(["x", "--apply-winner", "recommended"]).applyWinner).toBe("recommended");
    expect(parseSkillEvalArgs(["x", "--apply-winner=codex"]).applyWinner).toBe("codex");
    expect(() => parseSkillEvalArgs(["x", "--apply-winner", "tie"])).toThrow("must be claude, codex, or recommended");
  });

  test("rejects unknown flags, second names, and bad enum values", () => {
    expect(() => parseSkillEvalArgs(["pii-masker", "--wat"])).toThrow("Unknown skill eval argument: --wat");
    expect(() => parseSkillEvalArgs(["one", "two"])).toThrow("single skill name");
    expect(() => parseSkillEvalArgs(["pii-masker", "--backend", "cursor"])).toThrow("--backend must be");
    expect(() => parseSkillEvalArgs(["pii-masker", "--apply-winner", "tie"])).toThrow("--apply-winner must be");
    expect(() => parseSkillEvalArgs(["pii-masker", "--dir"])).toThrow("--dir requires a value");
  });
});

describe("farrier skill new e2e (scaffold paths)", () => {
  test("--eval refuses non-per-agent runs before any authoring", async () => {
    const dir = await tempDir();
    const result = await runCli(["skill", "new", "Summarize PR diffs", "--no-llm", "--yes", "--eval", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--eval compares per-agent copies");
  });

  test("scaffolds a SKILL.md with --no-llm --yes --no-install", async () => {
    const dir = await tempDir();
    const result = await runCli(["skill", "new", "Summarize PR diffs before review", "--no-llm", "--yes", "--no-install", "--dir", dir]);

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);

    const skillMd = await readFile(join(dir, "skills", "summarize-pr-diffs-before-review", "SKILL.md"), "utf8");
    expect(skillMd).toStartWith("---\nname: summarize-pr-diffs-before-review\n");
    expect(skillMd).toContain("description: Summarize PR diffs before review");
    expect(skillMd).toContain("## Steps");
  });

  test("refuses to write without --yes and writes nothing", async () => {
    const dir = await tempDir();
    const result = await runCli(["skill", "new", "Some skill", "--no-llm", "--no-install", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("refusing to write without --yes");
    expect(existsSync(join(dir, "skills"))).toBe(false);
  });

  test("dry-run previews without writing", async () => {
    const dir = await tempDir();
    const result = await runCli(["skill", "new", "Some skill", "--no-llm", "--dry-run", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("skills/some-skill/SKILL.md");
    expect(result.stdout).toContain("nothing written");
    expect(existsSync(join(dir, "skills"))).toBe(false);
  });

  test("collision exits 1 and --force overwrites", async () => {
    const dir = await tempDir();
    const args = ["skill", "new", "Some skill", "--no-llm", "--yes", "--no-install", "--dir", dir];

    expect((await runCli(args)).exitCode).toBe(0);

    const collision = await runCli(args);
    expect(collision.exitCode).toBe(1);
    expect(collision.stderr).toContain("already exists");

    expect((await runCli([...args, "--force"])).exitCode).toBe(0);
  });

  test("honors --name and emits parseable --json", async () => {
    const dir = await tempDir();
    const result = await runCli([
      "skill",
      "new",
      "Whatever text",
      "--no-llm",
      "--yes",
      "--no-install",
      "--name",
      "my-skill",
      "--json",
      "--dir",
      dir
    ]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { name: string; mode: string; files: string[]; installed: boolean };
    expect(parsed.name).toBe("my-skill");
    expect(parsed.mode).toBe("scaffold");
    expect(parsed.files).toEqual(["skills/my-skill/SKILL.md", "skills/my-skill/evals/cases.json"]);
    expect(parsed.installed).toBe(false);
  });

  test("requires a description and rejects unknown skill subcommands", async () => {
    const missing = await runCli(["skill", "new", "--no-llm"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("a description is required");

    const unknown = await runCli(["skill", "delete", "x"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("unknown skill subcommand");

    const help = await runCli(["skill", "new", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("farrier skill new");
  });

  test("skill eval refuses destructive apply without the explicit delete+link flag before backend work", async () => {
    const dir = await tempDir();
    const result = await runCli(["skill", "eval", "pii-masker", "--apply-winner", "claude", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--apply-winner requires --delete-loser-and-link");
  });
});

// The e2e CLI subprocess spawns real claude/codex, so the LLM authoring path has
// no runner injection point. This exercises the exact config→cmd wiring the CLI
// uses (loadFarrierConfig → resolveModelSettings → createSkills deps) while
// injecting a fake backend runner, proving a farrier.config.json on disk drives
// the authoring model.
describe("farrier skill new model config wiring", () => {
  test("a farrier.config.json models entry drives the authoring backend model", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "farrier.config.json"),
      `${JSON.stringify({ models: { claude: { skillCreation: "opus-4-1" } } }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const models = (await loadFarrierConfig({ projectDir: dir, env: { HOME: await tempDir() } })).config.models;
    const modelSettings = {
      claude: resolveModelSettings({ models, backend: "claude", role: "skillCreation" }),
      codex: resolveModelSettings({ models, backend: "codex", role: "skillCreation" })
    };

    const calls: BackendCommandRunnerInput[] = [];
    const runner: BackendCommandRunner = async (input) => {
      calls.push(input);
      const match = `${input.stdin ?? ""} ${input.cmd.join(" ")}`.match(/under (\S+)\/ only/);
      const root = match![1]!;
      await mkdir(join(input.cwd, root, "config-skill", "evals"), { recursive: true });
      await writeFile(
        join(input.cwd, root, "config-skill", "SKILL.md"),
        "---\nname: config-skill\ndescription: Does a thing. Use when testing.\n---\n\nBody.\n",
        "utf8"
      );
      await writeFile(join(input.cwd, root, "config-skill", "evals", "cases.json"), JSON.stringify({ version: 1, cases: [
        { id: "expected", kind: "positive", prompt: "Use it", expectedBehavior: "Use it" },
        { id: "unrelated", kind: "negative", prompt: "Do something else", expectedBehavior: "Do not use it" }
      ] }));
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const outcome = await createSkill(
      { description: "Author from config file", agents: ["claude"], mode: "author-claude" },
      dir,
      { backendRunner: runner, skillsRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }), install: false, modelSettings }
    );

    expect(outcome.error).toBeUndefined();
    const modelIndex = calls[0]!.cmd.indexOf("--model");
    expect(calls[0]!.cmd[modelIndex + 1]).toBe("opus-4-1");
  });
});

```

File: /Users/ivor/src/tries/2026-07-02-farrier/tests/create-skill.test.ts
```ts
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBackendRunner, probeAgents, type BackendCommandRunner, type BackendCommandRunnerInput } from "../src/engine/backend";
import {
  buildAuthoringPrompt,
  createSkill,
  createSkills,
  creatorRef,
  ensureCreatorInstalled,
  installLocalSkill,
  recordSkillInManifest,
  scaffoldSkillDraft,
  slugifySkillName,
  type SkillCreationProgressEvent,
  type SkillCreationRequest
} from "../src/engine/create-skill";
import type { CommandRunner, CommandRunnerInput, ResolveSkillsCommandDeps } from "../src/engine/skills";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-create-skill-"));
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

function recordingSkillsRunner(exitCode = 0): { runner: CommandRunner; calls: CommandRunnerInput[] } {
  const calls: CommandRunnerInput[] = [];
  const runner: CommandRunner = async (input) => {
    calls.push(input);
    return { exitCode, stdout: "", stderr: exitCode === 0 ? "" : "boom" };
  };
  return { runner, calls };
}

function writingBackendRunner(
  write: (input: BackendCommandRunnerInput) => Promise<void>,
  exitCode = 0
): { runner: BackendCommandRunner; calls: BackendCommandRunnerInput[] } {
  const calls: BackendCommandRunnerInput[] = [];
  const runner: BackendCommandRunner = async (input) => {
    calls.push(input);
    await write(input);
    return { exitCode, stdout: "", stderr: exitCode === 0 ? "" : "backend blew up" };
  };
  return { runner, calls };
}

async function writeSkill(dir: string, root: string, name: string, frontmatterName = name, description = "Does a thing. Use when testing."): Promise<void> {
  await mkdir(join(dir, root, name, "evals"), { recursive: true });
  await writeFile(join(dir, root, name, "evals", "cases.json"), JSON.stringify({ version: 1, cases: [
    { id: "expected-use", kind: "positive", prompt: "Use the skill", expectedBehavior: "Use it" },
    { id: "unrelated", kind: "negative", prompt: "Unrelated request", expectedBehavior: "Do not use it" }
  ] }), "utf8");
  await writeFile(
    join(dir, root, name, "SKILL.md"),
    `---\nname: ${frontmatterName}\ndescription: ${description}\n---\n\nBody.\n`,
    "utf8"
  );
}

// Authoring runs write into a per-run staging root that farrier names in the
// prompt; the fake agent reads it back out, like the real one would.
function rootFromPrompt(input: BackendCommandRunnerInput): string {
  const text = `${input.stdin ?? ""} ${input.cmd.join(" ")}`;
  const match = text.match(/under (\S+)\/ only/);

  if (!match) {
    throw new Error("prompt does not name an output root");
  }

  return match[1]!;
}

const skillsBin = "FARRIER_SKILLS_BIN";

describe("create-skill engine", () => {
  test("slugifySkillName kebab-cases text, caps length, and rejects unusable input", () => {
    expect(slugifySkillName("Convert Financial Tables to Markdown!")).toBe("convert-financial-tables-to-markdown");
    expect(slugifySkillName("  PDF -> text  ")).toBe("pdf-text");
    expect(slugifySkillName("???")).toBeUndefined();
    const long = slugifySkillName(`${"a".repeat(70)} tail`);
    expect(long).toBe("a".repeat(64));
  });

  test("probeAgents reports availability from --version exit codes and spawn failures", async () => {
    const runner: BackendCommandRunner = async (input) => {
      if (input.cmd[0] === "claude") {
        return { exitCode: 0, stdout: "1.0.0", stderr: "" };
      }
      throw new Error("codex: command not found");
    };

    expect(await probeAgents(runner)).toEqual({ claude: true, codex: false });

    const failing: BackendCommandRunner = async () => ({ exitCode: 127, stdout: "", stderr: "" });
    expect(await probeAgents(failing)).toEqual({ claude: false, codex: false });
  });

  test("scaffoldSkillDraft derives the name, honors overrides, and emits SKILL.md with cases", () => {
    const draft = scaffoldSkillDraft({ description: "Summarize PR diffs before review" });
    expect(draft.name).toBe("summarize-pr-diffs-before-review");
    expect(draft.files).toHaveLength(2);
    expect(draft.files[0]?.path).toBe("skills/summarize-pr-diffs-before-review/SKILL.md");
    expect(draft.files[0]?.content).toStartWith("---\nname: summarize-pr-diffs-before-review\n");
    expect(draft.files[0]?.content).toContain("Summarize PR diffs before review");
    expect(draft.files[0]?.content).toContain("## Steps");

    expect(scaffoldSkillDraft({ description: "whatever", nameOverride: "my-skill" }).name).toBe("my-skill");
    expect(() => scaffoldSkillDraft({ description: "???" })).toThrow("Could not derive a skill name");
    expect(() => scaffoldSkillDraft({ description: "x", nameOverride: "Not Kebab" })).toThrow("kebab-case");
  });

  test("creatorRef pins anthropics for claude, built-in (none) for codex, env overrides both", () => {
    const previousClaude = process.env.FARRIER_CREATOR_CLAUDE;
    const previousCodex = process.env.FARRIER_CREATOR_CODEX;
    delete process.env.FARRIER_CREATOR_CLAUDE;
    delete process.env.FARRIER_CREATOR_CODEX;

    try {
      expect(creatorRef("claude")).toBe("anthropics/skills@skill-creator");
      expect(creatorRef("codex")).toBeUndefined();

      process.env.FARRIER_CREATOR_CODEX = "openai/skills@skill-creator";
      expect(creatorRef("codex")).toBe("openai/skills@skill-creator");
    } finally {
      restoreEnv("FARRIER_CREATOR_CLAUDE", previousClaude);
      restoreEnv("FARRIER_CREATOR_CODEX", previousCodex);
    }
  });

  test("ensureCreatorInstalled installs claude's creator globally, and skips when already global or pinned", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    const missingGlobally: ResolveSkillsCommandDeps = { which: () => null, exists: () => false };
    const presentGlobally: ResolveSkillsCommandDeps = { which: () => null, exists: () => true };

    try {
      const { runner, calls } = recordingSkillsRunner();
      const result = await ensureCreatorInstalled("claude", dir, runner, missingGlobally);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toEqual(["skills", "add", "anthropics/skills", "-s", "skill-creator", "-a", "claude-code", "-g", "-y"]);
      expect(calls[0]?.cwd).not.toBe(dir);
      expect(calls[0]?.env?.HOME).toStartWith(calls[0]!.cwd);
      expect(result?.ok).toBe(true);

      const global = recordingSkillsRunner();
      const skippedGlobal = await ensureCreatorInstalled("claude", dir, global.runner, presentGlobally);
      expect(global.calls).toEqual([]);
      expect(skippedGlobal?.ok).toBe(true);

      await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
      const again = recordingSkillsRunner();
      const skipped = await ensureCreatorInstalled("claude", dir, again.runner, missingGlobally);
      expect(again.calls).toEqual([]);
      expect(skipped?.ok).toBe(true);

      expect(await ensureCreatorInstalled("codex", dir, again.runner)).toBeUndefined();
      expect(again.calls).toEqual([]);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("buildAuthoringPrompt names each vendor's creator and confines output", () => {
    const claude = buildAuthoringPrompt({ agent: "claude", description: "Extract IBANs", outputRoot: "skills" });
    expect(claude).toContain("Use the skill-creator skill installed in this project");
    expect(claude).toContain("under skills/ only");
    expect(claude).toContain("Extract IBANs");

    const codex = buildAuthoringPrompt({ agent: "codex", description: "Extract IBANs", outputRoot: ".agents/skills", nameOverride: "iban-extractor" });
    expect(codex).toContain("Use the built-in $skill-creator skill");
    expect(codex).toContain("under .agents/skills/ only");
    expect(codex).toContain("Name the skill exactly 'iban-extractor'");
  });

  test("createSkill author-claude authors canonically, installs to the selected agents, and records the manifest", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, ".farrier.json"), JSON.stringify({ farrierVersion: "0.1.0", skills: [] }, null, 2), "utf8");
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "iban-extractor");
      expect(input.cmd[0]).toBe("claude");
      expect(input.cmd).toContain("--permission-mode");
      expect(input.stdin).toContain("Extract IBAN numbers");
    });
    const skills = recordingSkillsRunner();

    const request: SkillCreationRequest = {
      description: "Extract IBAN numbers from user text",
      agents: ["claude", "codex"],
      mode: "author-claude"
    };

    try {
      const outcome = await createSkill(request, dir, { backendRunner: backend.runner, skillsRunner: skills.runner });

      expect(outcome.error).toBeUndefined();
      expect(outcome.name).toBe("iban-extractor");
      expect(outcome.installed).toBe(true);
        expect(outcome.files.sort()).toEqual(["skills/iban-extractor/SKILL.md", "skills/iban-extractor/evals/cases.json"].sort());
      expect(skills.calls).toHaveLength(1);
      expect(skills.calls[0]?.cmd).toEqual(["skills", "add", "./skills", "-s", "iban-extractor", "-a", "claude-code", "codex", "-y"]);
      expect(skills.calls[0]?.cwd).not.toBe(dir);

      const manifest = JSON.parse(await readFile(join(dir, ".farrier.json"), "utf8")) as { skills: string[]; farrierVersion: string };
      expect(manifest.skills).toEqual(["./skills@iban-extractor"]);
      expect(manifest.farrierVersion).toBe("0.1.0");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill author-codex uses codex in workspace-write mode without installing a creator", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "table-to-markdown");
      expect(input.cmd[0]).toBe("codex");
      expect(input.cmd).toContain("workspace-write");
      expect(input.cmd).not.toContain("--model");
    });
    const skills = recordingSkillsRunner();

    try {
      const outcome = await createSkill(
        { description: "Convert tables", agents: ["codex"], mode: "author-codex" },
        dir,
        { backendRunner: backend.runner, skillsRunner: skills.runner }
      );

      expect(outcome.error).toBeUndefined();
      expect(outcome.installed).toBe(true);
      expect(skills.calls).toHaveLength(1);
      expect(skills.calls[0]?.cmd).toEqual(["skills", "add", "./skills", "-s", "table-to-markdown", "-a", "codex", "-y"]);
      expect(skills.calls[0]?.cwd).not.toBe(dir);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill author-claude with no model defaults to opus", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "opus-skill");
      const modelIndex = input.cmd.indexOf("--model");
      expect(modelIndex).toBeGreaterThanOrEqual(0);
      expect(input.cmd[modelIndex + 1]).toBe("opus");
    });

    try {
      const outcome = await createSkill(
        { description: "Author with default model", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: backend.runner, skillsRunner: recordingSkillsRunner().runner }
      );
      expect(outcome.error).toBeUndefined();
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill author-codex with no config uses high reasoning effort and still no --model", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "codex-effort");
      expect(input.cmd.join(" ")).toContain("model_reasoning_effort=high");
      expect(input.cmd).not.toContain("--model");
    });

    try {
      const outcome = await createSkill(
        { description: "Author with codex", agents: ["codex"], mode: "author-codex" },
        dir,
        { backendRunner: backend.runner, skillsRunner: recordingSkillsRunner().runner }
      );
      expect(outcome.error).toBeUndefined();
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill uses deps.modelSettings when the request has no model", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "configured-skill");
      const modelIndex = input.cmd.indexOf("--model");
      expect(input.cmd[modelIndex + 1]).toBe("sonnet");
    });

    try {
      const outcome = await createSkill(
        { description: "Author from config", agents: ["claude"], mode: "author-claude" },
        dir,
        {
          backendRunner: backend.runner,
          skillsRunner: recordingSkillsRunner().runner,
          modelSettings: { claude: { model: "sonnet" } }
        }
      );
      expect(outcome.error).toBeUndefined();
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill request model beats deps.modelSettings", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "explicit-skill");
      const modelIndex = input.cmd.indexOf("--model");
      expect(input.cmd[modelIndex + 1]).toBe("haiku");
    });

    try {
      const outcome = await createSkill(
        { description: "Author with explicit model", agents: ["claude"], mode: "author-claude", model: "haiku" },
        dir,
        {
          backendRunner: backend.runner,
          skillsRunner: recordingSkillsRunner().runner,
          modelSettings: { claude: { model: "sonnet" } }
        }
      );
      expect(outcome.error).toBeUndefined();
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill per-agent legs read their own backend's settings", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "split-skill");

      if (input.cmd[0] === "claude") {
        const modelIndex = input.cmd.indexOf("--model");
        expect(input.cmd[modelIndex + 1]).toBe("sonnet");
        expect(input.cmd.join(" ")).not.toContain("model_reasoning_effort");
      } else {
        const modelIndex = input.cmd.indexOf("--model");
        expect(input.cmd[modelIndex + 1]).toBe("gpt-custom");
        expect(input.cmd.join(" ")).toContain("model_reasoning_effort=low");
      }
    });

    try {
      const outcome = await createSkill(
        { description: "Per-agent split settings", agents: ["claude", "codex"], mode: "per-agent" },
        dir,
        {
          backendRunner: backend.runner,
          skillsRunner: recordingSkillsRunner().runner,
          modelSettings: {
            claude: { model: "sonnet" },
            codex: { model: "gpt-custom", reasoningEffort: "low" }
          }
        }
      );
      expect(outcome.error).toBeUndefined();
      expect(backend.calls).toHaveLength(2);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill per-agent authors one copy per agent in its native root and skips install", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "pii-masker");
    });
    const skills = recordingSkillsRunner();

    try {
      const outcome = await createSkill(
        { description: "Mask PII before sending text out", agents: ["claude", "codex"], mode: "per-agent" },
        dir,
        { backendRunner: backend.runner, skillsRunner: skills.runner }
      );

      expect(outcome.error).toBeUndefined();
      expect(outcome.installed).toBe(false);
        expect(outcome.files.sort()).toEqual([
          ".agents/skills/pii-masker/SKILL.md", ".agents/skills/pii-masker/evals/cases.json",
          ".claude/skills/pii-masker/SKILL.md", ".claude/skills/pii-masker/evals/cases.json"
        ].sort());
      expect(backend.calls).toHaveLength(2);
      expect(skills.calls).toEqual([]);
      expect(outcome.notes.join(" ")).toContain("may diverge");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill per-agent runs legs in parallel and one leg's collision does not stop the other", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
    // Claude's copy already exists from a previous run — its leg must fail
    // with a collision while the codex leg still completes.
    await writeSkill(dir, ".claude/skills", "pii-masker");

    let inFlight = 0;
    let maxInFlight = 0;
    const backend: BackendCommandRunner = async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeSkill(input.cwd, rootFromPrompt(input), "pii-masker");
      inFlight -= 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    try {
      const outcome = await createSkill(
        { description: "Mask PII", agents: ["claude", "codex"], mode: "per-agent" },
        dir,
        { backendRunner: backend, skillsRunner: recordingSkillsRunner().runner }
      );

      expect(maxInFlight).toBe(2);
      expect(outcome.error).toContain("claude: .claude/skills/pii-masker already exists");
      expect(outcome.error).toContain("(codex copy succeeded)");
        expect(outcome.files.sort()).toEqual([".agents/skills/pii-masker/SKILL.md", ".agents/skills/pii-masker/evals/cases.json"].sort());
      expect(await readFile(join(dir, ".agents/skills", "pii-masker", "SKILL.md"), "utf8")).toContain("pii-masker");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill surfaces backend failures and validation errors without silent downgrades", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
    const skills = recordingSkillsRunner();

    try {
      const crashed = writingBackendRunner(async () => {}, 7);
      const crashedOutcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: crashed.runner, skillsRunner: skills.runner }
      );
      expect(crashedOutcome.error).toContain("claude backend exited with code 7");

      const wroteNothing = writingBackendRunner(async () => {});
      const emptyOutcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: wroteNothing.runner, skillsRunner: skills.runner }
      );
      expect(emptyOutcome.error).toContain("did not create a skill directory");

      const wroteTwo = writingBackendRunner(async (input) => {
        const root = rootFromPrompt(input);
        await writeSkill(input.cwd, root, "one-skill");
        await writeSkill(input.cwd, root, "two-skill");
      });
      const twoOutcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: wroteTwo.runner, skillsRunner: skills.runner }
      );
      expect(twoOutcome.error).toContain("more than one directory");
      expect(twoOutcome.error).toContain("one-skill, two-skill");

      const wroteStray = writingBackendRunner(async (input) => {
        const root = rootFromPrompt(input);
        await writeSkill(input.cwd, root, "three-skill");
        await writeFile(join(input.cwd, root, "README.md"), "stray", "utf8");
      });
      const strayOutcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: wroteStray.runner, skillsRunner: skills.runner }
      );
      expect(strayOutcome.error).toContain("loose files under");
      expect(strayOutcome.error).toContain("README.md");

      expect(skills.calls).toEqual([]);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("authoring rejects linked staged files without accepting project mutation", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
    const backend = writingBackendRunner(async (input) => {
      const root = rootFromPrompt(input);
      await mkdir(join(input.cwd, root, "linked-skill"), { recursive: true });
      await writeFile(join(input.cwd, "outside.md"), "---\nname: linked-skill\ndescription: unsafe link\n---\n");
      await symlink(join(input.cwd, "outside.md"), join(input.cwd, root, "linked-skill", "SKILL.md"));
    });
    try {
      const outcome = await createSkill(
        { description: "linked output", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: backend.runner, skillsRunner: recordingSkillsRunner().runner }
      );
      expect(outcome.error).toContain("unsupported symbolic link");
      expect(await Bun.file(join(dir, "skills", "linked-skill", "SKILL.md")).exists()).toBe(false);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill repairs frontmatter name mismatches and truncates oversize descriptions", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "query-router", "Wrong Name", `long. ${"x".repeat(600)}`);
    });
    const skills = recordingSkillsRunner();

    try {
      const outcome = await createSkill(
        { description: "Route queries", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: backend.runner, skillsRunner: skills.runner }
      );

      expect(outcome.error).toBeUndefined();
      expect(outcome.notes.join(" ")).toContain("Repaired frontmatter name");
      expect(outcome.notes.join(" ")).toContain("truncated to 500");

      const rewritten = await readFile(join(dir, "skills", "query-router", "SKILL.md"), "utf8");
      expect(rewritten).toStartWith("---\nname: query-router\n");
      expect(rewritten).toContain("\nBody.\n");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill errors when the agent ignores the requested name and keeps files for inspection", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    let stagingRoot = "";
    const backend = writingBackendRunner(async (input) => {
      stagingRoot = join(input.cwd, rootFromPrompt(input));
      await writeSkill(input.cwd, rootFromPrompt(input), "freestyle-name");
    });

    try {
      const outcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude", nameOverride: "requested-name" },
        dir,
        { backendRunner: backend.runner, skillsRunner: recordingSkillsRunner().runner }
      );

      expect(outcome.error).toContain("requested name was 'requested-name'");
      // Failed validation leaves the staged files in place for inspection.
      expect(await readFile(join(stagingRoot, "freestyle-name", "SKILL.md"), "utf8")).toContain("freestyle-name");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill errors when the canonical destination already exists and keeps staged files", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
    await writeSkill(dir, "skills", "taken-name");

    let stagingRoot = "";
    const backend = writingBackendRunner(async (input) => {
      stagingRoot = join(input.cwd, rootFromPrompt(input));
      await writeSkill(input.cwd, rootFromPrompt(input), "taken-name");
    });

    try {
      const outcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: backend.runner, skillsRunner: recordingSkillsRunner().runner }
      );

      expect(outcome.error).toContain("skills/taken-name already exists");
      expect(await readFile(join(stagingRoot, "taken-name", "SKILL.md"), "utf8")).toContain("taken-name");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill replaces an existing skill when onCollision says replace", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");
    await writeSkill(dir, "skills", "taken-name", "taken-name", "the OLD copy");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "taken-name", "taken-name", "the NEW copy");
    });
    const collisions: string[] = [];

    try {
      const outcome = await createSkill(
        { description: "x", agents: ["claude"], mode: "author-claude" },
        dir,
        {
          backendRunner: backend.runner,
          skillsRunner: recordingSkillsRunner().runner,
          onCollision: async (info) => {
            collisions.push(info.path);
            return "replace";
          }
        }
      );

      expect(outcome.error).toBeUndefined();
      expect(collisions).toEqual(["skills/taken-name"]);
      expect(outcome.notes.join(" ")).toContain("Replaced the existing skills/taken-name");
      expect(await readFile(join(dir, "skills", "taken-name", "SKILL.md"), "utf8")).toContain("the NEW copy");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill reports install failure with a retry command and keeps authored files", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      await writeSkill(input.cwd, rootFromPrompt(input), "latency-timer");
    });
    const skills = recordingSkillsRunner(3);

    try {
      const outcome = await createSkill(
        { description: "Time stages", agents: ["claude"], mode: "author-claude" },
        dir,
        { backendRunner: backend.runner, skillsRunner: skills.runner }
      );

      expect(outcome.installed).toBe(false);
      expect(outcome.name).toBe("latency-timer");
      expect(outcome.error).toContain("install failed");
      expect(outcome.error).toContain("skills add ./skills -s latency-timer -a claude-code -y");
      expect(await readFile(join(dir, "skills", "latency-timer", "SKILL.md"), "utf8")).toContain("latency-timer");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkills authors concurrently, serializes installs, and reports progress", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    let inFlightAuthoring = 0;
    let maxInFlightAuthoring = 0;
    const backend: BackendCommandRunner = async (input) => {
      inFlightAuthoring += 1;
      maxInFlightAuthoring = Math.max(maxInFlightAuthoring, inFlightAuthoring);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const name = `${input.stdin ?? ""}`.match(/Name the skill exactly '([^']+)'/)![1]!;
      await writeSkill(input.cwd, rootFromPrompt(input), name);
      inFlightAuthoring -= 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    let inFlightInstalls = 0;
    let maxInFlightInstalls = 0;
    const skillsRunner: CommandRunner = async () => {
      inFlightInstalls += 1;
      maxInFlightInstalls = Math.max(maxInFlightInstalls, inFlightInstalls);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlightInstalls -= 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const requests: SkillCreationRequest[] = ["alpha-skill", "beta-skill", "gamma-skill"].map((name) => ({
      description: `make ${name}`,
      agents: ["claude"],
      mode: "author-claude",
      nameOverride: name
    }));

    const events: SkillCreationProgressEvent[] = [];

    try {
      const outcomes = await createSkills(requests, dir, { backendRunner: backend, skillsRunner }, (event) => events.push(event));

      expect(outcomes.map((outcome) => outcome.error)).toEqual([undefined, undefined, undefined]);
      expect(outcomes.map((outcome) => outcome.name)).toEqual(["alpha-skill", "beta-skill", "gamma-skill"]);
      expect(maxInFlightAuthoring).toBeGreaterThan(1);
      expect(maxInFlightInstalls).toBe(1);

      const doneEvents = events.filter((event) => event.phase === "done");
      expect(doneEvents).toHaveLength(3);
      expect(events.some((event) => event.phase === "authoring")).toBe(true);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("createSkill streams backend stdout lines into authoring activity progress", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const backend = writingBackendRunner(async (input) => {
      expect(input.cmd).toContain("stream-json");
      input.onStdoutLine?.(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "iban-extractor/SKILL.md" } }] }
        })
      );
      input.onStdoutLine?.(JSON.stringify({ type: "system", subtype: "thinking_tokens" }));
      await writeSkill(input.cwd, rootFromPrompt(input), "iban-extractor");
    });

    const activities: Array<[string, string | undefined, string | undefined]> = [];

    try {
      const outcome = await createSkill(
        { description: "Extract IBANs", agents: ["claude"], mode: "author-claude" },
        dir,
        {
          backendRunner: backend.runner,
          skillsRunner: recordingSkillsRunner().runner,
          progress: (phase, agent, activity) => activities.push([phase, agent, activity])
        }
      );

      expect(outcome.error).toBeUndefined();
      expect(activities).toContainEqual(["authoring", "claude", "Write iban-extractor/SKILL.md"]);
      // Unrenderable lines never surface as activity events.
      expect(activities.filter(([, , activity]) => activity !== undefined)).toHaveLength(1);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("defaultBackendRunner kills the spawned process when the signal aborts", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 50);

    const output = await defaultBackendRunner({ cmd: ["sleep", "30"], cwd: process.cwd(), signal: controller.signal });

    expect(output.exitCode).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);

    const preAborted = await defaultBackendRunner({ cmd: ["sleep", "30"], cwd: process.cwd(), signal: AbortSignal.abort() });
    expect(preAborted.exitCode).toBe(130);
    expect(preAborted.stderr).toContain("cancelled before start");
  });

  test("createSkills reports cancellation for requests once the signal aborts", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    await writeFile(join(dir, "skills-lock.json"), JSON.stringify({ version: 1, skills: { "skill-creator": {} } }), "utf8");

    const controller = new AbortController();
    const backend: BackendCommandRunner = async (input) => {
      // Simulate a long agent run that only ends because the abort killed it.
      controller.abort();
      return { exitCode: 137, stdout: "", stderr: "killed" };
    };

    try {
      const outcomes = await createSkills(
        [
          { description: "first skill", agents: ["claude"], mode: "author-claude" },
          { description: "second skill", agents: ["claude"], mode: "author-claude" },
          { description: "third skill", agents: ["claude"], mode: "author-claude" },
          { description: "fourth skill", agents: ["claude"], mode: "author-claude" }
        ],
        dir,
        { backendRunner: backend, skillsRunner: recordingSkillsRunner().runner, signal: controller.signal }
      );

      expect(outcomes.every((outcome) => outcome.error)).toBe(true);
      expect(outcomes.some((outcome) => outcome.error?.includes("cancelled"))).toBe(true);
      // The fourth request sat behind the concurrency cap and must be skipped, not started.
      expect(outcomes[3]?.error).toBe("cancelled before start");
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("installLocalSkill shells out with the mapped agent ids", async () => {
    const dir = await tempDir();
    const previousBin = process.env[skillsBin];
    process.env[skillsBin] = "skills";
    const { runner, calls } = recordingSkillsRunner();

    try {
      const result = await installLocalSkill("my-skill", dir, ["claude"], runner);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toEqual(["skills", "add", "./skills", "-s", "my-skill", "-a", "claude-code", "-y"]);
      expect(calls[0]?.cwd).not.toBe(dir);
      expect(result.ok).toBe(true);
    } finally {
      restoreEnv(skillsBin, previousBin);
    }
  });

  test("recordSkillInManifest appends once, preserves fields, and returns false without a manifest", async () => {
    const dir = await tempDir();
    expect(await recordSkillInManifest(dir, "./skills@a")).toBe(false);

    await writeFile(
      join(dir, ".farrier.json"),
      JSON.stringify({ farrierVersion: "0.1.0", packIds: ["python"], skills: ["owner/repo@x"] }, null, 2),
      "utf8"
    );

    expect(await recordSkillInManifest(dir, "./skills@a")).toBe(true);
    expect(await recordSkillInManifest(dir, "./skills@a")).toBe(true);

    const manifest = JSON.parse(await readFile(join(dir, ".farrier.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.skills).toEqual(["owner/repo@x", "./skills@a"]);
    expect(manifest.packIds).toEqual(["python"]);
  });
});

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/execution-isolation.ts
```ts
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type IsolationMode = "native-confinement" | "staged-best-effort";

export type IsolationFact = {
  mode: IsolationMode;
  residualRisk: string | null;
};

export type IsolatedExecutionContext = {
  workspace: string;
  environment: Record<string, string>;
  signal: AbortSignal;
  isolation: IsolationFact;
};

export type IsolatedInput = { source: string; path: string };

const environmentAllowlist = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "SHELL", "USER", "SSL_CERT_FILE", "SSL_CERT_DIR"] as const;

function scrubbedEnvironment(
  workspace: string,
  passthrough: readonly string[],
  overrides: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: join(workspace, "home"),
    TMPDIR: join(workspace, "tmp"),
  };
  for (const name of [...environmentAllowlist, ...passthrough]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value) environment[name] = value;
  }
  return environment;
}

async function copyRegular(source: string, destination: string): Promise<void> {
  const stats = await lstat(source);
  if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) throw new Error(`Isolation input is not a regular file or tree: ${source}`);
  if (stats.isFile()) {
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, await readFile(source));
    return;
  }
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) await copyRegular(join(source, entry.name), join(destination, entry.name));
}

async function targetDigest(root: string, ignoredTopLevel = new Set<string>()): Promise<string> {
  const digest = createHash("sha256");
  const walk = async (path: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!prefix && ignoredTopLevel.has(entry.name)) continue;
      const child = join(path, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stats = await lstat(child, { bigint: true });
      digest.update(`${relative}\0${stats.dev.toString()}\0${stats.ino.toString()}\0${stats.mode.toString()}\0${stats.size.toString()}\0${stats.mtimeNs.toString()}\0${stats.ctimeNs.toString()}\0`);
      if (stats.isSymbolicLink()) digest.update(await readlink(child));
      else if (stats.isDirectory()) await walk(child, relative);
    }
  };
  await walk(root, "");
  return digest.digest("hex");
}

function combinedAbort(parent: AbortSignal | undefined, timeoutMs: number): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new Error("cancelled"));
  parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`external execution timed out after ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();
  return {
    controller,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

export async function withIsolatedExecution<T>(input: {
  targetDir: string;
  inputs?: IsolatedInput[];
  nativeConfinement: boolean;
  /** Caller-specific credential/config names copied from the ambient environment. */
  environmentPassthrough?: readonly string[];
  /** Caller-specific explicit config paths; values are never logged. */
  environmentOverrides?: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
  signal?: AbortSignal;
  retainWorkspace?: boolean;
  retainWorkspaceOnError?: boolean;
  readOnlyWorkspace?: boolean;
  run: (context: IsolatedExecutionContext) => Promise<T>;
}): Promise<{ value: T; isolation: IsolationFact }> {
  const workspace = await mkdtemp(join(tmpdir(), `farrier-exec-${process.pid}-${randomUUID().slice(0, 8)}-`));
  const before = await targetDigest(input.targetDir);
  const timeout = combinedAbort(input.signal, input.timeoutMs ?? 120_000);
  const isolation: IsolationFact = input.nativeConfinement
    ? { mode: "native-confinement", residualRisk: null }
    : {
        mode: "staged-best-effort",
        residualRisk: "The installed CLI has no supported native write-root confinement; output was staged and the target fingerprint was verified, but the process retained OS-user access.",
      };
  let succeeded = false;
  try {
    await mkdir(join(workspace, "home"), { recursive: true });
    await mkdir(join(workspace, "tmp"), { recursive: true });
    for (const item of input.inputs ?? []) await copyRegular(item.source, join(workspace, item.path));
    const workspaceBefore = input.readOnlyWorkspace
      ? await targetDigest(workspace, new Set(["home", "tmp"]))
      : undefined;
    const execution = input.run({
      workspace,
      environment: scrubbedEnvironment(
        workspace,
        input.environmentPassthrough ?? [],
        input.environmentOverrides ?? {},
      ),
      signal: timeout.controller.signal,
      isolation
    });
    const timed = new Promise<never>((_, reject) => {
      timeout.controller.signal.addEventListener("abort", () => reject(timeout.controller.signal.reason ?? new Error("external execution cancelled")), { once: true });
    });
    const value = await Promise.race([execution, timed]);
    if (workspaceBefore && await targetDigest(workspace, new Set(["home", "tmp"])) !== workspaceBefore) {
      throw new Error("External process changed read-only staged inputs or produced unexpected output.");
    }
    const after = await targetDigest(input.targetDir);
    if (after !== before) throw new Error("External process changed the target project; staged output was rejected and the project must be reviewed for unaccepted writes.");
    succeeded = true;
    return { value, isolation };
  } finally {
    timeout.dispose();
    if (!input.retainWorkspace || (!succeeded && !input.retainWorkspaceOnError)) {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/justfile
```
check:
  uv run --with ruff ruff check . && uv run pytest

test:
  uv run pytest

fmt:
  uv run ruff format .

konsistent:
  bun run konsistent

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/tui/advise-machine.ts
```ts
import { adviceCategories, adviceSessionLookbacks, type AdviceCategory, type AdviceReport, type AdviceSessionLookback } from "../engine/advice-types";
import type { AgentAvailability, AgentBackend } from "../engine/backend";

export type AdviceTuiScope = "all" | AdviceCategory;
export const adviceTuiScopes: AdviceTuiScope[] = ["all", ...adviceCategories];

export type AdviceTuiState = {
  availability: AgentAvailability;
  backend: AgentBackend;
  includeSessions: boolean;
  lookback: AdviceSessionLookback;
  scope: AdviceTuiScope;
  status: "ready" | "running" | "done" | "error";
  progress?: string;
  progressHistory: string[];
  report?: AdviceReport;
  error?: string;
};

export type AdviceTuiEvent =
  | { type: "SET_BACKEND"; backend: AgentBackend }
  | { type: "TOGGLE_SESSIONS" }
  | { type: "SET_LOOKBACK"; lookback: AdviceSessionLookback }
  | { type: "SET_SCOPE"; scope: AdviceTuiScope }
  | { type: "CYCLE_SCOPE" }
  | { type: "START" }
  | { type: "PROGRESS"; message: string }
  | { type: "SUCCEEDED"; report: AdviceReport }
  | { type: "FAILED"; error: string }
  | { type: "RESET" };

export function initialAdviceBackend(availability: AgentAvailability): AgentBackend | undefined {
  if (availability.claude) return "claude";
  if (availability.codex) return "codex";
  return undefined;
}

export function adjacentAvailableAdviceBackend(
  current: AgentBackend,
  availability: AgentAvailability,
  direction: -1 | 1
): AgentBackend | undefined {
  const available = (["claude", "codex"] as const).filter((backend) => availability[backend]);
  if (available.length === 0) return undefined;
  const currentIndex = available.indexOf(current);
  if (currentIndex < 0) return available[0];
  return available[(currentIndex + direction + available.length) % available.length];
}

export function createInitialAdviceTuiState(sessionCount: number, availability: AgentAvailability): AdviceTuiState {
  const backend = initialAdviceBackend(availability);
  if (!backend) throw new Error("No reasoning backend is available.");
  return { availability, backend, includeSessions: sessionCount > 0, lookback: "7d", scope: "all", status: "ready", progressHistory: [] };
}

export function adjacentAdviceLookback(current: AdviceSessionLookback, direction: -1 | 1): AdviceSessionLookback {
  const index = adviceSessionLookbacks.indexOf(current);
  return adviceSessionLookbacks[(index + direction + adviceSessionLookbacks.length) % adviceSessionLookbacks.length]!;
}

export function adviceTuiReducer(state: AdviceTuiState, event: AdviceTuiEvent): AdviceTuiState {
  if (event.type === "SET_BACKEND" && state.status === "ready" && state.availability[event.backend]) {
    return { ...state, backend: event.backend };
  }
  if (event.type === "TOGGLE_SESSIONS" && state.status === "ready") return { ...state, includeSessions: !state.includeSessions };
  if (event.type === "SET_LOOKBACK" && state.status === "ready") return { ...state, lookback: event.lookback };
  if (event.type === "SET_SCOPE" && state.status === "ready") return { ...state, scope: event.scope };
  if (event.type === "CYCLE_SCOPE" && state.status === "ready") {
    const index = adviceTuiScopes.indexOf(state.scope);
    return { ...state, scope: adviceTuiScopes[(index + 1) % adviceTuiScopes.length]! };
  }
  if (event.type === "START" && state.status === "ready") {
    const message = `Starting ${state.backend === "claude" ? "Claude" : "Codex"} analysis…`;
    return { ...state, status: "running", error: undefined, report: undefined, progress: message, progressHistory: [message] };
  }
  if (event.type === "PROGRESS" && state.status === "running") {
    const previous = state.progressHistory.at(-1);
    return {
      ...state,
      progress: event.message,
      progressHistory: previous === event.message ? state.progressHistory : [...state.progressHistory, event.message]
    };
  }
  if (event.type === "SUCCEEDED" && state.status === "running") return { ...state, status: "done", report: event.report };
  if (event.type === "FAILED" && state.status === "running") return { ...state, status: "error", error: event.error };
  if (event.type === "RESET" && (state.status === "done" || state.status === "error")) {
    return { ...state, status: "ready", progress: undefined, progressHistory: [], report: undefined, error: undefined };
  }
  return state;
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/behavior-evidence.ts
```ts
import { createHash } from "node:crypto";

export type EvidenceWorkflow = "learn" | "advice" | "skill";
export type EvidenceCaseOutcome = "pass" | "fail" | "inconclusive";
export type EvidenceComparisonResult = "improved" | "regressed" | "inconclusive";

export type BoundedEvidenceSet<T> = {
  workflow: EvidenceWorkflow;
  digest: string;
  items: T[];
  itemCount: number;
  byteCount: number;
  inputItemCount: number;
  inputByteCount: number;
  truncatedItemCount: number;
  omittedItemCount: number;
  truncated: boolean;
};

export type EvidenceCaseResult = {
  id: string;
  outcome: EvidenceCaseOutcome;
};

export type EvidenceComparison = {
  inputDigest: string;
  result: EvidenceComparisonResult;
  before: { passed: number; failed: number; inconclusive: number };
  after: { passed: number; failed: number; inconclusive: number };
  regressionVeto: boolean;
  input: {
    inputItems: number;
    retainedItems: number;
    inputBytes: number;
    retainedBytes: number;
    truncatedItems: number;
    omittedItems: number;
    truncated: boolean;
  };
};

const defaultMaxItems = 40;
const defaultMaxItemBytes = 2_000;
const defaultMaxTotalBytes = 32_000;
const encoder = new TextEncoder();
const sensitiveKeys = new Set([
  "apikey", "accesstoken", "refreshtoken", "token", "secret", "password", "passwd",
  "credential", "credentials", "authorization", "privatekey", "awssecretaccesskey",
  "awssessiontoken", "openaiapikey", "githubtoken", "gitlabtoken", "slacktoken"
]);

function isSensitiveKey(key: string): boolean {
  return sensitiveKeys.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase());
}

function redactString(value: string): string {
  return value
    .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|gl(?:pat|rt)-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{8,})\b/g, "[REDACTED_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}={0,2}/gi, "$1[REDACTED_TOKEN]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED_CREDENTIALS]@")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|credential|authorization|private[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

export function redactEvidence<T>(value: T): T {
  if (typeof value === "string") return redactString(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactEvidence(item)) as T;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => {
      const redactedKey = redactString(key);
      return [redactedKey, isSensitiveKey(key) ? "[REDACTED]" : redactEvidence(item)];
    });
    return Object.fromEntries(entries) as T;
  }
  return value;
}

export function canonicalEvidence(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEvidence).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalEvidence(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function bytes(value: unknown): number {
  return encoder.encode(canonicalEvidence(value)).byteLength;
}

function validateLimit(name: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer >= ${minimum}.`);
  }
}

function boundedItem<T>(value: T, maxBytes: number): { value?: T; truncated: boolean } {
  if (bytes(value) <= maxBytes) return { value, truncated: false };

  const marker = { truncated: true };
  if (bytes(marker) > maxBytes) return { truncated: true };

  const source = canonicalEvidence(value);
  const codePoints = Array.from(source);
  let low = 0;
  let high = codePoints.length;
  let best: unknown = marker;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = { truncated: true, preview: codePoints.slice(0, middle).join("") };
    if (bytes(candidate) <= maxBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return { value: best as T, truncated: true };
}

export function createEvidenceSet<T>(input: {
  workflow: EvidenceWorkflow;
  items: readonly T[];
  maxItems?: number;
  maxItemBytes?: number;
  maxTotalBytes?: number;
}): BoundedEvidenceSet<T> {
  const maxItems = input.maxItems ?? defaultMaxItems;
  const maxItemBytes = input.maxItemBytes ?? defaultMaxItemBytes;
  const maxTotalBytes = input.maxTotalBytes ?? defaultMaxTotalBytes;
  validateLimit("maxItems", maxItems, 1);
  validateLimit("maxItemBytes", maxItemBytes, bytes({ truncated: true }));
  validateLimit("maxTotalBytes", maxTotalBytes, bytes([]));

  const redactedInput = input.items.map((item) => redactEvidence(item));
  const inputByteCount = bytes(redactedInput);
  const items: T[] = [];
  let truncatedItemCount = 0;
  let omittedItemCount = Math.max(0, input.items.length - maxItems);

  for (const source of redactedInput.slice(0, maxItems)) {
    const bounded = boundedItem(source, maxItemBytes);
    if (bounded.truncated) truncatedItemCount += 1;
    if (bounded.value === undefined) {
      omittedItemCount += 1;
      continue;
    }
    if (bytes([...items, bounded.value]) > maxTotalBytes) {
      omittedItemCount += redactedInput.slice(0, maxItems).length - items.length;
      break;
    }
    items.push(bounded.value);
  }

  const byteCount = bytes(items);
  const truncated = truncatedItemCount > 0 || omittedItemCount > 0;
  const digest = createHash("sha256")
    .update(canonicalEvidence({ workflow: input.workflow, items }))
    .digest("hex");
  return {
    workflow: input.workflow,
    digest,
    items,
    itemCount: items.length,
    byteCount,
    inputItemCount: input.items.length,
    inputByteCount,
    truncatedItemCount,
    omittedItemCount,
    truncated
  };
}

function counts(results: readonly EvidenceCaseResult[]) {
  return {
    passed: results.filter((item) => item.outcome === "pass").length,
    failed: results.filter((item) => item.outcome === "fail").length,
    inconclusive: results.filter((item) => item.outcome === "inconclusive").length
  };
}

function resultMap(results: readonly EvidenceCaseResult[], side: string): Map<string, EvidenceCaseOutcome> {
  const mapped = new Map<string, EvidenceCaseOutcome>();
  for (const item of results) {
    if (mapped.has(item.id)) throw new Error(`Behavior evidence comparison rejects duplicate case id '${item.id}' in ${side} results.`);
    mapped.set(item.id, item.outcome);
  }
  return mapped;
}

export function compareEvidence(input: {
  beforeSet: BoundedEvidenceSet<unknown>;
  afterSet: BoundedEvidenceSet<unknown>;
  before: readonly EvidenceCaseResult[];
  after: readonly EvidenceCaseResult[];
  regressionVeto?: boolean;
}): EvidenceComparison {
  if (input.beforeSet.workflow !== input.afterSet.workflow || input.beforeSet.digest !== input.afterSet.digest) {
    throw new Error("Behavior evidence comparison requires the identical bounded input set before and after.");
  }
  const beforeById = resultMap(input.before, "before");
  const afterById = resultMap(input.after, "after");
  if (beforeById.size !== afterById.size || [...beforeById.keys()].some((id) => !afterById.has(id))) {
    throw new Error("Behavior evidence comparison requires identical case ids before and after.");
  }
  const regressionVeto = input.regressionVeto === true || [...beforeById].some(([id, outcome]) => outcome === "pass" && afterById.get(id) === "fail");
  const before = counts(input.before);
  const after = counts(input.after);
  const result: EvidenceComparisonResult = regressionVeto || after.failed > before.failed
    ? "regressed"
    : after.passed > before.passed && after.failed <= before.failed
      ? "improved"
      : "inconclusive";
  return {
    inputDigest: input.beforeSet.digest,
    result,
    before,
    after,
    regressionVeto,
    input: {
      inputItems: input.beforeSet.inputItemCount,
      retainedItems: input.beforeSet.itemCount,
      inputBytes: input.beforeSet.inputByteCount,
      retainedBytes: input.beforeSet.byteCount,
      truncatedItems: input.beforeSet.truncatedItemCount,
      omittedItems: input.beforeSet.omittedItemCount,
      truncated: input.beforeSet.truncated
    }
  };
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/doctor.ts
```ts
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createRenderPlan, type FarrierManifestInput, type RenderedFile } from "./render";
import { inventoryOwnership, readManifest } from "./update";
import { validateToolPolicyRuleProposal } from "./learn";
import { builtinCatalog, type PackCatalog, type RegistryPin } from "../registry/catalog";
import { normalizeAgents } from "./agent-selection";
import { readSkillBehaviorEvidence } from "./skill-validate";

export type DoctorGroup =
  | "manifest"
  | "inventory"
  | "hooks"
  | "settings"
  | "codex"
  | "tool-policy"
  | "konsistent"
  | "learn"
  | "judge"
  | "quality"
  | "skills";

export type DoctorSeverity = "error" | "warning";

export type DoctorProblem = {
  group: DoctorGroup;
  severity: DoctorSeverity;
  path?: string;
  id?: string;
  message: string;
  remediation?: string;
};

export type DoctorReport = {
  targetDir: string;
  manifestPath: string;
  healthy: boolean;
  problems: DoctorProblem[];
  problemsByGroup: Record<DoctorGroup, DoctorProblem[]>;
  notes: string[];
};

const allGroups: DoctorGroup[] = [
  "manifest",
  "inventory",
  "hooks",
  "settings",
  "codex",
  "tool-policy",
  "konsistent",
  "learn",
  "judge",
  "quality",
  "skills"
];

const rulesRelativePath = ".claude/hooks/tool-policy-rules.json";

function emptyProblemsByGroup(): Record<DoctorGroup, DoctorProblem[]> {
  return Object.fromEntries(allGroups.map((group) => [group, [] as DoctorProblem[]])) as unknown as Record<
    DoctorGroup,
    DoctorProblem[]
  >;
}

function groupedProblems(problems: DoctorProblem[]): Record<DoctorGroup, DoctorProblem[]> {
  const grouped = emptyProblemsByGroup();

  for (const problem of problems) {
    grouped[problem.group].push(problem);
  }

  return grouped;
}

function reportFor(input: {
  targetDir: string;
  manifestPath: string;
  problems: DoctorProblem[];
  notes?: string[];
}): DoctorReport {
  const healthy = !input.problems.some((problem) => problem.severity === "error");

  return {
    targetDir: input.targetDir,
    manifestPath: input.manifestPath,
    healthy,
    problems: input.problems,
    problemsByGroup: groupedProblems(input.problems),
    notes: input.notes ?? []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function absoluteProjectPath(targetDir: string, path: string): string {
  return isAbsolute(path) ? path : join(targetDir, path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() || info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      message: string;
    }
> {
  let text: string;

  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(text)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message
    };
  }
}

function manifestInputFrom(manifest: Awaited<ReturnType<typeof readManifest>>): FarrierManifestInput {
  return {
    farrierVersion: manifest.farrierVersion ?? undefined,
    agents: [...manifest.agents],
    packIds: [...manifest.packIds],
    hookIds: [...manifest.hookIds],
    skills: [...manifest.skills],
    secondaryAcknowledged: [...manifest.secondaryAcknowledged],
    learn: {
      enabled: manifest.learn.enabled
    },
    judge: manifest.judge,
    quality: manifest.quality,
    versions: {
      farrierManifest: manifest.versions.farrierManifest ?? undefined,
      hooks: { ...manifest.versions.hooks },
      prompts: manifest.versions.prompts
    },
    registry: {
      items: { ...manifest.registry.items }
    }
  };
}

function registryPinsForManifest(
  manifest: Awaited<ReturnType<typeof readManifest>>,
  catalog: PackCatalog
): Record<string, RegistryPin> {
  const currentPins = catalog.registryPins();
  return Object.fromEntries(
    Object.keys(manifest.registry.items)
      .map((id) => [id, currentPins[id]])
      .filter((entry): entry is [string, RegistryPin] => entry[1] !== undefined)
  );
}

function addManifestShapeProblems(raw: unknown, problems: DoctorProblem[], targetDir: string): void {
  if (!isRecord(raw)) {
    problems.push({
      group: "manifest",
      severity: "error",
      path: ".farrier.json",
      message: ".farrier.json root must be an object",
      remediation: "Re-render or repair the harness with farrier update --yes."
    });
    return;
  }

  const learn = raw.learn;
  if (!isRecord(learn) || typeof learn.enabled !== "boolean") {
    problems.push({
      group: "learn",
      severity: "error",
      path: ".farrier.json",
      message: "learn.enabled must be a boolean",
      remediation: "Run farrier update --yes to restore generated manifest defaults."
    });
  }

  try {
    normalizeAgents(raw.agents);
  } catch (error) {
    problems.push({
      group: "manifest",
      severity: "error",
      path: ".farrier.json",
      message: error instanceof Error ? error.message : String(error),
      remediation: "Set agents to a non-empty selection of claude, codex, or both."
    });
  }

  const judge = raw.judge;
  if (judge !== undefined && !isRecord(judge)) {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: "judge must be an object when present",
      remediation: "Run farrier update --yes or fix the judge configuration."
    });
    return;
  }

  if (isRecord(judge)) {
    validateJudgeTier("perEdit", judge.perEdit, problems, targetDir);
    validateJudgeTier("stop", judge.stop, problems, targetDir);
  }

  const quality = raw.quality;
  if (quality !== undefined && !isRecord(quality)) {
    problems.push({
      group: "quality",
      severity: "error",
      path: ".farrier.json",
      message: "quality must be an object when present",
      remediation: "Run farrier update --yes or fix the quality configuration."
    });
    return;
  }

  if (isRecord(quality) && !isPositiveNumber(quality.maxFileLines)) {
    problems.push({
      group: "quality",
      severity: "error",
      path: ".farrier.json",
      message: "quality.maxFileLines must be a positive number",
      remediation: "Set quality.maxFileLines to a positive number."
    });
  }
}

function validateJudgeTier(
  tier: "perEdit" | "stop",
  value: unknown,
  problems: DoctorProblem[],
  targetDir: string
): void {
  if (value === undefined) {
    return;
  }

  if (!isRecord(value)) {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier} must be an object when present`,
      remediation: "Run farrier update --yes or fix the judge configuration."
    });
    return;
  }

  if (typeof value.enabled !== "boolean") {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier}.enabled must be a boolean`,
      remediation: `Set judge.${tier}.enabled to true or false.`
    });
  }

  if (value.backend !== undefined && value.backend !== "claude" && value.backend !== "codex") {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier}.backend must be "claude" or "codex"`,
      remediation: `Set judge.${tier}.backend to "claude" or "codex".`
    });
  }

  if (value.model !== undefined && !isNonEmptyString(value.model)) {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier}.model must be a non-empty string`,
      remediation: `Set judge.${tier}.model to the backend model name.`
    });
  }

  if (value.timeoutMs !== undefined && !isPositiveNumber(value.timeoutMs)) {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier}.timeoutMs must be a positive number`,
      remediation: `Set judge.${tier}.timeoutMs to a positive millisecond timeout.`
    });
  }
  if (isPositiveNumber(value.timeoutMs) && value.timeoutMs > 120_000) {
    problems.push({
      group: "judge",
      severity: "error",
      path: ".farrier.json",
      message: `judge.${tier}.timeoutMs exceeds the 120000 ms runtime bound`,
      remediation: `Set judge.${tier}.timeoutMs to 120000 or less.`
    });
  }

  if (value.prompt !== undefined) {
    if (!isNonEmptyString(value.prompt)) {
      problems.push({
        group: "judge",
        severity: "error",
        path: ".farrier.json",
        message: `judge.${tier}.prompt must be a non-empty string`,
        remediation: `Set judge.${tier}.prompt to an existing prompt file path.`
      });
    }
  }

  if (tier === "stop") {
    if (value.maxDiffBytes !== undefined && !isPositiveNumber(value.maxDiffBytes)) {
      problems.push({
        group: "judge",
        severity: "error",
        path: ".farrier.json",
        message: "judge.stop.maxDiffBytes must be a positive number",
        remediation: "Set judge.stop.maxDiffBytes to a positive byte limit."
      });
    }

    if (isPositiveNumber(value.maxDiffBytes) && value.maxDiffBytes > 120_000) {
      problems.push({
        group: "judge",
        severity: "error",
        path: ".farrier.json",
        message: "judge.stop.maxDiffBytes exceeds the 120000-byte runtime bound",
        remediation: "Set judge.stop.maxDiffBytes to 120000 or less."
      });
    }

    if (value.maxUntrackedFiles !== undefined && !isPositiveNumber(value.maxUntrackedFiles)) {
      problems.push({
        group: "judge",
        severity: "error",
        path: ".farrier.json",
        message: "judge.stop.maxUntrackedFiles must be a positive number",
        remediation: "Set judge.stop.maxUntrackedFiles to a positive file count."
      });
    }
    if (isPositiveNumber(value.maxUntrackedFiles) && value.maxUntrackedFiles > 1_000) {
      problems.push({
        group: "judge",
        severity: "error",
        path: ".farrier.json",
        message: "judge.stop.maxUntrackedFiles exceeds the 1000-file runtime bound",
        remediation: "Set judge.stop.maxUntrackedFiles to 1000 or less."
      });
    }
  }

}

const judgeTierHooks = {
  perEdit: "quality-judge",
  stop: "stop-judge"
} as const;

async function addJudgePromptProblems(
  raw: unknown,
  problems: DoctorProblem[],
  targetDir: string,
  selectedHookIds: readonly string[]
): Promise<void> {
  if (!isRecord(raw) || !isRecord(raw.judge)) {
    return;
  }

  for (const tier of ["perEdit", "stop"] as const) {
    const tierConfig = raw.judge[tier];

    if (!isRecord(tierConfig) || !isNonEmptyString(tierConfig.prompt)) {
      continue;
    }

    // The judge config block is rendered for every pack, but the prompt file only
    // exists when the corresponding hook is selected — absent hook means inert config.
    if (!selectedHookIds.includes(judgeTierHooks[tier])) {
      continue;
    }

    const promptPath = absoluteProjectPath(targetDir, tierConfig.prompt);
    try {
      if (isAbsolute(tierConfig.prompt)) throw new Error("absolute");
      const [info, actual, root] = await Promise.all([lstat(promptPath), realpath(promptPath), realpath(targetDir)]);
      const rel = relative(root, actual);
      if (!info.isFile() || info.isSymbolicLink() || rel.startsWith("..") || isAbsolute(rel)) throw new Error("unsafe");
      if (info.size > 30 * 1024) throw new Error("oversized");
      await readFile(promptPath, "utf8");
    } catch {
      problems.push({
        group: "judge",
        severity: "error",
        path: tierConfig.prompt,
        message: `judge.${tier}.prompt must be a readable in-root regular non-symlink file no larger than 30720 bytes`,
        remediation: "Restore the generated prompt file or update the manifest prompt path."
      });
    }
  }
}

async function addInventoryProblems(
  targetDir: string,
  expectedFiles: RenderedFile[],
  problems: DoctorProblem[]
): Promise<void> {
  for (const file of expectedFiles) {
    if (file.path === ".farrier.json") {
      continue;
    }

    const absolutePath = join(targetDir, file.path);

    if (!(await fileExists(absolutePath))) {
      problems.push({
        group: "inventory",
        severity: "error",
        path: file.path,
        message: "Expected generated harness file is missing",
        remediation: "Run farrier update --yes to restore missing harness files."
      });
      continue;
    }

    if (inventoryOwnership(file.path) === "farrier-owned") {
      const current = await readText(absolutePath);
      if (current !== file.content) {
        problems.push({
          group: "inventory",
          severity: "error",
          path: file.path,
          message: "Farrier-owned generated file differs from the expected template",
          remediation: "Run farrier update --yes to refresh Farrier-owned generated files."
        });
      }
    }
  }
}

async function addHookModeProblems(
  targetDir: string,
  expectedFiles: RenderedFile[],
  problems: DoctorProblem[]
): Promise<void> {
  for (const file of expectedFiles) {
    if (file.mode === undefined) {
      continue;
    }

    const absolutePath = join(targetDir, file.path);

    if (!(await fileExists(absolutePath))) {
      continue;
    }

    if (!(await isExecutable(absolutePath))) {
      problems.push({
        group: "hooks",
        severity: "error",
        path: file.path,
        message: "Hook script is not executable",
        remediation: `Run chmod +x ${file.path} or farrier update --yes.`
      });
    }
  }
}

function collectHookCommands(settings: unknown): { commands: string[]; shapeError?: string } {
  if (!isRecord(settings)) {
    return {
      commands: [],
      shapeError: "settings root must be an object"
    };
  }

  const hooks = settings.hooks;
  if (!isRecord(hooks)) {
    return {
      commands: [],
      shapeError: "settings.hooks must be an object"
    };
  }

  const commands: string[] = [];

  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) {
      return {
        commands,
        shapeError: "settings.hooks entries must be arrays"
      };
    }

    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
        return {
          commands,
          shapeError: "settings hook entry must contain a hooks array"
        };
      }

      for (const hook of entry.hooks) {
        if (isRecord(hook) && typeof hook.command === "string") {
          commands.push(hook.command);
        }
      }
    }
  }

  return { commands };
}

function referencedHookPath(command: string, targetDir: string): { relativePath: string; absolutePath: string } | undefined {
  const expanded = command.replaceAll("$CLAUDE_PROJECT_DIR", targetDir);
  const match = expanded.match(/(?:^|["'\s])(?<path>(?:[^"'\s]*\/)?\.claude\/hooks\/[^"'\s]+)(?:$|["'\s])/);

  if (!match?.groups?.path) {
    return undefined;
  }

  const rawPath = match.groups.path;
  const projectPrefix = `${targetDir.replaceAll("\\", "/")}/`;
  const normalizedRawPath = rawPath.replaceAll("\\", "/");
  const relativePath = normalizedRawPath.startsWith(projectPrefix)
    ? normalizedRawPath.slice(projectPrefix.length)
    : normalizedRawPath.replace(/^\.\/+/, "");

  return {
    relativePath,
    absolutePath: absoluteProjectPath(targetDir, relativePath)
  };
}

async function addSettingsProblems(
  targetDir: string,
  expectedSettingsFile: RenderedFile | undefined,
  problems: DoctorProblem[]
): Promise<void> {
  const settingsPath = join(targetDir, ".claude/settings.json");
  const actual = await readJsonFile(settingsPath);

  if (!actual.ok) {
    problems.push({
      group: "settings",
      severity: "error",
      path: ".claude/settings.json",
      message: `Unable to parse Claude settings JSON: ${actual.message}`,
      remediation: "Run farrier update --yes or restore .claude/settings.json."
    });
    return;
  }

  const actualCommands = collectHookCommands(actual.value);
  if (actualCommands.shapeError) {
    problems.push({
      group: "settings",
      severity: "error",
      path: ".claude/settings.json",
      message: actualCommands.shapeError,
      remediation: "Restore the generated Claude settings hook structure."
    });
  }

  if (expectedSettingsFile) {
    try {
      const expected = JSON.parse(expectedSettingsFile.content) as unknown;
      const expectedCommands = collectHookCommands(expected).commands;
      const actualCommandSet = new Set(actualCommands.commands);

      for (const command of expectedCommands) {
        if (!actualCommandSet.has(command)) {
          problems.push({
            group: "settings",
            severity: "error",
            path: ".claude/settings.json",
            message: `Expected generated hook command is missing: ${command}`,
            remediation: "Run farrier update --yes or restore the missing hook command."
          });
        }
      }
    } catch {
      // Expected settings are generated by Farrier; ignore impossible local parse failure.
    }
  }

  for (const command of actualCommands.commands) {
    const reference = referencedHookPath(command, targetDir);

    if (!reference) {
      continue;
    }

    if (!(await fileExists(reference.absolutePath))) {
      problems.push({
        group: "settings",
        severity: "error",
        path: ".claude/settings.json",
        message: `Hook command references a missing file: ${reference.relativePath}`,
        remediation: "Restore the referenced hook file or remove the dangling settings command."
      });
      continue;
    }

    if (!(await isExecutable(reference.absolutePath))) {
      problems.push({
        group: "settings",
        severity: "error",
        path: reference.relativePath,
        message: "Hook command references a non-executable hook file",
        remediation: `Run chmod +x ${reference.relativePath} or farrier update --yes.`
      });
    }
  }
}

type CodexHookBinding = {
  event: string;
  matcher?: string;
  type?: string;
  command?: string;
};

function collectCodexHookBindings(value: unknown): { bindings: CodexHookBinding[]; shapeError?: string } {
  if (!isRecord(value)) return { bindings: [], shapeError: "hooks.json root must be an object" };
  if (!isRecord(value.hooks)) return { bindings: [], shapeError: "hooks.json hooks must be an object" };

  const bindings: CodexHookBinding[] = [];
  for (const [event, entries] of Object.entries(value.hooks)) {
    if (!Array.isArray(entries)) return { bindings, shapeError: `hooks.${event} must be an array` };
    for (const entry of entries) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
        return { bindings, shapeError: `hooks.${event} entries must contain a hooks array` };
      }
      if (entry.hooks.length === 0) {
        return { bindings, shapeError: `hooks.${event} hooks arrays must not be empty` };
      }
      if (entry.matcher !== undefined && typeof entry.matcher !== "string") {
        return { bindings, shapeError: `hooks.${event} matcher must be a string when present` };
      }
      for (const hook of entry.hooks) {
        if (!isRecord(hook)) return { bindings, shapeError: `hooks.${event} handlers must be objects` };
        if (hook.type !== "command" || !isNonEmptyString(hook.command)) {
          return {
            bindings,
            shapeError: `hooks.${event} handlers must use type command with a non-empty command`
          };
        }
        bindings.push({
          event,
          ...(typeof entry.matcher === "string" ? { matcher: entry.matcher } : {}),
          type: hook.type,
          command: hook.command
        });
      }
    }
  }
  return { bindings };
}

function sameCodexBinding(actual: CodexHookBinding, expected: CodexHookBinding): boolean {
  return actual.event === expected.event
    && actual.matcher === expected.matcher
    && actual.type === expected.type
    && actual.command === expected.command;
}

function codexHookTarget(command: string, targetDir: string): { relativePath: string; absolutePath: string } | undefined {
  const match = command.match(/\/\.claude\/hooks\/(?<file>[^"'\s]+)["']?\s*$/);
  if (!match?.groups?.file) return undefined;
  const relativePath = `.claude/hooks/${match.groups.file}`;
  return { relativePath, absolutePath: join(targetDir, relativePath) };
}

async function addCodexHooksProblems(
  targetDir: string,
  expectedFile: RenderedFile,
  problems: DoctorProblem[]
): Promise<void> {
  const relativePath = ".codex/hooks.json";
  const actual = await readJsonFile(join(targetDir, relativePath));
  if (!actual.ok) {
    problems.push({
      group: "codex",
      severity: "error",
      path: relativePath,
      message: `Unable to parse Codex hooks JSON: ${actual.message}`,
      remediation: "Run farrier update --yes if the file is missing, or restore the selected Codex binding."
    });
    return;
  }

  const actualBindings = collectCodexHookBindings(actual.value);
  if (actualBindings.shapeError) {
    problems.push({
      group: "codex",
      severity: "error",
      path: relativePath,
      message: actualBindings.shapeError,
      remediation: "Restore a valid Codex hooks.json event, matcher-group, and command-handler structure."
    });
  }

  const expectedBindings = collectCodexHookBindings(JSON.parse(expectedFile.content)).bindings;
  for (const expected of expectedBindings) {
    if (!actualBindings.bindings.some((actualBinding) => sameCodexBinding(actualBinding, expected))) {
      problems.push({
        group: "codex",
        severity: "error",
        path: relativePath,
        message: `Expected Farrier ${expected.event}${expected.matcher ? ` (${expected.matcher})` : ""} command hook is missing: ${expected.command}`,
        remediation: "Restore the missing Farrier command entry without removing unrelated user-authored hooks."
      });
      continue;
    }

    if (!expected.command) continue;
    const target = codexHookTarget(expected.command, targetDir);
    if (!target || !(await fileExists(target.absolutePath))) {
      problems.push({
        group: "codex",
        severity: "error",
        path: relativePath,
        message: `Farrier command references a missing shared hook target: ${target?.relativePath ?? expected.command}`,
        remediation: "Run farrier update --yes to restore the shared policy script."
      });
    } else if (!(await isExecutable(target.absolutePath))) {
      problems.push({
        group: "codex",
        severity: "error",
        path: target.relativePath,
        message: "Codex binding references a non-executable shared hook target",
        remediation: `Run chmod +x ${target.relativePath} or farrier update --yes.`
      });
    }
  }
}

async function addToolPolicyProblems(
  targetDir: string,
  shouldExist: boolean,
  problems: DoctorProblem[]
): Promise<void> {
  const rulesPath = join(targetDir, rulesRelativePath);

  if (!(await fileExists(rulesPath))) {
    if (shouldExist) {
      problems.push({
        group: "tool-policy",
        severity: "error",
        path: rulesRelativePath,
        message: "tool-policy hook is selected but rules file is missing",
        remediation: "Run farrier update --yes to restore the rules file."
      });
    }
    return;
  }

  const parsed = await readJsonFile(rulesPath);
  if (!parsed.ok) {
    problems.push({
      group: "tool-policy",
      severity: "error",
      path: rulesRelativePath,
      message: `Unable to parse tool-policy rules JSON: ${parsed.message}`,
      remediation: "Fix the JSON or re-render the rules file."
    });
    return;
  }

  if (!isRecord(parsed.value)) {
    problems.push({
      group: "tool-policy",
      severity: "error",
      path: rulesRelativePath,
      message: "tool-policy rules root must be an object",
      remediation: "Use { version: 1, rules: [...] }."
    });
    return;
  }

  if (parsed.value.version !== 1) {
    problems.push({
      group: "tool-policy",
      severity: "error",
      path: rulesRelativePath,
      message: "tool-policy rules version must be 1",
      remediation: "Use the Farrier tool-policy rules schema version 1."
    });
  }

  if (!Array.isArray(parsed.value.rules)) {
    problems.push({
      group: "tool-policy",
      severity: "error",
      path: rulesRelativePath,
      message: "tool-policy rules must be an array",
      remediation: "Use { version: 1, rules: [...] }."
    });
    return;
  }

  const proposedIds = new Set<string>();

  for (const rule of parsed.value.rules) {
    const result = validateToolPolicyRuleProposal(rule, {
      existingIds: new Set(),
      proposedIds
    });

    if (result.ok) {
      proposedIds.add(result.rule.id);
      continue;
    }

    problems.push({
      group: "tool-policy",
      severity: "error",
      path: rulesRelativePath,
      id: result.id,
      message: result.reason,
      remediation: "Fix or remove the invalid declarative ToolPolicyRule."
    });
  }
}

async function addKonsistentProblems(
  targetDir: string,
  configFile: string | undefined,
  problems: DoctorProblem[]
): Promise<void> {
  if (!configFile) {
    return;
  }

  const path = join(targetDir, configFile);

  if (!(await fileExists(path))) {
    problems.push({
      group: "konsistent",
      severity: "error",
      path: configFile,
      message: `Expected ${configFile} is missing`,
      remediation: `Run farrier update --yes to restore ${configFile}.`
    });
    return;
  }

  const parsed = await readJsonFile(path);
  if (!parsed.ok) {
    problems.push({
      group: "konsistent",
      severity: "error",
      path: configFile,
      message: `Unable to parse ${configFile}: ${parsed.message}`,
      remediation: `Fix the JSON or restore the generated ${configFile}.`
    });
    return;
  }

  if (!isRecord(parsed.value)) {
    problems.push({
      group: "konsistent",
      severity: "error",
      path: configFile,
      message: `${configFile} root must be an object`,
      remediation: "Restore the generated structure-check v1 shape."
    });
    return;
  }

  if (parsed.value.version !== "v1") {
    problems.push({
      group: "konsistent",
      severity: "error",
      path: configFile,
      message: `${configFile} version must be "v1"`,
      remediation: "Restore the generated structure-check v1 shape."
    });
  }

  if (!Array.isArray(parsed.value.conventions)) {
    problems.push({
      group: "konsistent",
      severity: "error",
      path: configFile,
      message: `${configFile} conventions must be an array`,
      remediation: "Restore the generated structure-check v1 shape."
    });
  }
}

async function addGeneratedRecipeProblems(targetDir: string, expectedJustfile: RenderedFile | undefined, problems: DoctorProblem[]): Promise<void> {
  if (!expectedJustfile) return;
  let actual: string;
  try {
    actual = await readFile(join(targetDir, "justfile"), "utf8");
  } catch {
    return;
  }
  const expectedRecipes = Array.from(expectedJustfile.content.matchAll(/^([a-z][a-z0-9_-]*):/gm), (match) => match[1]!);
  for (const recipe of expectedRecipes) {
    if (!new RegExp(`^${recipe.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}:`, "m").test(actual)) {
      problems.push({
        group: "inventory",
        severity: "error",
        path: "justfile",
        message: `Required generated recipe '${recipe}' is missing`,
        remediation: "Run farrier update --yes to restore the generated aggregate and local/CI check definitions."
      });
    }
  }
  if (expectedJustfile.content.includes("pytest .claude/hooks") && !/^[ \t]+.*pytest \.claude\/hooks/m.test(actual)) {
    problems.push({
      group: "hooks",
      severity: "error",
      path: "justfile",
      message: "The generated check aggregate does not invoke the generated hook test suite",
      remediation: "Run farrier update --yes, then run just check."
    });
  }
}

async function addBundledSkillCaseProblems(targetDir: string, problems: DoctorProblem[]): Promise<void> {
  const paths = [
    ".claude/skills/harness-advisor",
    ".claude/skills/claude-automation-recommender",
    ".agents/skills/farrier-project-advisor"
  ];
  for (const path of paths) {
    const evidence = await readSkillBehaviorEvidence(join(targetDir, path));
    if (evidence.availability === "unavailable") {
      problems.push({
        group: "skills",
        severity: "error",
        path: `${path}/evals/cases.json`,
        message: "Bundled Farrier skill behavior cases are missing or invalid",
        remediation: "Run farrier update --yes to restore positive and negative skill cases."
      });
    }
  }
}

export async function createDoctorReport(input: { targetDir: string; catalog?: PackCatalog }): Promise<DoctorReport> {
  const targetDir = resolve(input.targetDir);
  const catalog = input.catalog ?? builtinCatalog();
  const manifestPath = join(targetDir, ".farrier.json");
  const problems: DoctorProblem[] = [];
  const notes: string[] = [
    "Doctor is static: it validates generated harness shape and file health without running project commands."
  ];

  let manifest: Awaited<ReturnType<typeof readManifest>>;
  try {
    manifest = await readManifest({ targetDir, catalog });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return reportFor({
      targetDir,
      manifestPath,
      problems: [
        {
          group: "manifest",
          severity: "error",
          path: ".farrier.json",
          message,
          remediation: "Run farrier first, or repair .farrier.json before running doctor."
        }
      ],
      notes
    });
  }

  const rawManifest = await readJsonFile(manifestPath);
  if (rawManifest.ok) {
    addManifestShapeProblems(rawManifest.value, problems, targetDir);
    await addJudgePromptProblems(rawManifest.value, problems, targetDir, manifest.hookIds);
  } else {
    problems.push({
      group: "manifest",
      severity: "error",
      path: ".farrier.json",
      message: `Unable to parse .farrier.json: ${rawManifest.message}`,
      remediation: "Repair .farrier.json before running doctor."
    });
  }

  const basePack = catalog.resolvePack(manifest.currentPackId);
  const renderPack = {
    ...basePack,
    hooks: [...manifest.hookIds]
  };

  const expectedPlan = await createRenderPlan({
    targetDir,
    pack: renderPack,
    skills: manifest.skills,
    learnEnabled: manifest.learn.enabled,
    secondaryAcknowledged: manifest.secondaryAcknowledged,
    existingManifest: manifestInputFrom(manifest),
    agents: manifest.agents,
    registryPins: registryPinsForManifest(manifest, catalog)
  });

  await addInventoryProblems(targetDir, expectedPlan.files, problems);
  await addGeneratedRecipeProblems(targetDir, expectedPlan.files.find((file) => file.path === "justfile"), problems);
  await addBundledSkillCaseProblems(targetDir, problems);
  await addHookModeProblems(targetDir, expectedPlan.files, problems);

  if (manifest.agents.includes("claude")) {
    await addSettingsProblems(
      targetDir,
      expectedPlan.files.find((file) => file.path === ".claude/settings.json"),
      problems
    );
  }

  if (manifest.agents.includes("codex")) {
    const codexFile = expectedPlan.files.find((file) => file.path === ".codex/hooks.json");
    if (codexFile) await addCodexHooksProblems(targetDir, codexFile, problems);
    notes.push("Codex runtime trust, exact hook approval, hooks enablement, administrative policy, and complete unified_exec interception cannot be proven statically; inspect /hooks in Codex.");
  }

  await addToolPolicyProblems(targetDir, manifest.hookIds.includes("tool-policy"), problems);
  const konsistentConfigFile = `${basePack.konsistentTool ?? "konsistent"}.json`;
  await addKonsistentProblems(
    targetDir,
    expectedPlan.files.some((file) => file.path === konsistentConfigFile) ? konsistentConfigFile : undefined,
    problems
  );

  return reportFor({
    targetDir,
    manifestPath,
    problems,
    notes
  });
}

function renderProblem(problem: DoctorProblem): string {
  const parts = [`[${problem.severity}]`];

  if (problem.path) {
    parts.push(problem.path);
  }

  if (problem.id) {
    parts.push(`(${problem.id})`);
  }

  parts.push(problem.message);

  const line = parts.join(" ");
  return problem.remediation ? `${line}\n    Remediation: ${problem.remediation}` : line;
}

function renderList(values: string[], empty: string): string[] {
  if (values.length === 0) {
    return [`  ${empty}`];
  }

  return values.map((value) => `  - ${value}`);
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    `Farrier doctor report for ${report.targetDir}`,
    "",
    `Manifest: ${report.manifestPath}`,
    `Health: ${report.healthy ? "healthy" : "unhealthy"}`
  ];

  if (report.problems.length === 0) {
    lines.push("", "No problems found.");
  } else {
    for (const group of allGroups) {
      const problems = report.problemsByGroup[group];

      if (problems.length === 0) {
        continue;
      }

      lines.push("", `${group}:`);
      for (const problem of problems) {
        lines.push(`  - ${renderProblem(problem).replaceAll("\n", "\n    ")}`);
      }
    }
  }

  if (report.notes.length > 0) {
    lines.push("", "Notes:", ...renderList(report.notes, "none"));
  }

  return `${lines.join("\n")}\n`;
}

export function doctorExitCode(report: DoctorReport): number {
  return report.healthy ? 0 : 1;
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/cli/update.ts
```ts
import { resolve } from "node:path";
import {
  applyUpdate,
  createUpdateReport,
  formatUpdateApplyResult,
  formatUpdateReport
} from "../engine/update";
import { loadConfiguredCatalog, registryRefsFromManifest } from "./registry";

type UpdateCliOptions = {
  dir: string;
  yes: boolean;
  json: boolean;
  help: boolean;
};

function parseUpdateArgs(args: string[]): UpdateCliOptions {
  const options: UpdateCliOptions = {
    dir: process.cwd(),
    yes: false,
    json: false,
    help: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--dir") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--dir requires a value");
      }
      options.dir = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--dir=")) {
      options.dir = arg.slice("--dir=".length);
      continue;
    }

    throw new Error(`Unknown update argument: ${arg}`);
  }

  return options;
}

export async function runUpdate(args: string[], usage: () => string): Promise<number> {
  const options = parseUpdateArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targetDir = resolve(options.dir);
  const requireRefs = await registryRefsFromManifest(targetDir);
  const catalog = await loadConfiguredCatalog({ targetDir, requireRefs });

  if (options.yes) {
    const result = await applyUpdate({ targetDir, catalog });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ...result.report,
            applied: {
              repairedFiles: result.repairedFiles,
              acknowledgedSecondaryIds: result.acknowledgedSecondaryIds,
              suggestedSkillsNotInstalled: result.suggestedSkillsNotInstalled
            }
          },
          null,
          2
        )
      );
      return 0;
    }

    console.log(formatUpdateApplyResult(result).trimEnd());
    return 0;
  }

  const report = await createUpdateReport({ targetDir, catalog });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(formatUpdateReport(report).trimEnd());
  return 0;
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/cli/doctor.ts
```ts
import { resolve } from "node:path";
import { createDoctorReport, doctorExitCode, formatDoctorReport } from "../engine/doctor";
import { loadConfiguredCatalog, registryRefsFromManifest } from "./registry";

type DoctorCliOptions = {
  dir: string;
  json: boolean;
  help: boolean;
};

function parseDoctorArgs(args: string[]): DoctorCliOptions {
  const options: DoctorCliOptions = {
    dir: process.cwd(),
    json: false,
    help: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--dir") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--dir requires a value");
      }
      options.dir = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--dir=")) {
      options.dir = arg.slice("--dir=".length);
      continue;
    }

    throw new Error(`Unknown doctor argument: ${arg}`);
  }

  return options;
}

export async function runDoctor(args: string[], usage: () => string): Promise<number> {
  const options = parseDoctorArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targetDir = resolve(options.dir);
  const requireRefs = await registryRefsFromManifest(targetDir);
  const catalog = await loadConfiguredCatalog({ targetDir, requireRefs });
  const report = await createDoctorReport({ targetDir, catalog });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report).trimEnd());
  }

  return doctorExitCode(report);
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/skill-paths.ts
```ts
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentBackend } from "./backend";

export type SkillAgent = AgentBackend;

const defaultCreatorRefs: Record<SkillAgent, string | undefined> = {
  claude: "anthropics/skills@skill-creator",
  codex: undefined,
};

const creatorRefEnvVars: Record<SkillAgent, string> = {
  claude: "FARRIER_CREATOR_CLAUDE",
  codex: "FARRIER_CREATOR_CODEX",
};

export function creatorRef(agent: SkillAgent): string | undefined {
  const override = process.env[creatorRefEnvVars[agent]];
  return override !== undefined && override.trim() !== "" ? override : defaultCreatorRefs[agent];
}

export const skillsCliAgentIds: Record<SkillAgent, string> = {
  claude: "claude-code",
  codex: "codex",
};

export const nativeSkillRoots: Record<SkillAgent, string> = {
  claude: ".claude/skills",
  codex: ".agents/skills",
};

export const canonicalSkillRoot = "skills";

export function resolvedHomedir(): string {
  return process.env.HOME || homedir();
}

export function globalSkillRoot(agent: SkillAgent): string {
  const dir = agent === "claude" ? ".claude" : ".codex";
  return join(resolvedHomedir(), dir, "skills");
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/tests/mutation-transaction.test.ts
```ts
import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyMutationPlan,
  inspectMutationPlan,
  MutationTransactionError,
  type MutationOperation,
} from "../src/engine/mutation-transaction";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-transaction-"));
}

async function contents(root: string, paths: string[]): Promise<string[]> {
  return Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
}

describe("closed mutation transaction", () => {
  test("failure after every commit step restores the complete old state", async () => {
    for (let failureIndex = 0; failureIndex < 3; failureIndex++) {
      const root = await tempDir();
      await writeFile(join(root, "a.txt"), "old-a");
      await writeFile(join(root, "b.txt"), "old-b");
      await writeFile(join(root, "c.txt"), "old-c");
      const paths = ["a.txt", "b.txt", "c.txt"];
      const operations: MutationOperation[] = paths.map((path) => ({ kind: "write-file", path, content: `new-${path[0]}` }));
      const plan = await inspectMutationPlan(root, operations);

      await expect(applyMutationPlan(plan, {
        afterCommit: ({ index }) => {
          if (index === failureIndex) throw new Error(`injected after ${index}`);
        }
      })).rejects.toMatchObject({ mutationState: "rolled-back", recoveryPath: null });
      expect(await contents(root, paths)).toEqual(["old-a", "old-b", "old-c"]);
    }
  });

  test("a concurrent edit to transaction output is retained with exact recovery material", async () => {
    const root = await tempDir();
    await writeFile(join(root, "a.txt"), "old-a");
    await writeFile(join(root, "b.txt"), "old-b");
    const plan = await inspectMutationPlan(root, [
      { kind: "write-file", path: "a.txt", content: "new-a" },
      { kind: "write-file", path: "b.txt", content: "new-b" },
    ]);

    let caught: unknown;
    try {
      await applyMutationPlan(plan, {
        afterCommit: async ({ index }) => {
          if (index === 0) await writeFile(join(root, "a.txt"), "user-edit");
          if (index === 1) throw new Error("stop");
        }
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MutationTransactionError);
    expect(caught).toMatchObject({ mutationState: "rollback-incomplete" });
    const recoveryPath = (caught as MutationTransactionError).recoveryPath!;
    expect(recoveryPath).toContain(".farrier-staging/transactions/");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("user-edit");
    expect(await readFile(join(root, recoveryPath, "a.txt"), "utf8")).toBe("old-a");
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("old-b");
  });

  test("parent substitution with a symlink is rejected before target writes", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await mkdir(join(root, "safe"));
    await writeFile(join(root, "safe", "value.txt"), "old");
    const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "safe/value.txt", content: "new" }]);

    await expect(applyMutationPlan(plan, {
      beforeCommit: async () => {
        await rename(join(root, "safe"), join(root, "moved"));
        await symlink(outside, join(root, "safe"), "dir");
      }
    })).rejects.toThrow(/unsafe|symbolic|changed/i);
    expect((await lstat(join(root, "safe"))).isSymbolicLink()).toBe(true);
    expect(await lstat(join(outside, "value.txt")).catch(() => undefined)).toBeUndefined();
  });

  test("reviewed links must resolve inside the transaction root", async () => {
    const root = await tempDir();
    await expect(inspectMutationPlan(root, [{ kind: "link", path: "link", target: "../outside" }])).rejects.toThrow("escapes target");
  });

  test("rejects a pre-existing backup file without deleting data or leaving staging residue", async () => {
    const root = await tempDir();
    await writeFile(join(root, "value.txt"), "old");
    await writeFile(join(root, "occupied"), "keep-me");
    const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "value.txt", content: "new" }]);

    await expect(applyMutationPlan(plan, { backupBase: "occupied" })).rejects.toThrow("Backup path already exists");
    expect(await readFile(join(root, "value.txt"), "utf8")).toBe("old");
    expect(await readFile(join(root, "occupied"), "utf8")).toBe("keep-me");
    expect((await readdir(root)).sort()).toEqual(["occupied", "value.txt"]);
  });

  test("rejects a pre-existing backup directory without deleting data or leaving staging residue", async () => {
    const root = await tempDir();
    await writeFile(join(root, "value.txt"), "old");
    await mkdir(join(root, "occupied"));
    await writeFile(join(root, "occupied", "keep.txt"), "keep-me");
    const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "value.txt", content: "new" }]);

    await expect(applyMutationPlan(plan, { backupBase: "occupied" })).rejects.toThrow("Backup path already exists");
    expect(await readFile(join(root, "value.txt"), "utf8")).toBe("old");
    expect(await readFile(join(root, "occupied", "keep.txt"), "utf8")).toBe("keep-me");
    expect((await readdir(root)).sort()).toEqual(["occupied", "value.txt"]);
    expect(await readdir(join(root, "occupied"))).toEqual(["keep.txt"]);
  });

  test("rejects invalid backup paths before touching the target", async () => {
    for (const backupBase of ["", ".", "../escape", "/absolute", "not/../normalized", "./relative"]) {
      const root = await tempDir();
      await writeFile(join(root, "value.txt"), "old");
      const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "value.txt", content: "new" }]);
      await expect(applyMutationPlan(plan, { backupBase })).rejects.toThrow(/normalized relative|Mutation path/);
      expect(await readFile(join(root, "value.txt"), "utf8")).toBe("old");
      expect(await readdir(root)).toEqual(["value.txt"]);
    }
  });

  test("a pre-backup hook failure cleans staged output and restores the exact tree", async () => {
    const root = await tempDir();
    await writeFile(join(root, "value.txt"), "old");
    const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "value.txt", content: "new" }]);

    await expect(applyMutationPlan(plan, {
      beforeBackup: () => { throw new Error("injected before backup"); }
    })).rejects.toMatchObject({ mutationState: "rolled-back" });
    expect(await readFile(join(root, "value.txt"), "utf8")).toBe("old");
    expect(await readdir(root)).toEqual(["value.txt"]);
  });

  test("tree review rejects a source file replaced by an external symlink", async () => {
    const root = await tempDir();
    const source = await tempDir();
    const outside = await tempDir();
    await mkdir(join(root, "skill"));
    await writeFile(join(root, "skill", "SKILL.md"), "old");
    await writeFile(join(source, "SKILL.md"), "reviewed");
    await writeFile(join(outside, "secret"), "outside-secret");
    const plan = await inspectMutationPlan(root, [{ kind: "replace-tree", path: "skill", sourcePath: source }]);

    await expect(applyMutationPlan(plan, {
      beforeCommit: async () => {
        await rm(join(source, "SKILL.md"));
        await symlink(join(outside, "secret"), join(source, "SKILL.md"));
      }
    })).rejects.toThrow("symbolic link");
    expect(await readFile(join(root, "skill", "SKILL.md"), "utf8")).toBe("old");
    expect((await readdir(root)).sort()).toEqual(["skill"]);
  });

  test("a dangling reviewed link target after backup restores the existing destination", async () => {
    const root = await tempDir();
    await mkdir(join(root, "winner"));
    await mkdir(join(root, "link"));
    await writeFile(join(root, "winner", "SKILL.md"), "winner");
    await writeFile(join(root, "link", "SKILL.md"), "original");
    const plan = await inspectMutationPlan(root, [{ kind: "link", path: "link", target: "winner" }]);

    await expect(applyMutationPlan(plan, {
      afterBackup: async () => rm(join(root, "winner"), { recursive: true })
    })).rejects.toMatchObject({ mutationState: "rolled-back", recoveryPath: null });
    expect(await readFile(join(root, "link", "SKILL.md"), "utf8")).toBe("original");
  });

  test("replace-tree source mutation after inspection leaves the destination untouched", async () => {
    const root = await tempDir();
    const source = await tempDir();
    await mkdir(join(root, "skill"));
    await writeFile(join(root, "skill", "SKILL.md"), "old");
    await writeFile(join(source, "SKILL.md"), "reviewed");
    const plan = await inspectMutationPlan(root, [{ kind: "replace-tree", path: "skill", sourcePath: source }]);

    await expect(applyMutationPlan(plan, {
      beforeCommit: async () => writeFile(join(source, "SKILL.md"), "changed")
    })).rejects.toThrow("source changed after review");
    expect(await readFile(join(root, "skill", "SKILL.md"), "utf8")).toBe("old");
  });

  test("link target substitution outside the root leaves the original destination untouched", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await mkdir(join(root, "winner"));
    await mkdir(join(root, "loser"));
    await writeFile(join(root, "winner", "SKILL.md"), "winner");
    await writeFile(join(root, "loser", "SKILL.md"), "loser");
    const plan = await inspectMutationPlan(root, [{ kind: "link", path: "loser", target: "winner" }]);

    await expect(applyMutationPlan(plan, {
      beforeCommit: async () => {
        await rm(join(root, "winner"), { recursive: true });
        await symlink(outside, join(root, "winner"), "dir");
      }
    })).rejects.toThrow(/target changed|escaped/i);
    expect(await readFile(join(root, "loser", "SKILL.md"), "utf8")).toBe("loser");
  });

  test("resolved link target content mutation leaves the original destination untouched", async () => {
    const root = await tempDir();
    await mkdir(join(root, "winner"));
    await mkdir(join(root, "loser"));
    await writeFile(join(root, "winner", "SKILL.md"), "winner");
    await writeFile(join(root, "loser", "SKILL.md"), "loser");
    const plan = await inspectMutationPlan(root, [{ kind: "link", path: "loser", target: "winner" }]);

    await expect(applyMutationPlan(plan, {
      beforeCommit: async () => writeFile(join(root, "winner", "SKILL.md"), "changed")
    })).rejects.toThrow("target changed after review");
    expect(await readFile(join(root, "loser", "SKILL.md"), "utf8")).toBe("loser");
  });

  test("rollback removes a transaction-created target root when it remains empty", async () => {
    const parent = await tempDir();
    const root = join(parent, "absent", "project");
    const plan = await inspectMutationPlan(root, [{ kind: "write-file", path: "nested/value.txt", content: "new" }]);

    await expect(applyMutationPlan(plan, {
      afterCommit: () => { throw new Error("stop"); }
    })).rejects.toMatchObject({ mutationState: "rolled-back" });
    expect(await lstat(join(parent, "absent")).catch(() => undefined)).toBeUndefined();
  });
});

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/eval-skill.ts
```ts
import { randomUUID } from "node:crypto";
import { access, lstat, readlink, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  backendEnvironmentOverrides,
  backendEnvironmentPassthrough,
  defaultBackendRunner,
  invokeBackend,
  type AgentBackend,
  type BackendCommandRunner
} from "./backend";
import type { ReasoningEffort } from "../config/farrier-config";
import {
  ensureCreatorInstalled,
  nativeSkillRoots,
  resolvedHomedir,
  type CreateAgent,
  type SkillCreationOutcome
} from "./create-skill";
import {
  buildLabeledEvalPrompt,
  mergeJudgePasses,
  validateLabeledEvalVerdict,
  type LabelAssignment
} from "./eval-judge";
import { writeEvalReports, type EvalReportPaths } from "./eval-report";
import { maxSkillNameLength, readSkillBehaviorEvidence, skillNamePattern } from "./skill-validate";
import type { CommandRunner, ResolveSkillsCommandDeps } from "./skills";
import { applyMutationPlan, inspectMutationPlan, type MutationOperation } from "./mutation-transaction";
import { withIsolatedExecution } from "./execution-isolation";
import { canonicalEvidence, compareEvidence, createEvidenceSet, type EvidenceComparison } from "./behavior-evidence";

export type SkillEvalWinner = CreateAgent | "tie";

/** Per-agent authoring lets each agent name its copy, so the two can diverge. */
export type PerAgentSkillNames = Record<CreateAgent, string>;

export type SkillEvalCopyScore = {
  path: string;
  score: number;
  rationale: string;
  strengths: string[];
  weaknesses: string[];
};

export type SkillEvalVerdict = {
  skillName: string;
  backend: AgentBackend;
  recommendedWinner: SkillEvalWinner;
  rationale: string;
  copies: Record<CreateAgent, SkillEvalCopyScore>;
  notes: string[];
  evidence?: EvidenceComparison & { availability: "available" | "unavailable"; caseCount: number };
  reportPaths?: EvalReportPaths;
};

export type SkillWinnerResolution = {
  skillName: string;
  winner: CreateAgent;
  loser: CreateAgent;
  winnerPath: string;
  deleted: string[];
  links: Array<{ path: string; target: string; resolvesTo: string }>;
  /** Where the deleted copy was retained, when the recoverable path was used. */
  backupPath?: string;
  notes: string[];
};

const pinnedCreatorRoot = ".claude/skills/skill-creator";
// Resolved per call (not cached at module load) so tests can point HOME at a
// scratch directory.
function globalPinnedCreatorRoot(): string {
  return join(resolvedHomedir(), ".claude", "skills", "skill-creator");
}
const pinnedEvalFiles = [
  "SKILL.md",
  "agents/comparator.md",
  "agents/analyzer.md",
  "references/schemas.md"
];

// Skill names become path segments under the native roots, so anything
// non-kebab-case (separators, dots) could escape them.
function assertSafeSkillName(skillName: string, context: string): void {
  if (!skillNamePattern.test(skillName) || skillName.length > maxSkillNameLength) {
    throw new Error(
      `${context}: skill name '${skillName}' must be kebab-case ([a-z0-9] and single hyphens), at most ${maxSkillNameLength} chars.`
    );
  }
}

function skillPath(agent: CreateAgent, skillName: string): string {
  return `${nativeSkillRoots[agent]}/${skillName}`;
}

function resolveNames(input: { skillName: string; names?: PerAgentSkillNames }, context: string): PerAgentSkillNames {
  const names = input.names ?? { claude: input.skillName, codex: input.skillName };
  assertSafeSkillName(names.claude, context);
  assertSafeSkillName(names.codex, context);
  return names;
}

async function assertFile(path: string, message: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

async function hasAllPinnedFiles(root: string): Promise<boolean> {
  for (const file of pinnedEvalFiles) {
    try {
      await access(join(root, file));
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Global-first: a copy already pinned globally (or in this project) is used
 * as-is; only a genuinely missing copy triggers a GitHub pull via the same
 * global-install path authoring uses, so the two never fight over scope.
 * Returns the root to read the eval tooling from — project-relative when the
 * project has its own copy, absolute when falling back to the global one.
 */
async function resolvePinnedCreatorRoot(
  targetDir: string,
  runner?: CommandRunner,
  resolveDeps?: ResolveSkillsCommandDeps
): Promise<string> {
  if (await hasAllPinnedFiles(join(targetDir, pinnedCreatorRoot))) {
    return pinnedCreatorRoot;
  }

  const globalRoot = globalPinnedCreatorRoot();

  if (await hasAllPinnedFiles(globalRoot)) {
    return globalRoot;
  }

  await ensureCreatorInstalled("claude", targetDir, runner, resolveDeps);

  if (await hasAllPinnedFiles(globalRoot)) {
    return globalRoot;
  }

  throw new Error(
    `Pinned Anthropic skill-creator eval tooling is missing from both ${pinnedCreatorRoot} (project) and ${globalRoot} (global), and installing anthropics/skills@skill-creator failed.`
  );
}

export type SkillEvalCandidate = {
  skillName: string;
  /** Directory name per agent — the copies can legitimately diverge. */
  names: PerAgentSkillNames;
  description: string;
};

/**
 * Which outcomes have a comparable per-agent pair: per-agent mode, no failed
 * leg, and exactly one top-level SKILL.md per native root. Each agent named
 * its own copy, so the names are recovered from the outcome files rather than
 * assumed to match.
 */
export function perAgentEvalCandidates(outcomes: SkillCreationOutcome[]): SkillEvalCandidate[] {
  return outcomes.flatMap((outcome) => {
    if (outcome.error || !outcome.name || outcome.request.mode !== "per-agent") {
      return [];
    }

    const names: Partial<PerAgentSkillNames> = {};

    for (const agent of ["claude", "codex"] as const) {
      const prefix = `${nativeSkillRoots[agent]}/`;
      const found = new Set(
        outcome.files
          .filter((file) => file.startsWith(prefix) && file.endsWith("/SKILL.md"))
          .map((file) => file.slice(prefix.length, -"/SKILL.md".length))
          .filter((name) => name.length > 0 && !name.includes("/"))
      );

      if (found.size !== 1) {
        return [];
      }

      names[agent] = [...found][0];
    }

    return [
      {
        skillName: outcome.name,
        names: names as PerAgentSkillNames,
        description: outcome.request.description
      }
    ];
  });
}

async function assertPerAgentSkillPair(targetDir: string, names: PerAgentSkillNames): Promise<void> {
  for (const agent of ["claude", "codex"] as const) {
    await assertFile(
      join(targetDir, skillPath(agent, names[agent]), "SKILL.md"),
      `Cannot evaluate ${names[agent]}: missing ${skillPath(agent, names[agent])}/SKILL.md`
    );
  }
}

export async function evaluatePerAgentSkill(input: {
  targetDir: string;
  skillName: string;
  /** Per-agent directory names when the copies diverged; defaults to skillName for both. */
  names?: PerAgentSkillNames;
  description?: string;
  backend: AgentBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner?: BackendCommandRunner;
  signal?: AbortSignal;
  /** Used only to self-heal a missing pinned creator via a global install. */
  skillsRunner?: CommandRunner;
  resolveDeps?: ResolveSkillsCommandDeps;
}): Promise<SkillEvalVerdict> {
  if (input.signal?.aborted) throw new Error("Skill evaluation cancelled before start.");
  const names = resolveNames(input, "Cannot evaluate");
  const creatorRoot = await resolvePinnedCreatorRoot(input.targetDir, input.skillsRunner, input.resolveDeps);
  await assertPerAgentSkillPair(input.targetDir, names);
  const [claudeCases, codexCases] = await Promise.all([
    readSkillBehaviorEvidence(join(input.targetDir, skillPath("claude", names.claude))),
    readSkillBehaviorEvidence(join(input.targetDir, skillPath("codex", names.codex)))
  ]);
  const declarationKeys = new Set<string>();
  const caseItems = [...claudeCases.cases, ...codexCases.cases]
    .filter((item) => {
      const key = canonicalEvidence(item);
      if (declarationKeys.has(key)) return false;
      declarationKeys.add(key);
      return true;
    })
    .sort((left, right) => canonicalEvidence(left).localeCompare(canonicalEvidence(right)));
  const normalizedClaudeCases = claudeCases.cases.map(canonicalEvidence).sort();
  const normalizedCodexCases = codexCases.cases.map(canonicalEvidence).sort();
  const declarationsMatch = canonicalEvidence(normalizedClaudeCases) === canonicalEvidence(normalizedCodexCases);
  const caseSet = createEvidenceSet({
    workflow: "skill",
    items: caseItems.length > 0 ? caseItems : [{ id: "behavior-cases-unavailable", kind: "negative" as const, prompt: "[unavailable]", expectedBehavior: "[unavailable]" }],
    maxItems: 200,
    maxItemBytes: 5_000,
    maxTotalBytes: 1_000_000
  });
  const inconclusiveCases = [{ id: "declaration-comparison", outcome: "inconclusive" as const }];
  const caseComparison = compareEvidence({ beforeSet: caseSet, afterSet: caseSet, before: inconclusiveCases, after: inconclusiveCases });

  const stagedPaths: Record<CreateAgent, string> = { claude: "candidate-one", codex: "candidate-two" };
  const isolated = await withIsolatedExecution({
    targetDir: input.targetDir,
    nativeConfinement: input.backend === "codex",
    environmentPassthrough: backendEnvironmentPassthrough(input.backend),
    environmentOverrides: backendEnvironmentOverrides(input.backend),
    readOnlyWorkspace: true,
    signal: input.signal,
    inputs: [
      { source: join(input.targetDir, skillPath("claude", names.claude)), path: stagedPaths.claude },
      { source: join(input.targetDir, skillPath("codex", names.codex)), path: stagedPaths.codex },
      { source: resolve(input.targetDir, creatorRoot), path: "creator" }
    ],
    run: async ({ workspace, environment, signal }) => {
    const runPass = async (assignment: LabelAssignment) => {
      const aPath = stagedPaths[assignment.A];
      const bPath = stagedPaths[assignment.B];

      const parsed = await invokeBackend({
        backend: input.backend,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        prompt: buildLabeledEvalPrompt({
          skillName: input.skillName,
          description: input.description,
          aPath,
          bPath,
          creatorRoot: "creator",
          behaviorEvidence: { digest: caseSet.digest, cases: caseSet.items }
        }),
        targetDir: workspace,
        runner: input.runner ?? defaultBackendRunner,
        signal,
        env: environment
      });

      return {
        verdict: validateLabeledEvalVerdict(parsed, input.backend, { skillName: input.skillName, aPath, bPath }),
        assignment
      };
    };

    // Two blind passes with the labels swapped, in parallel; a winner only
    // stands when both passes agree (position/self-preference bias guard).
    const passes = await Promise.all([
      runPass({ A: "claude", B: "codex" }),
      runPass({ A: "codex", B: "claude" })
    ]);

    const merged = mergeJudgePasses(passes);
    const behaviorAvailable = claudeCases.availability === "available" && codexCases.availability === "available";
    const recommendedWinner = merged.recommendedWinner;

    return {
      skillName: input.skillName,
      backend: input.backend,
      recommendedWinner,
      rationale: merged.rationale,
      copies: {
        claude: { path: skillPath("claude", names.claude), ...merged.copies.claude },
        codex: { path: skillPath("codex", names.codex), ...merged.copies.codex }
      },
      notes: [
        ...merged.notes,
        ...(behaviorAvailable
          ? [`Behavior declarations: ${caseItems.length} distinct positive/negative case(s), comparison ${caseComparison.result}, digest ${caseSet.digest}. Declarations were supplied to the blind judge but were not executed.`]
          : ["Behavior cases unavailable for one or both legacy/third-party copies; static blind evaluation was preserved and behavioral evidence is inconclusive."]),
        ...(!declarationsMatch ? ["Trust limitation: candidate behavior-case declarations differ; this non-directional mismatch does not establish a regression or veto either candidate."] : []),
        ...(caseSet.truncated ? [`Behavior declarations were bounded: retained ${caseSet.itemCount}/${caseSet.inputItemCount}; ${caseSet.truncatedItemCount} truncated and ${caseSet.omittedItemCount} omitted.`] : []),
        input.backend === "codex"
          ? "Isolation mode: native-confinement (Codex read-only sandbox)."
          : "Isolation mode: staged-best-effort; target fingerprints were verified and residual OS-user write risk remains."
      ],
      evidence: { ...caseComparison, availability: behaviorAvailable ? "available" : "unavailable", caseCount: caseItems.length }
    } satisfies SkillEvalVerdict;
    }
  });
  const verdict: SkillEvalVerdict = isolated.value;
  verdict.reportPaths = await writeEvalReports(input.targetDir, verdict);
  return verdict;
}

async function assertRealSkillDir(targetDir: string, relPath: string): Promise<void> {
  const absPath = join(targetDir, relPath);
  const stat = await lstat(absPath).catch(() => undefined);

  if (!stat) {
    throw new Error(`Cannot resolve winner: missing ${relPath}`);
  }

  if (stat.isSymbolicLink()) {
    const target = await readlink(absPath).catch(() => "unknown target");
    throw new Error(`Cannot resolve winner: ${relPath} is already a symlink to ${target}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Cannot resolve winner: ${relPath} is not a directory`);
  }

  await assertFile(join(absPath, "SKILL.md"), `Cannot resolve winner: missing ${relPath}/SKILL.md`);
}

export async function resolvePerAgentSkillWinner(input: {
  targetDir: string;
  skillName: string;
  /** Per-agent directory names when the copies diverged; defaults to skillName for both. */
  names?: PerAgentSkillNames;
  winner: CreateAgent;
  confirmDeleteAndLink: boolean;
  /**
   * Keep the deleted copy in .farrier-staging/trash/ instead of removing it.
   * Used by the auto-apply paths, where consent was given before the verdict
   * existed — reversibility offsets the blind consent. Interactive picks (the
   * user saw the exact paths and confirmed) delete cleanly.
   */
  retainBackupInTrash?: boolean;
}): Promise<SkillWinnerResolution> {
  const names = resolveNames(input, "Cannot resolve winner");

  if (!input.confirmDeleteAndLink) {
    throw new Error("Refusing to delete and symlink without explicit confirmation.");
  }

  const loser: CreateAgent = input.winner === "claude" ? "codex" : "claude";
  const winnerPath = skillPath(input.winner, names[input.winner]);
  const loserPath = skillPath(loser, names[loser]);
  // The link carries the winner's name so both roots expose the same skill;
  // it only differs from loserPath when the copies chose different names.
  const linkPath = skillPath(loser, names[input.winner]);

  await assertRealSkillDir(input.targetDir, winnerPath);
  await assertRealSkillDir(input.targetDir, loserPath);

  const winnerAbs = join(input.targetDir, winnerPath);
  const linkAbs = join(input.targetDir, linkPath);

  if (linkPath !== loserPath && (await lstat(linkAbs).catch(() => undefined))) {
    throw new Error(`Cannot resolve winner: ${linkPath} already exists and would be overwritten by the symlink.`);
  }

  const linkTarget = relative(dirname(linkAbs), winnerAbs) || ".";
  const operations: MutationOperation[] = [
    ...(linkPath === loserPath ? [] : [{ kind: "remove-tree", path: loserPath } as const]),
    { kind: "link", path: linkPath, target: linkTarget }
  ];
  try {
    const backupBase = input.retainBackupInTrash
      ? `.farrier-staging/trash/${names[loser]}-${randomUUID().slice(0, 8)}`
      : undefined;
    const transaction = await applyMutationPlan(await inspectMutationPlan(input.targetDir, operations), {
      backupBase,
      retainBackupsOnSuccess: input.retainBackupInTrash === true
    });
    const backupPath = transaction.backupDir ? `${transaction.backupDir}/${loserPath}` : undefined;
    return {
      skillName: input.skillName,
      winner: input.winner,
      loser,
      winnerPath,
      deleted: [loserPath],
      links: [{ path: linkPath, target: linkTarget, resolvesTo: winnerPath }],
      backupPath,
      notes: [
        `Deleted ${loserPath} and linked ${linkPath} to ${winnerPath}.`,
        ...(backupPath ? [`The replaced copy was kept at ${backupPath} for recovery in case you change your mind.`] : [])
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to link ${linkPath} to ${winnerPath}: ${message}`);
  }
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/advice-sessions.ts
```ts
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { defaultTranscriptDir, extractCandidateEvents } from "./learn";
import { createCodexAppServerClient, type CodexAppServerClient, type CodexAppServerFactory } from "./codex-app-server";
import { addSessionSignal as addSignal, redactSessionText, selectFairSignals, sourceFunnel } from "./advice-patterns";
import type {
  AdviceEvidence,
  AdviceSessionCountInventory,
  AdviceSessionEvidence,
  AdviceSessionLookback,
  AdviceSessionSourceSummary,
  AdviceVendor
} from "./advice-types";

type UnknownRecord = Record<string, unknown>;
const maxClaudeFiles = 500;
const maxSessionBytes = 2_000_000;
const dayMs = 24 * 60 * 60 * 1_000;
const internalAdvisorMarker = "farrier's read-only project advisor";

type DatedSession = { source: AdviceVendor; id: string; updatedAt: number };
type ClaudeSession = DatedSession & { file: string; records: UnknownRecord[] };

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1_000_000_000_000 ? value * 1_000 : value;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function recordTimestamp(record: UnknownRecord): number | undefined {
  return timestampMs(record.updatedAt) ?? timestampMs(record.timestamp) ?? timestampMs(record.createdAt);
}

function cutoffMs(lookback: AdviceSessionLookback, now: number): number | undefined {
  if (lookback === "all") return undefined;
  return now - (lookback === "7d" ? 7 : 14) * dayMs;
}

function withinLookback(updatedAt: number, lookback: AdviceSessionLookback, now: number): boolean {
  const cutoff = cutoffMs(lookback, now);
  return cutoff === undefined || updatedAt >= cutoff;
}

function countInventory(sessions: DatedSession[], targets: AdviceVendor[], now: number): AdviceSessionCountInventory {
  const counts = (lookback: AdviceSessionLookback): AdviceSessionSourceSummary[] => targets.map((source) => ({
    source,
    count: sessions.filter((session) => session.source === source && withinLookback(session.updatedAt, lookback, now)).length
  }));
  return { "7d": counts("7d"), "14d": counts("14d"), all: counts("all") };
}

export { redactSessionText } from "./advice-patterns";

function visibleTextBlocks(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (item.type === "text" && typeof item.text === "string") return [item.text];
    if (item.type === "input_text" && typeof item.text === "string") return [item.text];
    return [];
  });
}

function isInternalAdvisorText(value: unknown): boolean {
  return visibleTextBlocks(value).some((text) => text.toLowerCase().includes(internalAdvisorMarker));
}

function isCorrection(text: string): boolean {
  return /\b(?:actually|instead|no[, ]|please (?:do|use|keep|stop)|should (?:be|use)|must (?:not|use)|don['’]t)\b/i.test(text);
}

function looksLikeManualWorkflow(text: string): boolean {
  return /\b(?:create|deploy|fix|generate|publish|release|review|run|triage|update|verify)\b/i.test(text);
}

function looksLikeOutcome(text: string): boolean {
  return /\b(?:blocked|completed|failed|fixed|implemented|passed|resolved|succeeded|unable|verified)\b/i.test(text);
}

function isVerificationCommand(command: string): boolean {
  return /(?:^|\s)(?:test|pytest|ruff|eslint|tsc|check|lint|spec|just check|cargo test|go test)(?:\s|$)/i.test(command);
}

function isAgentGuidancePath(path: string): boolean {
  return /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|\.farrier\.json|settings\.json|skills-lock\.json)$/i.test(path);
}

function claudeToolUses(record: UnknownRecord): UnknownRecord[] {
  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];
  return content.filter((item): item is UnknownRecord => isRecord(item) && item.type === "tool_use");
}

function signalsFromClaudeRecord(record: UnknownRecord, sessionId: string, signals: AdviceEvidence[]): void {
  if (record.type === "user") {
    const message = isRecord(record.message) ? record.message : undefined;
    for (const text of visibleTextBlocks(message?.content ?? record.content)) {
      if (isCorrection(text)) addSignal(signals, { source: "claude", kind: "correction", summary: text, sessionId });
      else if (looksLikeManualWorkflow(text)) addSignal(signals, { source: "claude", kind: "manual-workflow", summary: text, sessionId });
    }
  } else if (record.type === "assistant") {
    const message = isRecord(record.message) ? record.message : undefined;
    for (const text of visibleTextBlocks(message?.content ?? record.content)) {
      if (looksLikeOutcome(text)) addSignal(signals, { source: "claude", kind: "outcome", summary: text, sessionId });
    }
  }

  for (const use of claudeToolUses(record)) {
    const name = typeof use.name === "string" ? use.name : "";
    const input = isRecord(use.input) ? use.input : {};
    if ((name === "WebSearch" || name === "WebFetch") && typeof (input.query ?? input.url) === "string") {
      addSignal(signals, { source: "claude", kind: "external-lookup", summary: `${name}: ${String(input.query ?? input.url)}`, sessionId });
    }
    if ((name === "Task" || name === "Agent") && typeof (input.description ?? input.prompt) === "string") {
      addSignal(signals, { source: "claude", kind: "delegation", summary: String(input.description ?? input.prompt), sessionId });
    }
    if (name === "Bash" && typeof input.command === "string" && isVerificationCommand(input.command)) {
      addSignal(signals, { source: "claude", kind: "verification", summary: input.command, sessionId });
    }
    const path = input.file_path ?? input.path;
    if ((name === "Edit" || name === "Write" || name === "MultiEdit") && typeof path === "string" && isAgentGuidancePath(path)) {
      addSignal(signals, { source: "claude", kind: "guidance-edit", summary: `Updated agent guidance/configuration: ${path}`, sessionId });
    }
  }
}

async function indexClaudeSessions(targetDir: string, transcriptsDir?: string): Promise<{
  directory: string;
  sessions: ClaudeSession[];
  malformed: number;
  discovered: number;
}> {
  const directory = transcriptsDir ? resolve(transcriptsDir) : defaultTranscriptDir(targetDir);
  let files: Array<{ name: string; mtimeMs: number }>;
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
    files = (await Promise.all(names.map(async (name) => ({ name, mtimeMs: (await stat(join(directory, name))).mtimeMs }))))
      .sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name))
      .slice(0, maxClaudeFiles);
  } catch {
    return { directory, sessions: [], malformed: 0, discovered: 0 };
  }

  let malformed = 0;
  const sessions: ClaudeSession[] = [];
  const exactDirectory = resolve(directory) === resolve(defaultTranscriptDir(targetDir));
  for (const file of files) {
    const sessionId = basename(file.name, ".jsonl");
    const text = (await readFile(join(directory, file.name), "utf8")).slice(0, maxSessionBytes);
    const records: UnknownRecord[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (isRecord(parsed)) records.push(parsed);
      } catch {
        malformed += 1;
      }
    }
    const matchingRecords = records.filter((record) =>
      typeof record.cwd === "string" ? resolve(record.cwd) === targetDir : exactDirectory
    );
    if (matchingRecords.length === 0) continue;
    if (matchingRecords.some((record) => {
      if (record.type !== "user") return false;
      const message = isRecord(record.message) ? record.message : undefined;
      return isInternalAdvisorText(message?.content ?? record.content);
    })) continue;
    const timestamps = matchingRecords.map(recordTimestamp).filter((value): value is number => value !== undefined);
    sessions.push({
      source: "claude",
      id: sessionId,
      file: file.name,
      records: matchingRecords,
      updatedAt: timestamps.length > 0 ? Math.max(...timestamps) : file.mtimeMs
    });
  }
  return { directory, sessions, malformed, discovered: files.length };
}

async function collectClaude(
  targetDir: string,
  transcriptsDir: string | undefined,
  lookback: AdviceSessionLookback,
  now: number
): Promise<AdviceSessionEvidence> {
  const indexed = await indexClaudeSessions(targetDir, transcriptsDir);
  const eligible = indexed.sessions.filter((session) => withinLookback(session.updatedAt, lookback, now));
  const signals: AdviceEvidence[] = [];
  for (const session of eligible) {
    for (const record of session.records) signalsFromClaudeRecord(record, session.id, signals);
  }

  if (eligible.length > 0) {
    const exactDirectory = resolve(indexed.directory) === resolve(defaultTranscriptDir(targetDir));
    const eligibleFiles = new Set(eligible.map((session) => session.file));
    const failures = await extractCandidateEvents(indexed.directory, {
      fileFilter: (fileName) => eligibleFiles.has(fileName),
      recordFilter: (record) => typeof record.cwd === "string" ? resolve(record.cwd) === targetDir : exactDirectory
    });
    for (const event of failures.events) {
      addSignal(signals, {
        source: "claude",
        kind: "failed-command",
        summary: `${event.command}: ${event.reason}`,
        sessionId: "aggregate",
        occurrences: event.count
      });
    }
  }

  const notes = indexed.malformed > 0 ? [`Skipped ${indexed.malformed} malformed Claude session record(s).`] : [];
  const funnel = sourceFunnel("claude", eligible.length, signals, indexed.malformed);
  const source = funnel.sources[0]!;
  source.discovered = indexed.discovered;
  source.eligible = eligible.length;
  source.read = eligible.length;
  source.parsed = eligible.length;
  source.discarded.filtering = Math.max(indexed.discovered - eligible.length, 0);
  return {
    sources: [{ source: "claude", count: eligible.length }], signals, notes,
    funnel
  };
}

function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function resultRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function codexThreadTimestamp(summary: UnknownRecord): number {
  return timestampMs(summary.updatedAt) ?? timestampMs(summary.createdAt) ?? 0;
}

async function listCodexThreadSummaries(
  client: CodexAppServerClient,
  targetDir: string,
  lookback: AdviceSessionLookback,
  now: number
): Promise<{ threads: UnknownRecord[]; discovered: number; filtered: number }> {
  const threads: UnknownRecord[] = [];
  let discovered = 0;
  let filtered = 0;
  let cursor: string | undefined;
  let scanned = 0;
  const seenCursors = new Set<string>();
  const cutoff = cutoffMs(lookback, now);
  do {
    const result = resultRecord(await client.request("thread/list", {
      cwd: targetDir,
      cursor: cursor ?? null,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"]
    }));
    const page = recordArray(result.data);
    discovered += page.length;
    scanned += page.length;
    for (const summary of page) {
      if (typeof summary.id !== "string") { filtered += 1; continue; }
      if (typeof summary.cwd === "string" && resolve(summary.cwd) !== targetDir) { filtered += 1; continue; }
      if (typeof summary.preview === "string" && summary.preview.toLowerCase().includes(internalAdvisorMarker)) { filtered += 1; continue; }
      if (withinLookback(codexThreadTimestamp(summary), lookback, now)) threads.push(summary);
      else filtered += 1;
    }
    const oldest = page.length > 0 ? codexThreadTimestamp(page[page.length - 1]!) : undefined;
    if (cutoff !== undefined && oldest !== undefined && oldest > 0 && oldest < cutoff) break;
    const next = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  } while (scanned < 500);
  return { threads, discovered, filtered };
}

async function readCodexThreads(client: CodexAppServerClient, summaries: UnknownRecord[], targetDir: string): Promise<UnknownRecord[]> {
  const exact: UnknownRecord[] = [];
  for (const summary of summaries) {
    const read = resultRecord(await client.request("thread/read", { threadId: summary.id, includeTurns: true }));
    const thread = resultRecord(read.thread);
    const cwd = typeof thread.cwd === "string" ? resolve(thread.cwd) : typeof summary.cwd === "string" ? resolve(summary.cwd) : undefined;
    if (cwd !== targetDir) continue;
    const internal = recordArray(thread.turns).some((turn) => recordArray(turn.items).some((item) =>
      item.type === "userMessage" && isInternalAdvisorText(item.content)
    ));
    if (internal) continue;
    exact.push(thread);
  }
  return exact;
}

function signalsFromCodexThread(thread: UnknownRecord, signals: AdviceEvidence[]): void {
  const sessionId = typeof thread.id === "string" ? thread.id : "unknown";
  for (const turn of recordArray(thread.turns)) {
    for (const item of recordArray(turn.items)) {
      const type = typeof item.type === "string" ? item.type : "";
      if (type === "reasoning") continue;
      if (type === "userMessage") {
        for (const text of visibleTextBlocks(item.content)) {
          if (isCorrection(text)) addSignal(signals, { source: "codex", kind: "correction", summary: text, sessionId });
          else if (looksLikeManualWorkflow(text)) addSignal(signals, { source: "codex", kind: "manual-workflow", summary: text, sessionId });
        }
      } else if (type === "agentMessage" && typeof item.text === "string" && looksLikeOutcome(item.text)) {
        addSignal(signals, { source: "codex", kind: "outcome", summary: item.text, sessionId });
      } else if (type === "commandExecution" && typeof item.command === "string") {
        const failed = item.status === "failed" || (typeof item.exitCode === "number" && item.exitCode !== 0);
        if (failed) {
          addSignal(signals, { source: "codex", kind: "failed-command", summary: `${item.command}: ${String(item.aggregatedOutput ?? item.status ?? "failed")}`, sessionId });
        } else if (isVerificationCommand(item.command)) {
          addSignal(signals, { source: "codex", kind: "verification", summary: item.command, sessionId });
        }
      } else if (type === "webSearch") {
        addSignal(signals, { source: "codex", kind: "external-lookup", summary: String(item.query ?? "web search"), sessionId });
      } else if (type === "mcpToolCall") {
        addSignal(signals, { source: "codex", kind: "external-lookup", summary: `${String(item.server ?? "MCP")}/${String(item.tool ?? "tool")}`, sessionId });
      } else if (type === "collabToolCall") {
        addSignal(signals, { source: "codex", kind: "delegation", summary: String(item.prompt ?? item.tool ?? "specialist delegation"), sessionId });
      } else if (type === "fileChange") {
        const paths = recordArray(item.changes).map((change) => String(change.path ?? change.file ?? "")).filter(isAgentGuidancePath);
        for (const path of paths) addSignal(signals, { source: "codex", kind: "guidance-edit", summary: `Updated agent guidance/configuration: ${path}`, sessionId });
      }
    }
  }
}

async function collectCodex(
  targetDir: string,
  clientFactory: CodexAppServerFactory,
  lookback: AdviceSessionLookback,
  now: number
): Promise<AdviceSessionEvidence> {
  if (!Bun.which("codex") && clientFactory === createCodexAppServerClient) {
    return { sources: [{ source: "codex", count: 0 }], signals: [], notes: ["Codex is unavailable; Codex sessions were not read."], funnel: sourceFunnel("codex", 0, []) };
  }
  let client: CodexAppServerClient | undefined;
  try {
    client = await clientFactory();
    const listed = await listCodexThreadSummaries(client, targetDir, lookback, now);
    const threads = await readCodexThreads(client, listed.threads, targetDir);
    const signals: AdviceEvidence[] = [];
    for (const thread of threads) signalsFromCodexThread(thread, signals);
    const funnel = sourceFunnel("codex", threads.length, signals);
    const source = funnel.sources[0]!;
    source.discovered = listed.discovered;
    source.eligible = listed.threads.length;
    source.read = listed.threads.length;
    source.parsed = threads.length;
    source.discarded.filtering = listed.filtered + Math.max(listed.threads.length - threads.length, 0);
    return { sources: [{ source: "codex", count: threads.length }], signals, notes: [], funnel };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sources: [{ source: "codex", count: 0 }], signals: [], notes: [`Codex sessions unavailable: ${message}`], funnel: sourceFunnel("codex", 0, []) };
  } finally {
    await client?.close();
  }
}

export async function discoverProjectSessionCounts(input: {
  targetDir: string;
  targets?: AdviceVendor[];
  codexClientFactory?: CodexAppServerFactory;
  claudeTranscriptsDir?: string;
  now?: number;
}): Promise<AdviceSessionCountInventory> {
  const targetDir = resolve(input.targetDir);
  const targets = input.targets ?? ["claude", "codex"];
  const now = input.now ?? Date.now();
  const sessions: DatedSession[] = [];
  if (targets.includes("claude")) {
    const claude = await indexClaudeSessions(targetDir, input.claudeTranscriptsDir);
    sessions.push(...claude.sessions);
  }
  if (targets.includes("codex")) {
    const clientFactory = input.codexClientFactory ?? createCodexAppServerClient;
    if (Bun.which("codex") || clientFactory !== createCodexAppServerClient) {
      let client: CodexAppServerClient | undefined;
      try {
        client = await clientFactory();
        const summaries = await listCodexThreadSummaries(client, targetDir, "all", now);
        sessions.push(...summaries.threads.map((summary) => ({
          source: "codex" as const,
          id: String(summary.id),
          updatedAt: codexThreadTimestamp(summary)
        })));
      } catch {
        // Discovery is advisory; the analysis run will report detailed session errors.
      } finally {
        await client?.close();
      }
    }
  }
  return countInventory(sessions, targets, now);
}

export async function collectProjectSessionEvidence(input: {
  targetDir: string;
  targets?: AdviceVendor[];
  codexClientFactory?: CodexAppServerFactory;
  claudeTranscriptsDir?: string;
  lookback?: AdviceSessionLookback;
  now?: number;
}): Promise<AdviceSessionEvidence> {
  const targetDir = resolve(input.targetDir);
  const targets = input.targets ?? ["claude", "codex"];
  const lookback = input.lookback ?? "7d";
  const now = input.now ?? Date.now();
  const results = await Promise.all([
    targets.includes("claude") ? collectClaude(targetDir, input.claudeTranscriptsDir, lookback, now) : Promise.resolve(undefined),
    targets.includes("codex") ? collectCodex(targetDir, input.codexClientFactory ?? createCodexAppServerClient, lookback, now) : Promise.resolve(undefined)
  ]);
  const included = results.filter((result): result is AdviceSessionEvidence => result !== undefined);
  const signals = selectFairSignals(included);
  const sourceFunnels = included.flatMap((result) => result.funnel?.sources ?? []);
  for (const source of sourceFunnels) {
    const retained = signals.filter((signal) => signal.source === source.source).length;
    source.discarded.limits = Math.max(source.retainedPatterns - retained, 0);
    source.retainedPatterns = retained;
  }
  return {
    sources: included.flatMap((result) => result.sources),
    signals,
    notes: included.flatMap((result) => result.notes),
    funnel: {
      sources: sourceFunnels,
      visibleEvents: sourceFunnels.reduce((sum, source) => sum + source.visibleEvents, 0),
      recurringPatterns: signals.filter((signal) => (signal.distinctSessions ?? 0) >= 2 || (signal.occurrences ?? 1) >= 2).length
    }
  };
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/tui/create-app.tsx
```tsx
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { loadFarrierConfig, resolveModelSettings, type ModelsConfig } from "../config/farrier-config";
import { probeAgents, type AgentAvailability } from "../engine/backend";
import {
  createSkills,
  type CreateAgent,
  type SkillCreationOutcome,
  type SkillCreationRequest
} from "../engine/create-skill";
import { detectPacks } from "../engine/detect";
import { createQueuedCollisionHandler, type CollisionPrompt } from "./collision";
import { eligiblePerAgentEvals, nextEvalPolicy, SkillEvalFlow, type PendingSkillEval, type SkillEvalPolicy } from "./create-eval";
import { CreateDoneScreen, CreateProgressScreen, type RequestStatus } from "./create-progress";
import { CreateStep } from "./CreateStep";
import { RefineFlow } from "./RefineScreen";
import { idleExitBindings, resolveIntent } from "./keymap";

type Phase = "form" | "questions" | "writing" | "done" | "eval";

type CreateAppProps = {
  targetDir: string;
  models: ModelsConfig;
  initialRequests?: SkillCreationRequest[];
  onExit: (code: number, message?: string) => void;
};

function CreateApp(props: CreateAppProps) {
  const [availability, setAvailability] = useState<AgentAvailability | undefined>(undefined);
  const [requests, setRequests] = useState<SkillCreationRequest[]>(props.initialRequests ?? []);
  const [outcomes, setOutcomes] = useState<SkillCreationOutcome[]>([]);
  const [statuses, setStatuses] = useState<RequestStatus[]>([]);
  const [phase, setPhase] = useState<Phase>("form");
  const [cancelling, setCancelling] = useState(false);
  const [refine, setRefine] = useState(true);
  const [packId, setPackId] = useState<string | undefined>(undefined);
  // Requests grill sequentially — each question adapts to the prior answers, so
  // one request's interview must finish before the next begins.
  const [grillIndex, setGrillIndex] = useState(0);
  const [collision, setCollision] = useState<CollisionPrompt | null>(null);
  const [pendingEval, setPendingEval] = useState<PendingSkillEval | null>(null);
  const [evalPolicy, setEvalPolicy] = useState<SkillEvalPolicy>("ask");
  const abortRef = useRef<AbortController | null>(null);
  // Concurrent runs can collide at once; prompts are shown one at a time.
  const collisionChainRef = useRef<Promise<void>>(Promise.resolve());

  const refineBackend: CreateAgent | undefined = availability?.claude ? "claude" : availability?.codex ? "codex" : undefined;
  const evalBackend = refineBackend;

  // exitOnCtrlC is off (it would orphan the spawned agent runs), so ctrl+c is
  // handled here for the phases that don't handle it themselves.
  useKeyboard((key) => {
    if (resolveIntent(idleExitBindings, key) !== "quit") {
      return;
    }

    if (phase === "form" || phase === "questions") {
      props.onExit(1, "farrier skill new: cancelled — nothing created.");
    } else if (phase === "done") {
      props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0);
    }
    // "eval" is handled inside SkillEvalFlow (its progress screen cancels on ctrl+c).
  });

  useEffect(() => {
    let cancelled = false;

    probeAgents()
      .then((probed) => {
        if (!cancelled) {
          setAvailability(probed);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailability({ claude: false, codex: false });
        }
      });

    detectPacks(props.targetDir)
      .then((packs) => {
        if (!cancelled) {
          setPackId(packs[0]);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [props.targetDir]);

  useEffect(() => {
    if (phase !== "writing") {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;

    setStatuses(requests.map(() => ({ kind: "pending" })));

    const onCollision = createQueuedCollisionHandler({ signal: controller.signal, chainRef: collisionChainRef, setCollision });

    // Concurrent authoring (each run has its own staging root); lock-touching
    // installs are serialized inside createSkills.
    const modelSettings = {
      claude: resolveModelSettings({ models: props.models, backend: "claude", role: "skillCreation" }),
      codex: resolveModelSettings({ models: props.models, backend: "codex", role: "skillCreation" })
    };

    createSkills(requests, props.targetDir, { signal: controller.signal, onCollision, modelSettings }, (event) => {
      if (cancelled) {
        return;
      }

      setStatuses((current) =>
        current.map((status, index) => {
          if (index !== event.index) {
            return status;
          }

          if (event.phase === "done") {
            return { kind: "done", outcome: event.outcome };
          }

          // Per-agent runs stream concurrently into one row; keep the latest
          // activity line from each agent.
          const activities = status.kind === "running" ? { ...status.activities } : {};

          if (event.agent && event.activity) {
            activities[event.agent] = event.activity;
          }

          return { kind: "running", phase: event.phase, agent: event.agent, activities };
        })
      );
    }).then((results) => {
      if (cancelled) {
        return;
      }

      setOutcomes(results);

      // Per-agent pairs go straight to the eval unless the user chose skip on
      // the form. evalPolicy is frozen once the form is submitted, so reading
      // it from the closure here is safe.
      const candidate = evalPolicy === "skip" ? undefined : eligiblePerAgentEvals(results)[0];

      if (candidate) {
        setPendingEval(candidate);
        setPhase("eval");
      } else {
        setPhase("done");
      }
    });

    return () => {
      cancelled = true;
      // Unmounting mid-run (process exit) must not leave agent runs behind.
      controller.abort();
    };
  }, [phase, props.targetDir, requests]);

  switch (phase) {
    case "form":
      return (
        <CreateStep
          requests={requests}
          availability={availability}
          standalone
          onAddRequest={(request) => setRequests((current) => [...current, request])}
          onRemoveRequest={(index) => setRequests((current) => current.filter((_, i) => i !== index))}
          refine={refine}
          refineBackend={refineBackend}
          onToggleRefine={() => setRefine((current) => !current)}
          evalPolicy={evalPolicy}
          onCycleEvalPolicy={() => setEvalPolicy(nextEvalPolicy)}
          onSubmit={(pending) => {
            const all = pending ? [...requests, pending] : requests;

            if (all.length === 0) {
              props.onExit(0, "farrier skill new: nothing to create — exited.");
              return;
            }

            setRequests(all);
            setGrillIndex(0);
            setPhase(refine && refineBackend ? "questions" : "writing");
          }}
          onBack={() =>
            props.onExit(
              1,
              requests.length === 0
                ? "farrier skill new: cancelled — nothing created."
                : `farrier skill new: cancelled — ${requests.length} queued skill(s) discarded, nothing created.`
            )
          }
          onQuit={() => props.onExit(1, "farrier skill new: cancelled — nothing created.")}
        />
      );

    case "questions": {
      const request = requests[grillIndex];

      if (!request || !refineBackend) {
        return null;
      }

      const refineSettings = resolveModelSettings({ models: props.models, backend: refineBackend, role: "refine" });

      return (
        <RefineFlow
          key={grillIndex}
          request={request}
          backend={refineBackend}
          targetDir={props.targetDir}
          packId={packId}
          model={refineSettings.model}
          reasoningEffort={refineSettings.reasoningEffort}
          progressLabel={requests.length > 1 ? `skill ${grillIndex + 1} of ${requests.length}` : undefined}
          onDone={(refined) => {
            setRequests((current) => current.map((item, index) => (index === grillIndex ? refined : item)));

            if (grillIndex + 1 >= requests.length) {
              setGrillIndex(0);
              setPhase("writing");
            } else {
              setGrillIndex(grillIndex + 1);
            }
          }}
          onQuit={() => props.onExit(1, "farrier skill new: cancelled — nothing created.")}
        />
      );
    }

    case "writing":
      return (
        <CreateProgressScreen
          requests={requests}
          statuses={statuses}
          cancelling={cancelling}
          collision={collision}
          onCancel={() => {
            setCancelling(true);
            abortRef.current?.abort();
            // A pending replace-prompt would otherwise hold the run open.
            collision?.resolve("keep");
          }}
        />
      );

    case "done": {
      const evalCandidate = eligiblePerAgentEvals(outcomes)[0];
      return (
        <CreateDoneScreen
          outcomes={outcomes}
          evalCandidate={evalCandidate}
          onEvaluate={() => {
            if (evalCandidate) {
              setPendingEval(evalCandidate);
              setPhase("eval");
            }
          }}
          onExit={() => props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0)}
        />
      );
    }

    case "eval":
      return pendingEval ? (
        <SkillEvalFlow
          targetDir={props.targetDir}
          candidate={pendingEval}
          backend={evalBackend}
          autoApply={evalPolicy === "auto"}
          onClose={() => setPhase("done")}
          onExit={() => props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0)}
        />
      ) : (
        <CreateDoneScreen
          outcomes={outcomes}
          onEvaluate={() => undefined}
          onExit={() => props.onExit(outcomes.some((outcome) => outcome.error) ? 1 : 0)}
        />
      );
  }
}

export async function runCreateWizard(targetDir: string, initialRequests: SkillCreationRequest[] = []): Promise<number> {
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;

  const models = await loadFarrierConfig({ projectDir: targetDir })
    .then((loaded) => loaded.config.models)
    .catch(() => ({}) as ModelsConfig);

  try {
    // The default ctrl+c handler destroys the renderer without resolving
    // anything, orphaning spawned claude/codex runs; CreateApp handles ctrl+c
    // itself and aborts them.
    renderer = await createCliRenderer({ exitOnCtrlC: false });
    const cliRenderer = renderer;

    return await new Promise<number>((resolve) => {
      let settled = false;

      const finish = (code: number, message?: string) => {
        if (settled) {
          return;
        }

        settled = true;
        cliRenderer.destroy();

        if (message) {
          console.error(message);
        }

        resolve(code);
      };

      createRoot(cliRenderer).render(<CreateApp targetDir={targetDir} models={models} initialRequests={initialRequests} onExit={finish} />);
    });
  } catch (error) {
    renderer?.destroy();
    console.error(`farrier skill new: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/konsistent.json
```json
{
  "$schema": "node_modules/konsistent/konsistent.schema.json",
  "version": "v1",
  "conventions": [
    {
      "name": "top-level-project-directories",
      "description": "Farrier keeps runtime TypeScript under src and tests under tests.",
      "paths": [
        "src",
        "tests"
      ],
      "must": {
        "haveType": "directory"
      }
    },
    {
      "name": "source-subsystems-exist",
      "description": "The main source tree is split into CLI, engine, packs, and TUI subsystems.",
      "paths": [
        "src/cli",
        "src/engine",
        "src/packs",
        "src/tui"
      ],
      "must": {
        "haveType": "directory"
      }
    },
    {
      "name": "pack-modules-export-pack",
      "description": "Each stack pack module exports a Pack named after the file.",
      "paths": [
        "src/packs/{packId}.ts",
        "!src/packs/index.ts",
        "!src/packs/merge.ts",
        "!src/packs/types.ts"
      ],
      "must": {
        "importTypes": [
          {
            "name": "Pack",
            "from": "./types"
          }
        ],
        "export": [
          "${packId.toCamelCase()}Pack"
        ]
      }
    },
    {
      "name": "engine-modules-should-have-direct-tests",
      "description": "Engine modules should have a direct tests/<module>.test.ts file so structural coverage is easy to find.",
      "paths": "tests",
      "must": {
        "haveFiles": [
          "advise.test.ts",
          "advice-sessions.test.ts",
          "backend.test.ts",
          "create-skill.test.ts",
          "detect.test.ts",
          "doctor.test.ts",
          "eval-skill.test.ts",
          "learn.test.ts",
          "project-advice.test.ts",
          "refine-skill.test.ts",
          "render.test.ts",
          "skill-validate.test.ts",
          "skills.test.ts",
          "update.test.ts"
        ]
      }
    },
    {
      "name": "cli-subcommands-export-runner",
      "description": "Each CLI subcommand module exports its run function.",
      "paths": "src/cli/{commandName}.ts",
      "must": {
        "exportFunctions": [
          "run${commandName.toPascalCase()}"
        ]
      }
    },
    {
      "name": "engine-does-not-depend-on-tui",
      "description": "Engine code must stay independent of terminal UI components.",
      "paths": "src/engine/*.ts",
      "mustNot": {
        "importFrom": "../tui"
      }
    },
    {
      "name": "packs-do-not-depend-on-engine-or-tui",
      "description": "Pack declarations stay as static data and must not import runtime engine or TUI modules.",
      "paths": "src/packs/*.ts",
      "mustNot": {
        "importFrom": "../engine"
      }
    },
    {
      "name": "cli-does-not-depend-on-tui",
      "description": "CLI subcommands stay non-interactive and do not import TUI components.",
      "paths": "src/cli/*.ts",
      "mustNot": {
        "importFrom": "../tui"
      }
    },
    {
      "name": "tests-use-bun-test",
      "description": "TypeScript tests use Bun's test runner API.",
      "paths": "tests/*.test.ts",
      "must": {
        "import": [
          {
            "name": "test",
            "from": "bun:test"
          }
        ]
      }
    }
  ]
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/templates/skills/farrier-project-advisor/SKILL.md
```md
---
name: farrier-project-advisor
description: Run Farrier's read-only project advisor for Codex, using exact-project session evidence and Codex-native artifact locations.
---

# Farrier Project Advisor for Codex

Use Farrier's shared advice engine rather than inspecting Codex transcript files directly:

```bash
farrier advise --dir . --sessions auto --since 7d --targets codex
```

If `farrier` is not on `PATH`, use `bunx farrier` or `npx farrier` with the same arguments. Add `--since 14d` for a wider recent window or `--since all` only for an explicit full-history request. Add `--json` for the validated report schema. Add `--sessions none` when the user wants codebase-only analysis.

For a focused report, pass `--only guidance`, `--only hooks`, `--only subagents`, `--only plugins`, or `--only mcp`. `--only skills` preserves Farrier's registry-backed skill-only advisor.

## Codex routes

- Durable shared guidance: `AGENTS.md`
- Codex project lifecycle hooks: `.codex/hooks.json`; trust the project, then inspect and approve exact commands through `/hooks`
- Reusable project skills: `.agents/skills/<name>/SKILL.md`
- Specialist agents: the project Codex configuration surface
- Plugins and MCP servers: verified Codex project configuration references

## Safety

- The workflow is report-only and must not mutate project configuration.
- Farrier reads Codex sessions through App Server `thread/list` and read-only `thread/read`, filtered to the exact resolved `cwd`.
- Codex selection consumes and targets Codex evidence only. Claude evidence and Claude-only artifact routes are rejected; compatible shared routes remain.
- Farrier normalizes, bounds, and redacts evidence locally and never consumes hidden reasoning records.
- Never turn a hook recommendation into executable code unless the user separately asks to implement it.
- Treat Codex hooks as partial enforcement: simple Bash, `apply_patch`, and Stop mappings do not cover every `unified_exec`, native read/search, or WebSearch path, and PostToolUse cannot undo completed effects.

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/cli.ts
```ts
#!/usr/bin/env bun

import { resolve } from "node:path";
import { runAdvise } from "./cli/advise";
import { parseCreateArgs, runCreate } from "./cli/create";
import { runDoctor } from "./cli/doctor";
import { runRegistry } from "./cli/registry";
import { runSkillEval } from "./cli/skill-eval";
import { runSkillNew } from "./cli/skill-new";
import { runUpdate } from "./cli/update";
import { loadFarrierConfig, resolveModelSettings } from "./config/farrier-config";
import { applyLearn, createLearnReport, formatLearnApplyResult, formatLearnReport, type LearnBackend } from "./engine/learn";
import { supportedPackIds } from "./packs/index";

type LearnCliOptions = {
  dir: string;
  transcripts?: string;
  yes: boolean;
  json: boolean;
  noLlm: boolean;
  backend: LearnBackend;
  model?: string;
  help: boolean;
};

function usage(): string {
  return `farrier CLI

Usage:
  farrier
  farrier --stack python-fastapi --agents claude|codex|claude,codex --yes --dir <target>
  farrier --stack python-fastapi --agents claude|codex|claude,codex --dry-run --dir <target>
  farrier --detect --agents claude|codex|claude,codex --yes --dir <target>
  farrier --detect --agents claude|codex|claude,codex --dry-run --dir <target>
  farrier update --dir <target> [--yes] [--json]
  farrier registry list [--dir <target>] [--json]
  farrier learn --dir <target> [--transcripts <dir>] [--yes] [--no-llm] [--backend claude|codex] [--model <name>] [--json]
  farrier doctor --dir <target> [--json]
  farrier advise --dir <target> [--sessions auto|none] [--since 7d|14d|all] [--targets claude,codex] [--only guidance,hooks,skills,subagents,plugins,mcp] [--backend claude|codex] [--model <name>] [--json]
  farrier advise skills [--dir <target>] [--context <path|text>] [--backend claude|codex] [--json]
  farrier skill new "<description>" --yes [--dir <target>] [--agents claude,codex] [--mode author-claude|author-codex|per-agent] [--name <kebab>] [--no-llm] [--json]
  farrier skill eval <skill-name> [--dir <target>] [--backend claude|codex] [--json]

Options:
  --stack <id>        Stack pack to render. Supported: ${supportedPackIds().join(", ")}
  --detect            Detect stack from target directory. Mutually exclusive with --stack.
  --dir <path>        Target directory. Defaults to current working directory.
  --context <path|text> Project context for the harness wizard or legacy skill-only advice.
  --agents <vendors>   Enforcement targets: claude, codex, or claude,codex. Defaults to claude.
  --yes               Required for render writes. Applies repairs for update. Appends accepted learned rules for learn.
  --dry-run           Explain the creation plan and file actions; write nothing.
  --force             With --yes, replace reviewed conflicting files and keep backups. Never bypasses path blockers.
  --no-skills         Do not install the selected pack skills after writing (useful offline).
  --json              Emit a machine-readable report, including creation previews and results.
  --transcripts <dir> Claude JSONL transcript directory for learn. Defaults to ~/.claude/projects/<target-slug>.
  --no-llm            Use deterministic learn proposals without calling claude or codex.
  --sessions <mode>   Advice session evidence: auto or none. Exact project directories only.
  --since <window>    Advice session lookback: 7d (default), 14d, or all.
  --targets <vendors> Advice target vendors: claude,codex.
  --only <categories> Limit advice to guidance,hooks,skills,subagents,plugins,mcp.
  --backend <name>    Learn/advise proposal backend: claude or codex. Defaults to claude for learn, auto-detected for advise.
  --model <name>      Learn/advise proposal backend model. Defaults to backend-specific low-cost model.
  --help              Show this help.

Note:
  Bare farrier (optionally with only --context/--dir) launches the TUI wizard only when stdout is a TTY.
  The generic pack is explicit-only; use --stack generic when detection finds no match.
  Creation refuses existing Farrier projects; use update for an existing .farrier.json.
  --yes approves a conflict-free plan. Replacing existing differing files additionally requires --force.
  farrier registry list shows configured private registries without executing payloads.
  farrier learn is report-only unless --yes is provided; it appends new declarative ToolPolicyRule data only.
  farrier doctor exits 0 when healthy and 1 when static harness health errors are found.
  Headless farrier advise is report-only. The interactive report can create a selected recommendation only after review and confirmation.`;
}

function parseBackend(value: string): LearnBackend {
  if (value === "claude" || value === "codex") {
    return value;
  }

  throw new Error("--backend must be claude or codex");
}

function parseLearnArgs(args: string[]): LearnCliOptions {
  const options: LearnCliOptions = {
    dir: process.cwd(),
    yes: false,
    json: false,
    noLlm: false,
    backend: "claude",
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--no-llm") {
      options.noLlm = true;
      continue;
    }

    if (arg === "--dir") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--dir requires a value");
      }
      options.dir = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--dir=")) {
      options.dir = arg.slice("--dir=".length);
      continue;
    }

    if (arg === "--transcripts") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--transcripts requires a value");
      }
      options.transcripts = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--transcripts=")) {
      options.transcripts = arg.slice("--transcripts=".length);
      continue;
    }

    if (arg === "--backend") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--backend requires a value");
      }
      options.backend = parseBackend(value);
      i += 1;
      continue;
    }

    if (arg.startsWith("--backend=")) {
      options.backend = parseBackend(arg.slice("--backend=".length));
      continue;
    }

    if (arg === "--model") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--model requires a value");
      }
      options.model = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--model=")) {
      options.model = arg.slice("--model=".length);
      continue;
    }

    throw new Error(`Unknown learn argument: ${arg}`);
  }

  return options;
}

async function runLearn(args: string[]): Promise<number> {
  const options = parseLearnArgs(args);

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targetDir = resolve(options.dir);
  const transcriptsDir = options.transcripts ? resolve(options.transcripts) : undefined;

  const models = await loadFarrierConfig({ projectDir: targetDir })
    .then((loaded) => loaded.config.models)
    .catch(() => ({}));
  const learnSettings = resolveModelSettings({
    models,
    backend: options.backend ?? "claude",
    role: "learn",
    explicitModel: options.model,
  });

  if (options.yes) {
    const result = await applyLearn({
      targetDir,
      transcriptsDir,
      yes: true,
      json: options.json,
      noLlm: options.noLlm,
      backend: options.backend,
      model: learnSettings.model,
      reasoningEffort: learnSettings.reasoningEffort,
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ...result.report,
            applied: {
              appendedRules: result.appendedRules,
              skippedExistingIds: result.skippedExistingIds,
              rulesPath: result.rulesPath,
            },
          },
          null,
          2,
        ),
      );
      return 0;
    }

    console.log(formatLearnApplyResult(result).trimEnd());
    return 0;
  }

  const report = await createLearnReport({
    targetDir,
    transcriptsDir,
    yes: false,
    json: options.json,
    noLlm: options.noLlm,
    backend: options.backend,
    model: learnSettings.model,
    reasoningEffort: learnSettings.reasoningEffort,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(formatLearnReport(report).trimEnd());
  return 0;
}

export async function main(args: string[] = Bun.argv.slice(2)): Promise<number> {
  try {
    if (args[0] === "update") {
      return await runUpdate(args.slice(1), usage);
    }

    if (args[0] === "registry") {
      return await runRegistry(args.slice(1), usage);
    }

    if (args[0] === "learn") {
      return await runLearn(args.slice(1));
    }

    if (args[0] === "doctor") {
      return await runDoctor(args.slice(1), usage);
    }

    if (args[0] === "advise") {
      return await runAdvise(args.slice(1));
    }

    if (args[0] === "skill") {
      if (args[1] === "new") {
        return await runSkillNew(args.slice(2));
      }

      if (args[1] === "eval") {
        return await runSkillEval(args.slice(2));
      }

      console.error('farrier: unknown skill subcommand. Usage: farrier skill new "<description>" [--help] or farrier skill eval <name> [--help]');
      return 1;
    }

    if (process.stdout.isTTY === true && !args.includes("--json")) {
      const renderOptions = parseCreateArgs(args);

      if (
        !renderOptions.help &&
        !renderOptions.stack &&
        !renderOptions.detect &&
        !renderOptions.yes &&
        !renderOptions.dryRun &&
        !renderOptions.force &&
        !renderOptions.json &&
        renderOptions.installSkills
      ) {
        const { runLauncher } = await import("./tui/launcher");
        let choice = await runLauncher();

        while (choice === "advise") {
          const { runAdviceWizard } = await import("./tui/advise-app");
          const outcome = await runAdviceWizard(resolve(renderOptions.dir));

          if (typeof outcome === "object" && outcome.kind === "create-skill") {
            const { runCreateWizard } = await import("./tui/create-app");
            return await runCreateWizard(resolve(renderOptions.dir), [outcome.request]);
          }

          if (outcome === "done") {
            return 0;
          }

          if (outcome === "cancel") {
            console.error("farrier: cancelled.");
            return 1;
          }

          choice = await runLauncher();
        }

        if (choice === "create") {
          const { runCreateWizard } = await import("./tui/create-app");
          return await runCreateWizard(resolve(renderOptions.dir));
        }

        if (choice === "harness") {
          const { runWizard } = await import("./tui/app");
          return await runWizard(resolve(renderOptions.dir), {
            context: renderOptions.context,
          });
        }

        console.error("farrier: cancelled.");
        return 1;
      }
    }

    if (args.length === 0) {
      console.error("Bare TUI wizard mode requires a TTY. Use --stack <id> --yes --dir <target> for headless render.");
      console.error("");
      console.error(usage());
      return 1;
    }

    return await runCreate(args, usage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`farrier: ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/tests/tui-parity.test.ts
```ts
import { describe, expect, test } from "bun:test";
import type { ApplyHarnessChangePlanResult } from "../src/engine/create-plan";
import type { DetectedPackEvidence } from "../src/engine/detect";
import type { Pack, ResolvedPack } from "../src/packs/types";
import { builtinCatalog } from "../src/registry/catalog";
import { createInitialWizardState, wizardReducer } from "../src/tui/machine";
import { detectedPackPresentations, generatorPresentation, selectedPackForWizard, stackSelectionAssumption } from "../src/tui/pack-presentation";
import { wizardWriteExitCode } from "../src/tui/wizard-done";
import { currentHarnessReview, type HarnessReviewInput, type StoredHarnessReview } from "../src/tui/use-harness-review";
import { reviewPreviewOffset, type ReviewFile } from "../src/tui/ReviewStep";

const detected: DetectedPackEvidence[] = [
  { packId: "python-fastapi", evidence: ["pyproject.toml dependency: fastapi"] },
  { packId: "python-uv", evidence: ["pyproject.toml"] },
];

const applyResult: ApplyHarnessChangePlanResult = {
  written: ["AGENTS.md"],
  unchanged: ["CLAUDE.md"],
  writtenFiles: ["AGENTS.md"],
  unchangedFiles: ["CLAUDE.md"],
  backupDir: ".farrier-staging/backups/2030-01-02T03-04-05-678Z",
};

function writingState() {
  let state = createInitialWizardState({ availablePackIds: ["python-fastapi"], fallbackPackId: "python-fastapi" });
  for (let index = 0; index < 5; index += 1) state = wizardReducer(state, { type: "NEXT" });
  return wizardReducer(state, { type: "START_WRITING" });
}

describe("TUI pack presentation", () => {
  test("shows the detector's actual evidence for every match in most-specific-first order", () => {
    expect(detectedPackPresentations(detected)).toEqual([
      { ...detected[0], rank: 0, label: "detected" },
      { ...detected[1], rank: 1, label: "also detected" },
    ]);
    expect(stackSelectionAssumption("python-fastapi", detected)).toContain("first, most-specific match");
    expect(stackSelectionAssumption("python-uv", detected)).toBe("Explicit override: python-uv selected; detected signals for python-fastapi did not override your choice.");
  });

  test("attributes built-in and inherited generators to the pack that declared them", () => {
    const builtins = builtinCatalog();
    const fastapi = builtins.resolvePack("python-fastapi");
    expect(generatorPresentation(fastapi, builtins)).toEqual({ source: "python-fastapi", command: "uv init --package" });

    const remote: Pack = {
      id: "@acme/demo",
      extends: "python-fastapi",
      detect: {},
      skills: [],
      hooks: [],
      verbs: fastapi.verbs,
    };
    const inherited: ResolvedPack = { ...fastapi, id: remote.id, extends: remote.extends, packIds: [...fastapi.packIds, remote.id] };
    const catalog = { getPack: (id: string) => (id === remote.id ? remote : builtins.getPack(id)) };

    expect(generatorPresentation(inherited, catalog)).toEqual({ source: "python-fastapi", command: "uv init --package" });

    const override = { command: "bun", args: ["run", "setup"], onlyWhenEmptyDir: true };
    const definingRemote: Pack = { ...remote, generator: override };
    const overridden: ResolvedPack = { ...inherited, generator: override };
    expect(generatorPresentation(overridden, { getPack: (id) => (id === remote.id ? definingRemote : builtins.getPack(id)) })).toEqual({ source: "@acme/demo", command: "bun run setup" });
  });

  test("removes deselected registry hook payloads as well as their hook ids", () => {
    const base = builtinCatalog().resolvePack("python-fastapi");
    const registryHook = {
      id: "@acme/guard" as const,
      version: "1.0.0",
      sha256: "abc",
      fromCache: false,
      hookVersion: 1,
      events: [{ event: "PreToolUse" as const }],
      entry: "guard.sh",
      runner: "bash" as const,
      files: [{ path: "guard.sh", content: "#!/bin/sh\n" }],
    };
    const pack = { ...base, hooks: [...base.hooks, registryHook.id], remoteHooks: [registryHook] };
    const selected = selectedPackForWizard(pack, base.hooks);

    expect(selected.hooks).toEqual(base.hooks);
    expect(selected.remoteHooks).toEqual([]);
  });
});

describe("TUI write outcomes", () => {
  test("carries apply evidence and turns a skill-install partial result into a nonzero exit", () => {
    const state = wizardReducer(writingState(), {
      type: "WRITE_DONE",
      message: "Harness files applied; one skill failed.",
      partial: true,
      applyResult,
      installResults: [],
    });

    expect(state.step).toBe("Done");
    expect(state.applyResult).toEqual(applyResult);
    expect(state.writeStatus).toEqual({ ok: false, partial: true, message: "Harness files applied; one skill failed." });
    expect(wizardWriteExitCode(state.writeStatus)).toBe(1);
  });
});

describe("TUI review acceptance", () => {
  test("a completed replacement review becomes unconfirmable when any reviewed input changes", () => {
    const catalog = builtinCatalog();
    const pack = catalog.resolvePack("python-fastapi");
    const input: HarnessReviewInput = {
      active: true,
      targetDir: "/tmp/project",
      catalog,
      pack,
      packId: pack.id,
      selectedSkills: pack.skills,
      selectedHooks: pack.hooks,
      agents: ["claude"],
      learnEnabled: false,
      ruleCount: 3,
    };
    const stored: StoredHarnessReview = {
      input,
      plan: { targetDir: input.targetDir, files: [{ path: "AGENTS.md", content: "replacement\n" }] },
      files: [{ path: "AGENTS.md", content: "replacement\n", action: "replace", purpose: "guidance", requiresForce: true }],
      existingHarness: false,
      blockerCount: 0,
    };
    const changes: HarnessReviewInput[] = [
      { ...input, active: false },
      { ...input, targetDir: "/tmp/other" },
      { ...input, catalog: builtinCatalog() },
      { ...input, pack: catalog.resolvePack("generic") },
      { ...input, packId: "generic" },
      { ...input, selectedSkills: [...input.selectedSkills] },
      { ...input, selectedHooks: [...input.selectedHooks] },
      { ...input, agents: [...input.agents] },
      { ...input, learnEnabled: true },
      { ...input, ruleCount: 4 },
    ];

    expect(currentHarnessReview(stored, input).plan).toBe(stored.plan);
    for (const changed of changes) {
      expect(currentHarnessReview(stored, changed).plan).toBeNull();
    }
  });

  test("review paging clamps at both ends instead of accumulating overshoot", () => {
    const file: ReviewFile = {
      path: "hook.py",
      content: Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n"),
      action: "create",
      purpose: "hook",
      requiresForce: false,
    };
    const end = reviewPreviewOffset(file, 0, 10_000);

    expect(end).toBeGreaterThan(0);
    expect(reviewPreviewOffset(file, end, 10_000)).toBe(end);
    expect(reviewPreviewOffset(file, end, -10_000)).toBe(0);
  });
});

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/update.ts
```ts
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { detectPacks, detectSecondary } from "./detect";
import {
  createRenderPlan,
  getFarrierVersion,
  hookCatalogVersions,
  type FarrierManifestInput,
  type RenderedFile
} from "./render";
import type { HookId, PackHookRef, ResolvedPack, SecondaryDetectionFinding, SkillRef } from "../packs/types";
import { builtinCatalog, type PackCatalog, type RegistryPin } from "../registry/catalog";
import { parseItemRef } from "../registry/ref";
import { normalizeAgents, type EnforcementAgent } from "./agent-selection";
import { applyMutationPlan, fingerprintPath, inspectMutationPlan, type MutationOperation, type PathFingerprint } from "./mutation-transaction";

export const notFarrierProjectMessage = "not a farrier project; run farrier first";

export type InventoryOwnership = "farrier-owned" | "user-mutable" | "manifest";

export type UpdateInput = {
  targetDir: string;
  catalog?: PackCatalog;
};

export type UpdateApplyDeps = {
  beforeTransaction?: () => void | Promise<void>;
};

export type FarrierVersionDrift = {
  manifest: string | null;
  current: string;
  needsUpdate: boolean;
};

export type StackDriftReport = {
  currentPackId: string;
  detectedPackIds: string[];
  hasDrift: boolean;
  suggestedPackId: string | null;
  message: string;
};

export type HookDrift = {
  hookId: PackHookRef;
  manifestVersion: number | null;
  currentVersion: number;
};

export type RegistryPinDrift = {
  id: string;
  type: RegistryPin["type"];
  manifestVersion: string | null;
  currentVersion: string;
  manifestSha256: string | null;
  currentSha256: string;
};

export type UpdateReport = {
  targetDir: string;
  manifestPath: string;
  currentPackId: string;
  currentPackIds: string[];
  agents: EnforcementAgent[];
  farrierVersion: FarrierVersionDrift;
  stackDrift: StackDriftReport;
  unacknowledgedSecondaryFindings: SecondaryDetectionFinding[];
  hookDrift: HookDrift[];
  registryPinDrift: RegistryPinDrift[];
  missingInventoryFiles: string[];
  outdatedOwnedFiles: string[];
  outdatedUserFiles: string[];
  suggestedSkills: SkillRef[];
  notes: string[];
};

export type UpdateApplyResult = {
  report: UpdateReport;
  repairedFiles: string[];
  acknowledgedSecondaryIds: string[];
  suggestedSkillsNotInstalled: SkillRef[];
};

export type NormalizedManifest = {
  farrierVersion: string | null;
  agents: EnforcementAgent[];
  packIds: string[];
  currentPackId: string;
  hookIds: PackHookRef[];
  skills: SkillRef[];
  secondaryAcknowledged: string[];
  learn: {
    enabled: boolean;
  };
  judge?: unknown;
  quality?: unknown;
  versions: {
    farrierManifest: number | null;
    hooks: Record<string, number>;
    prompts?: unknown;
  };
  registry: {
    items: Record<string, RegistryPin>;
  };
};

const userMutableFiles = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "justfile",
  "konsistent.json",
  "konpy.json",
  ".gitignore",
  ".claude/settings.json",
  ".codex/hooks.json",
  ".claude/hooks/tool-policy-rules.json"
]);

const hookIds = Object.keys(hookCatalogVersions) as HookId[];
const hookIdSet = new Set<string>(hookIds);

function targetDirFromInput(input: UpdateInput | string): string {
  return typeof input === "string" ? input : input.targetDir;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  if (!value.every((item) => typeof item === "string")) {
    return undefined;
  }

  return [...value];
}

function requiredStringArray(value: unknown, field: string): string[] {
  const values = stringArray(value);

  if (!values || values.length === 0) {
    throw new Error(`invalid .farrier.json: ${field} must be a non-empty string array`);
  }

  return values;
}

function isHookId(value: string): value is HookId {
  return hookIdSet.has(value);
}

function isSupportedHookId(value: string, catalog: PackCatalog): value is PackHookRef {
  if (isHookId(value)) {
    return true;
  }

  const parsed = parseItemRef(value);
  return Boolean(parsed && catalog.remoteHook(parsed.id));
}

function parseHookIds(value: unknown, fallback: PackHookRef[], catalog: PackCatalog): PackHookRef[] {
  const values = value === undefined ? [...fallback] : stringArray(value);

  if (!values) {
    throw new Error("invalid .farrier.json: hookIds must be a string array");
  }

  const hookIds = values.filter((hookId): hookId is PackHookRef => isSupportedHookId(hookId, catalog));
  if (hookIds.length !== values.length) {
    const invalid = values.find((hookId) => !isSupportedHookId(hookId, catalog));
    throw new Error(`invalid .farrier.json: unsupported hook id '${invalid}'`);
  }

  return hookIds;
}

function parseVersions(value: unknown): NormalizedManifest["versions"] {
  if (!isRecord(value)) {
    return {
      farrierManifest: null,
      hooks: {}
    };
  }

  const hooks: Record<string, number> = {};
  const rawHooks = value.hooks;

  if (isRecord(rawHooks)) {
    for (const [key, item] of Object.entries(rawHooks)) {
      if (typeof item === "number" && Number.isFinite(item)) {
        hooks[key] = item;
      }
    }
  }

  return {
    farrierManifest:
      typeof value.farrierManifest === "number" && Number.isFinite(value.farrierManifest)
        ? value.farrierManifest
        : null,
    hooks,
    prompts: value.prompts
  };
}

function parseRegistry(value: unknown): NormalizedManifest["registry"] {
  if (!isRecord(value) || !isRecord(value.items)) {
    return {
      items: {}
    };
  }

  const items: Record<string, RegistryPin> = {};
  for (const [id, pin] of Object.entries(value.items)) {
    if (!isRecord(pin)) {
      continue;
    }

    if (
      (pin.type === "pack" || pin.type === "hook" || pin.type === "skill") &&
      typeof pin.version === "string" &&
      typeof pin.sha256 === "string"
    ) {
      items[id] = {
        type: pin.type,
        version: pin.version,
        sha256: pin.sha256,
        ...(typeof pin.sourceIdentity === "string" ? { sourceIdentity: pin.sourceIdentity } : {}),
        ...(typeof pin.ref === "string" ? { ref: pin.ref } : {})
      };
    }
  }

  return { items };
}

function parseLearn(value: unknown): { enabled: boolean } {
  if (!isRecord(value)) {
    return {
      enabled: false
    };
  }

  return {
    enabled: value.enabled === true
  };
}

function normalizeManifest(raw: unknown, catalog: PackCatalog): NormalizedManifest {
  if (!isRecord(raw)) {
    throw new Error("invalid .farrier.json: root must be an object");
  }

  const packIds = requiredStringArray(raw.packIds, "packIds");
  const currentPackId = packIds[packIds.length - 1];

  if (!currentPackId) {
    throw new Error("invalid .farrier.json: packIds must be a non-empty string array");
  }

  const resolvedPack = catalog.resolvePack(currentPackId);
  const hookIds = parseHookIds(raw.hookIds, resolvedPack.hooks, catalog);
  const skills = stringArray(raw.skills) ?? [...resolvedPack.skills];
  const secondaryAcknowledged = stringArray(raw.secondaryAcknowledged) ?? [];

  return {
    farrierVersion: optionalString(raw.farrierVersion),
    agents: normalizeAgents(raw.agents),
    packIds,
    currentPackId,
    hookIds,
    skills,
    secondaryAcknowledged,
    learn: parseLearn(raw.learn),
    judge: raw.judge,
    quality: raw.quality,
    versions: parseVersions(raw.versions),
    registry: parseRegistry(raw.registry)
  };
}

function toManifestInput(manifest: NormalizedManifest): FarrierManifestInput {
  return {
    farrierVersion: manifest.farrierVersion ?? undefined,
    agents: [...manifest.agents],
    packIds: [...manifest.packIds],
    hookIds: [...manifest.hookIds],
    skills: [...manifest.skills],
    secondaryAcknowledged: [...manifest.secondaryAcknowledged],
    learn: {
      enabled: manifest.learn.enabled
    },
    judge: manifest.judge,
    quality: manifest.quality,
    versions: {
      farrierManifest: manifest.versions.farrierManifest ?? undefined,
      hooks: { ...manifest.versions.hooks },
      prompts: manifest.versions.prompts
    },
    registry: {
      items: { ...manifest.registry.items }
    }
  };
}

async function readProjectManifest(targetDir: string, catalog: PackCatalog = builtinCatalog()): Promise<NormalizedManifest> {
  const manifestPath = join(targetDir, ".farrier.json");

  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new Error(notFarrierProjectMessage);
    }

    throw error;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid .farrier.json: ${message}`);
  }

  return normalizeManifest(raw, catalog);
}

export async function readManifest(input: UpdateInput | string): Promise<NormalizedManifest> {
  const catalog = typeof input === "string" ? builtinCatalog() : input.catalog ?? builtinCatalog();
  return readProjectManifest(targetDirFromInput(input), catalog);
}

function packForManifest(manifest: NormalizedManifest, catalog: PackCatalog): ResolvedPack {
  const pack = catalog.resolvePack(manifest.currentPackId);

  return {
    ...pack,
    hooks: [...manifest.hookIds]
  };
}

function stackDriftMessage(currentPackId: string, detectedPackIds: string[]): string {
  if (detectedPackIds.length === 0) {
    return "No stack detected; keeping current manifest pack.";
  }

  if (detectedPackIds[0] === currentPackId) {
    return `Detected stack matches current manifest pack '${currentPackId}'.`;
  }

  return `Detected '${detectedPackIds[0]}' but manifest uses '${currentPackId}'. Update will not switch packs automatically.`;
}

function hookDriftForManifestWithCatalog(manifest: NormalizedManifest, catalog: PackCatalog): HookDrift[] {
  const drift: HookDrift[] = [];

  for (const hookId of manifest.hookIds) {
    const currentVersion = isHookId(hookId)
      ? hookCatalogVersions[hookId]
      : catalog.remoteHook(hookId)?.hookVersion;

    if (currentVersion === undefined) {
      continue;
    }

    const manifestVersion = manifest.versions.hooks[hookId] ?? null;

    if (manifestVersion === null || manifestVersion < currentVersion) {
      drift.push({
        hookId,
        manifestVersion,
        currentVersion
      });
    }
  }

  return drift;
}

function registryPinsForManifest(manifest: NormalizedManifest, catalog: PackCatalog): Record<string, RegistryPin> {
  const currentPins = catalog.registryPins();
  return Object.fromEntries(
    Object.keys(manifest.registry.items)
      .map((id) => [id, currentPins[id]])
      .filter((entry): entry is [string, RegistryPin] => entry[1] !== undefined)
  );
}

function registryPinDriftForManifest(manifest: NormalizedManifest, catalog: PackCatalog): RegistryPinDrift[] {
  const currentPins = catalog.latestRegistryPins?.() ?? catalog.registryPins();
  const drift: RegistryPinDrift[] = [];

  for (const [id, manifestPin] of Object.entries(manifest.registry.items)) {
    const currentPin = currentPins[id];
    if (!currentPin) {
      continue;
    }

    if (manifestPin.version !== currentPin.version || manifestPin.sha256 !== currentPin.sha256) {
      drift.push({
        id,
        type: currentPin.type,
        manifestVersion: manifestPin.version,
        currentVersion: currentPin.version,
        manifestSha256: manifestPin.sha256,
        currentSha256: currentPin.sha256
      });
    }
  }

  return drift;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function suggestedSkillsFromFindings(findings: SecondaryDetectionFinding[]): SkillRef[] {
  return unique(findings.flatMap((finding) => finding.suggestSkills));
}

export function inventoryOwnership(path: string): InventoryOwnership {
  if (path === ".farrier.json") {
    return "manifest";
  }

  if (
    path === ".claude/skills/harness-advisor/SKILL.md" ||
    path.startsWith(".claude/skills/claude-automation-recommender/") ||
    path === ".agents/skills/farrier-project-advisor/SKILL.md"
  ) {
    return "farrier-owned";
  }

  if (path.startsWith(".claude/hooks/prompts/") && path.endsWith(".txt")) {
    return "farrier-owned";
  }

  if (path.startsWith(".claude/hooks/@")) {
    return "farrier-owned";
  }

  if (path.startsWith(".claude/hooks/")) {
    const relative = path.slice(".claude/hooks/".length);
    if (!relative.includes("/") && relative.endsWith(".py")) {
      return "farrier-owned";
    }
  }

  if (userMutableFiles.has(path)) {
    return "user-mutable";
  }

  return "user-mutable";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fileContentMatches(path: string, expectedContent: string): Promise<boolean> {
  try {
    const current = await readFile(path, "utf8");
    return current === expectedContent;
  } catch {
    return false;
  }
}

async function modeMatches(path: string, mode: number | undefined): Promise<boolean> {
  if (mode === undefined) {
    return true;
  }

  try {
    const info = await stat(path);
    return (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function classifyInventoryDrift(
  targetDir: string,
  files: RenderedFile[]
): Promise<{
  missingInventoryFiles: string[];
  outdatedOwnedFiles: string[];
  outdatedUserFiles: string[];
}> {
  const missingInventoryFiles: string[] = [];
  const outdatedOwnedFiles: string[] = [];
  const outdatedUserFiles: string[] = [];

  for (const file of files) {
    if (file.path === ".farrier.json") {
      continue;
    }

    const absolutePath = join(targetDir, file.path);

    if (!(await fileExists(absolutePath))) {
      missingInventoryFiles.push(file.path);
      continue;
    }

    const contentMatches = await fileContentMatches(absolutePath, file.content);
    const executableMatches = await modeMatches(absolutePath, file.mode);

    if (contentMatches && executableMatches) {
      continue;
    }

    if (inventoryOwnership(file.path) === "farrier-owned") {
      outdatedOwnedFiles.push(file.path);
    } else {
      outdatedUserFiles.push(file.path);
    }
  }

  return {
    missingInventoryFiles,
    outdatedOwnedFiles,
    outdatedUserFiles
  };
}

function reportNotes(input: {
  stackDrift: StackDriftReport;
  unacknowledgedSecondaryFindings: SecondaryDetectionFinding[];
  hookDrift: HookDrift[];
  registryPinDrift: RegistryPinDrift[];
  missingInventoryFiles: string[];
  outdatedOwnedFiles: string[];
  outdatedUserFiles: string[];
  suggestedSkills: SkillRef[];
}): string[] {
  const notes: string[] = [];

  if (input.stackDrift.hasDrift) {
    notes.push("Stack drift is report-only; update mode will not switch manifest packs automatically.");
  }

  if (input.unacknowledgedSecondaryFindings.length > 0) {
    notes.push("Run update with --yes to acknowledge secondary detector findings in .farrier.json.");
  }

  if (input.hookDrift.length > 0) {
    notes.push("Hook catalog versions differ from manifest metadata; update with --yes refreshes manifest metadata.");
  }

  if (input.registryPinDrift.length > 0) {
    notes.push("Registry item pins differ from the current registry catalog; update with --yes refreshes registry pins.");
  }

  if (input.missingInventoryFiles.length > 0 || input.outdatedOwnedFiles.length > 0) {
    notes.push("Run update with --yes to repair missing files and outdated Farrier-owned files.");
  }

  if (input.outdatedUserFiles.length > 0) {
    notes.push("Manual review required for outdated user-mutable files; update mode will not overwrite them.");
  }

  if (input.suggestedSkills.length > 0) {
    notes.push("Suggested skills are not installed by update mode; install them explicitly if desired.");
  }

  return notes;
}

export async function createUpdateReport(input: UpdateInput | string): Promise<UpdateReport> {
  const targetDir = targetDirFromInput(input);
  const catalog = typeof input === "string" ? builtinCatalog() : input.catalog ?? builtinCatalog();
  const manifest = await readProjectManifest(targetDir, catalog);
  const currentFarrierVersion = await getFarrierVersion();
  const currentPack = catalog.resolvePack(manifest.currentPackId);
  const renderPack = packForManifest(manifest, catalog);

  const detectedPackIds = await detectPacks(targetDir, catalog);
  const stackDrift: StackDriftReport = {
    currentPackId: manifest.currentPackId,
    detectedPackIds,
    hasDrift: detectedPackIds.length > 0 && detectedPackIds[0] !== manifest.currentPackId,
    suggestedPackId: detectedPackIds[0] ?? null,
    message: stackDriftMessage(manifest.currentPackId, detectedPackIds)
  };

  const secondaryFindings = await detectSecondary(targetDir, currentPack);
  const acknowledged = new Set(manifest.secondaryAcknowledged);
  const unacknowledgedSecondaryFindings = secondaryFindings.filter((finding) => !acknowledged.has(finding.id));
  const suggestedSkills = suggestedSkillsFromFindings(unacknowledgedSecondaryFindings);
  const hookDrift = hookDriftForManifestWithCatalog(manifest, catalog);
  const registryPinDrift = registryPinDriftForManifest(manifest, catalog);

  const expectedPlan = await createRenderPlan({
    targetDir,
    pack: renderPack,
    skills: manifest.skills,
    learnEnabled: manifest.learn.enabled,
    secondaryAcknowledged: manifest.secondaryAcknowledged,
    existingManifest: toManifestInput(manifest),
    agents: manifest.agents,
    registryPins: registryPinsForManifest(manifest, catalog)
  });

  const inventoryDrift = await classifyInventoryDrift(targetDir, expectedPlan.files);

  const farrierVersion: FarrierVersionDrift = {
    manifest: manifest.farrierVersion,
    current: currentFarrierVersion,
    needsUpdate: manifest.farrierVersion !== currentFarrierVersion
  };

  const notes = reportNotes({
    stackDrift,
    unacknowledgedSecondaryFindings,
    hookDrift,
    registryPinDrift,
    missingInventoryFiles: inventoryDrift.missingInventoryFiles,
    outdatedOwnedFiles: inventoryDrift.outdatedOwnedFiles,
    outdatedUserFiles: inventoryDrift.outdatedUserFiles,
    suggestedSkills
  });
  notes.push(...catalog.warnings.map((warning) => `${warning.namespace}: ${warning.message}`));

  return {
    targetDir,
    manifestPath: join(targetDir, ".farrier.json"),
    currentPackId: manifest.currentPackId,
    currentPackIds: [...manifest.packIds],
    agents: [...manifest.agents],
    farrierVersion,
    stackDrift,
    unacknowledgedSecondaryFindings,
    hookDrift,
    registryPinDrift,
    missingInventoryFiles: inventoryDrift.missingInventoryFiles,
    outdatedOwnedFiles: inventoryDrift.outdatedOwnedFiles,
    outdatedUserFiles: inventoryDrift.outdatedUserFiles,
    suggestedSkills,
    notes
  };
}

async function manifestContentDiffers(targetDir: string, expectedManifestContent: string): Promise<boolean> {
  try {
    const current = await readFile(join(targetDir, ".farrier.json"), "utf8");
    return current !== expectedManifestContent;
  } catch {
    return true;
  }
}

export async function applyUpdate(input: UpdateInput | string, deps: UpdateApplyDeps = {}): Promise<UpdateApplyResult> {
  const targetDir = targetDirFromInput(input);
  const catalog = typeof input === "string" ? builtinCatalog() : input.catalog ?? builtinCatalog();
  const report = await createUpdateReport({ targetDir, catalog });
  const reviewedFingerprints = new Map<string, PathFingerprint>();
  const initiallyRepairable = new Set([...report.missingInventoryFiles, ...report.outdatedOwnedFiles, ".farrier.json"]);
  await Promise.all([...initiallyRepairable].map(async (path) => {
    reviewedFingerprints.set(path, await fingerprintPath(join(targetDir, path)));
  }));
  const manifest = await readProjectManifest(targetDir, catalog);
  const acknowledgedSecondaryIds = report.unacknowledgedSecondaryFindings.map((finding) => finding.id);
  const secondaryAcknowledged = unique([...manifest.secondaryAcknowledged, ...acknowledgedSecondaryIds]);

  const renderPack = packForManifest(manifest, catalog);
  const plan = await createRenderPlan({
    targetDir,
    pack: renderPack,
    skills: manifest.skills,
    learnEnabled: manifest.learn.enabled,
    secondaryAcknowledged,
    existingManifest: toManifestInput({
      ...manifest,
      secondaryAcknowledged
    }),
    agents: manifest.agents,
    registryPins: registryPinsForManifest(manifest, catalog)
  });

  const repairPaths = new Set<string>([
    ...report.missingInventoryFiles,
    ...report.outdatedOwnedFiles
  ]);

  const manifestFile = plan.files.find((file) => file.path === ".farrier.json");
  if (!manifestFile) {
    throw new Error("render plan did not include .farrier.json");
  }

  if (await manifestContentDiffers(targetDir, manifestFile.content)) {
    repairPaths.add(".farrier.json");
  }

  const operations: MutationOperation[] = plan.files
    .filter((file) => repairPaths.has(file.path))
    .map((file) => ({ kind: "write-file", path: file.path, content: file.content, mode: file.mode }));
  const mutationPlan = await inspectMutationPlan(targetDir, operations);
  for (const operation of mutationPlan.operations) {
    const expected = reviewedFingerprints.get(operation.path);
    if (expected) operation.expected = expected;
  }
  await deps.beforeTransaction?.();
  const transaction = await applyMutationPlan(mutationPlan);
  const repairedFiles = transaction.written;

  return {
    report,
    repairedFiles,
    acknowledgedSecondaryIds,
    suggestedSkillsNotInstalled: [...report.suggestedSkills]
  };
}

function renderList(values: string[], empty: string): string[] {
  if (values.length === 0) {
    return [`  ${empty}`];
  }

  return values.map((value) => `  - ${value}`);
}

function shortSha(value: string | null): string {
  return value ? value.slice(0, 12) : "(missing)";
}

export function formatUpdateReport(report: UpdateReport): string {
  const lines: string[] = [
    `Farrier update report for ${report.targetDir}`,
    "",
    `Current pack: ${report.currentPackId}`,
    `Pack lineage: ${report.currentPackIds.join(" -> ")}`,
    `Enforcement targets: ${report.agents.join(", ")}`,
    `Farrier version: ${report.farrierVersion.manifest ?? "(missing)"} -> ${report.farrierVersion.current}${
      report.farrierVersion.needsUpdate ? " (update needed)" : ""
    }`,
    "",
    "Stack drift:",
    `  ${report.stackDrift.message}`,
    "",
    "Unacknowledged secondary findings:",
    ...renderList(
      report.unacknowledgedSecondaryFindings.map((finding) => `${finding.id}: ${finding.description}`),
      "none"
    ),
    "",
    "Hook drift:",
    ...renderList(
      report.hookDrift.map(
        (drift) =>
          `${drift.hookId}: manifest ${drift.manifestVersion ?? "(missing)"} -> catalog ${drift.currentVersion}`
      ),
      "none"
    ),
    "",
    "Registry pin drift:",
    ...renderList(
      report.registryPinDrift.map(
        (drift) =>
          `${drift.id}: manifest ${drift.manifestVersion ?? "(missing)"} ${shortSha(drift.manifestSha256)} -> catalog ${drift.currentVersion} ${shortSha(drift.currentSha256)}`
      ),
      "none"
    ),
    "",
    "Missing inventory files:",
    ...renderList(report.missingInventoryFiles, "none"),
    "",
    "Outdated Farrier-owned files:",
    ...renderList(report.outdatedOwnedFiles, "none"),
    "",
    "Outdated user-mutable files (manual review only):",
    ...renderList(report.outdatedUserFiles, "none"),
    "",
    "Suggested skills (not installed):",
    ...renderList(report.suggestedSkills, "none")
  ];

  if (report.notes.length > 0) {
    lines.push("", "Notes:", ...renderList(report.notes, "none"));
  }

  return `${lines.join("\n")}\n`;
}

export function formatUpdateApplyResult(result: UpdateApplyResult): string {
  const lines = [
    formatUpdateReport(result.report).trimEnd(),
    "",
    "Applied repairs:",
    ...renderList(result.repairedFiles, "none"),
    "",
    "Acknowledged secondary detector ids:",
    ...renderList(result.acknowledgedSecondaryIds, "none"),
    "",
    "Suggested skills not installed:",
    ...renderList(result.suggestedSkillsNotInstalled, "none")
  ];

  return `${lines.join("\n")}\n`;
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/tui/advise-app.tsx
```tsx
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useReducer, useState } from "react";
import { formatAdviceReport } from "../cli/advise";
import { loadFarrierConfig } from "../config/farrier-config";
import { discoverProjectSessionCounts } from "../engine/advice-sessions";
import type { AdviceBatchState } from "../engine/advice-batch";
import { adviceCreationSupport, applyAdviceCreationPlan, type AdviceCreationPlan } from "../engine/advice-apply";
import { adviceSessionLookbackLabel, type AdviceRecommendation, type AdviceReport, type AdviceSessionCountInventory, type AdviceSessionLookback, type AdviceSessionSourceSummary } from "../engine/advice-types";
import { probeAgents, type AgentAvailability, type AgentBackend } from "../engine/backend";
import type { ApplyHarnessChangePlanResult, HarnessChangePlan } from "../engine/create-plan";
import type { SkillCreationRequest } from "../engine/create-skill";
import type { AdviceProgressEvent } from "../engine/project-advice";
import { AdviceApplyFlow } from "./AdviceApplyFlow";
import { AdviceBatchFlow } from "./AdviceBatchFlow";
import { adviceSkillCreationRequest, createAdviceWizardActions } from "./advice-actions";
import { adjacentAdviceLookback, adjacentAvailableAdviceBackend, adviceTuiReducer, adviceTuiScopes, createInitialAdviceTuiState, initialAdviceBackend, type AdviceTuiScope } from "./advise-machine";
import { KeyHints, palette, useSpinner } from "./chrome";
import { binding, bindingsHint, defineBindings, resolveIntent, runningCancellationBindings } from "./keymap";

export type AdviceWizardOutcome = "done" | "back" | "cancel" | { kind: "create-skill"; request: SkillCreationRequest };
export { adviceSkillCreationRequest, createAdviceWizardActions } from "./advice-actions";

const reportPageSize = 5;
export const adviceSetupControls = ["backend", "sessions", "lookback", "scope", "analyze"] as const;

function backendName(backend: AgentBackend): "Claude" | "Codex" {
  return backend === "claude" ? "Claude" : "Codex";
}

export function adviceBackendControlLabel(backend: AgentBackend, availability: AgentAvailability): string {
  const availabilityLabel = availability.claude && availability.codex
    ? "Claude and Codex available"
    : `${availability.claude ? "Codex" : "Claude"} unavailable`;
  return `Reasoning backend: ‹ ${backendName(backend)} › · ${availabilityLabel}`;
}

const adviceCancelBindings = defineBindings(
  binding(["escape", "b"], "back", "back"),
  binding(["q", "ctrl+c"], "quit", "quit")
);

export function isAdviceCancelKey(key: { name: string; ctrl?: boolean }): boolean {
  return resolveIntent(adviceCancelBindings, key) !== undefined;
}

export function adjacentAdviceRecommendationIndex(current: number, total: number, direction: -1 | 1): number {
  return Math.min(Math.max(current + direction, 0), Math.max(total - 1, 0));
}

function sourceLabel(sources: AdviceSessionSourceSummary[]): string {
  return sources.map((item) => `${item.source}: ${item.count}`).join(" · ") || "none";
}

export function formatAdviceTuiReportLines(report: AdviceReport): string[] {
  return formatAdviceReport(report).trimEnd().split("\n");
}

function reportLineColor(line: string): string {
  if (line === "Farrier project advice — report only") return palette.accent;
  if (["Codebase profile", "Recommendations", "Weak leads", "Coverage", "Evidence diagnostics", "Notes"].includes(line) || /^[A-Z]+$/.test(line)) return palette.gold;
  if (line.startsWith("  - ")) return palette.muted;
  return palette.text;
}

export type AdviceDecisionSummary = {
  why: string;
  benefit: string;
  evidence: string;
  creates: string;
};

export function adviceDecisionSummary(report: AdviceReport, recommendation: AdviceRecommendation): AdviceDecisionSummary {
  const evidenceById = new Map([...report.profile.evidence, ...report.sessions.evidence].map((item) => [item.id, item]));
  const matched = recommendation.evidence.flatMap((id) => evidenceById.get(id) ?? []);
  const primary = matched[0];
  const signalCount = matched.length || recommendation.evidence.length;
  const more = signalCount > 1 ? ` · +${signalCount - 1} more` : "";
  const evidence = primary
    ? `${primary.source}${primary.path ? ` · ${primary.path}` : ""}: ${primary.summary}${more}`
    : recommendation.evidence.join(", ");
  return {
    why: recommendation.reason,
    benefit: recommendation.benefit,
    evidence,
    creates: recommendation.implementationRoute.description
  };
}

export function AdviceApp(props: {
  sessionCounts: AdviceSessionCountInventory;
  availability: AgentAvailability;
  onBack: () => void;
  onCancel: () => void;
  onRun: (
    backend: AgentBackend,
    includeSessions: boolean,
    lookback: AdviceSessionLookback,
    scope: AdviceTuiScope,
    onProgress: (event: AdviceProgressEvent) => void
  ) => Promise<AdviceReport>;
  onPlan: (report: AdviceReport, recommendation: AdviceRecommendation) => Promise<{ plan: AdviceCreationPlan; inspection: HarnessChangePlan }>;
  onPlanBatch: (
    report: AdviceReport,
    previous: AdviceBatchState | undefined,
    signal: AbortSignal,
    onProgress: (state: AdviceBatchState) => void
  ) => Promise<AdviceBatchState>;
  onApply: (plan: AdviceCreationPlan, force: boolean) => Promise<ApplyHarnessChangePlanResult>;
  onCreateSkill: (request: SkillCreationRequest) => void;
  registerBatchCancellation?: (cancel: (() => void) | undefined) => void;
  onDone: () => void;
}) {
  const initialSessionCount = props.sessionCounts["7d"].reduce((sum, item) => sum + item.count, 0);
  const [state, dispatch] = useReducer(adviceTuiReducer, createInitialAdviceTuiState(initialSessionCount, props.availability));
  const [selectedRecommendationIndex, setSelectedRecommendationIndex] = useState(0);
  const [reportOffset, setReportOffset] = useState(0);
  const [setupFocus, setSetupFocus] = useState(0);
  const [creatingRecommendation, setCreatingRecommendation] = useState<AdviceRecommendation>();
  const [creatingAll, setCreatingAll] = useState(false);
  const [reportActionIndex, setReportActionIndex] = useState(0);
  const [actionMessage, setActionMessage] = useState<string>();
  const sources = props.sessionCounts[state.lookback];
  const sessionCount = sources.reduce((sum, item) => sum + item.count, 0);
  const spinner = useSpinner(state.status === "running");
  const reportBindings = defineBindings(
    binding(["up", "down"], "move", "select recommendation"),
    binding(["left", "right"], "action", "focus report action"),
    binding(["pageup", "pagedown"], "scroll", "scroll report"),
    binding("enter", "activate", "activate report action"),
    binding("r", "retry", "options/rerun"),
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "close")
  );
  const runningBindings = defineBindings(...runningCancellationBindings, binding(["escape", "b"], "back", "cancel"), binding("q", "quit", "quit"));
  const errorBindings = defineBindings(binding("r", "retry", "options"), binding(["escape", "b"], "back", "launcher"), binding(["q", "ctrl+c"], "quit", "quit"));
  const setupBindings = defineBindings(
    binding(["up", "down", "tab", "shift+tab"], "focus", "focus control"),
    binding(["left", "right"], "adjust", "change value"),
    binding("space", "toggle", "toggle option"),
    binding("enter", "activate", "activate"),
    binding(["escape", "b"], "back", "launcher"),
    binding(["q", "ctrl+c"], "quit", "quit")
  );

  const start = () => {
    if (state.status !== "ready") return;
    const request = { backend: state.backend, includeSessions: state.includeSessions, lookback: state.lookback, scope: state.scope };
    dispatch({ type: "START" });
    setTimeout(() => {
      props.onRun(request.backend, request.includeSessions, request.lookback, request.scope, (event) => dispatch({ type: "PROGRESS", message: event.message }))
        .then((report) => dispatch({ type: "SUCCEEDED", report }))
        .catch((error) => dispatch({ type: "FAILED", error: error instanceof Error ? error.message : String(error) }));
    }, 0);
  };

  useKeyboard((key) => {
    if (creatingRecommendation || creatingAll) return;
    if (state.status === "done") {
      const intent = resolveIntent(reportBindings, key);
      if (intent === "quit") props.onDone();
      else if (intent === "back") props.onBack();
      else if (intent === "retry") {
        setSelectedRecommendationIndex(0);
        setReportOffset(0);
        setReportActionIndex(0);
        setSetupFocus(0);
        dispatch({ type: "RESET" });
      }
      else if (intent === "move" && state.report) {
        const direction = key.name === "down" ? 1 : -1;
        setSelectedRecommendationIndex((current) => adjacentAdviceRecommendationIndex(current, state.report!.recommendations.length, direction));
        setActionMessage(undefined);
      } else if (intent === "action") {
        setReportActionIndex(key.name === "right" ? 1 : 0);
      } else if (intent === "scroll" && state.report) {
        const maximum = Math.max(formatAdviceTuiReportLines(state.report).length - reportPageSize, 0);
        setReportOffset((current) => Math.min(maximum, Math.max(0, current + (key.name === "pagedown" ? reportPageSize : -reportPageSize))));
      } else if (intent === "activate" && state.report) {
        if (reportActionIndex === 1) {
          setCreatingAll(true);
          setActionMessage(undefined);
          return;
        }
        const recommendation = state.report.recommendations[selectedRecommendationIndex];
        if (!recommendation) {
          setActionMessage("There is no recommendation to create.");
          return;
        }
        const support = adviceCreationSupport(recommendation);
        if (support.kind === "files") setCreatingRecommendation(recommendation);
        else if (support.kind === "skill") {
          props.onCreateSkill(adviceSkillCreationRequest(state.report.backend, recommendation));
        } else setActionMessage(support.description);
      }
      return;
    }
    if (state.status === "running") {
      const intent = resolveIntent(runningBindings, key);
      if (intent) props.onCancel();
      return;
    }
    if (state.status === "error") {
      const intent = resolveIntent(errorBindings, key);
      if (intent === "retry") {
        setSetupFocus(0);
        dispatch({ type: "RESET" });
      }
      else if (intent === "back") props.onBack();
      else if (intent === "quit") props.onCancel();
      return;
    }
    const intent = resolveIntent(setupBindings, key);
    const focusedControl = adviceSetupControls[setupFocus];
    if (intent === "back") props.onBack();
    else if (intent === "quit") props.onCancel();
    else if (intent === "focus") {
      const delta = key.name === "up" || key.shift ? -1 : 1;
      setSetupFocus((current) => (current + delta + adviceSetupControls.length) % adviceSetupControls.length);
    } else if (intent === "adjust" && focusedControl === "backend") {
      const backend = adjacentAvailableAdviceBackend(state.backend, state.availability, key.name === "right" ? 1 : -1);
      if (backend) dispatch({ type: "SET_BACKEND", backend });
    } else if (intent === "toggle" && focusedControl === "sessions") dispatch({ type: "TOGGLE_SESSIONS" });
    else if (intent === "adjust" && focusedControl === "lookback") dispatch({ type: "SET_LOOKBACK", lookback: adjacentAdviceLookback(state.lookback, key.name === "right" ? 1 : -1) });
    else if (intent === "adjust" && focusedControl === "scope") {
      const index = adviceTuiScopes.indexOf(state.scope);
      dispatch({ type: "SET_SCOPE", scope: adviceTuiScopes[(index + (key.name === "right" ? 1 : -1) + adviceTuiScopes.length) % adviceTuiScopes.length]! });
    } else if (intent === "activate" && focusedControl === "sessions") dispatch({ type: "TOGGLE_SESSIONS" });
    else if (intent === "activate" && focusedControl === "analyze") start();
  });

  if (creatingRecommendation && state.report) {
    return (
      <AdviceApplyFlow
        recommendation={creatingRecommendation}
        onPlan={() => props.onPlan(state.report!, creatingRecommendation)}
        onApply={props.onApply}
        onBack={() => setCreatingRecommendation(undefined)}
        onCancel={props.onCancel}
        onDone={props.onDone}
      />
    );
  }

  if (creatingAll && state.report) {
    return (
      <AdviceBatchFlow
        report={state.report}
        onPlan={(previous, signal, onProgress) => props.onPlanBatch(state.report!, previous, signal, onProgress)}
        onApply={props.onApply}
        onBack={() => setCreatingAll(false)}
        onDone={props.onDone}
        registerCancellation={props.registerBatchCancellation}
      />
    );
  }

  if (state.status === "done" && state.report) {
    const lines = formatAdviceTuiReportLines(state.report);
    const selected = state.report.recommendations[selectedRecommendationIndex];
    const support = selected ? adviceCreationSupport(selected) : undefined;
    const decision = selected ? adviceDecisionSummary(state.report, selected) : undefined;
    const safeReportOffset = Math.min(reportOffset, Math.max(lines.length - reportPageSize, 0));
    const visibleReportLines = lines.slice(safeReportOffset, safeReportOffset + reportPageSize);
    const creatableCount = state.report.recommendations.filter((recommendation) => adviceCreationSupport(recommendation).kind !== "unsupported").length;
    return (
      <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
        <box style={{ flexDirection: "row", width: "100%" }}>
          <text fg={palette.accent}>✦ Advice report</text>
          <box style={{ flexGrow: 1 }} />
          <text fg={palette.success}>{`${backendName(state.report.backend)} · ${state.report.recommendations.length} validated recommendation(s)`}</text>
        </box>
        {selected && decision ? (
          <box style={{ flexDirection: "column", gap: 0 }}>
            <text bg={palette.selBg}>
              <span fg={palette.accent}>{`▸ ${selectedRecommendationIndex + 1}/${state.report.recommendations.length} `}</span>
              <span fg={palette.text}>{selected.id}</span>
              <span fg={palette.gold}>{` · ${selected.confidence} confidence`}</span>
              <span fg={support?.kind === "unsupported" ? palette.warn : palette.success}>{` · ${support?.kind === "skill" ? "open skill creator" : support?.kind === "files" ? "review & create" : "manual only"}`}</span>
            </text>
            <text><span fg={palette.gold}>Why: </span><span fg={palette.text}>{decision.why}</span></text>
            <text><span fg={palette.gold}>Value: </span><span fg={palette.success}>{decision.benefit}</span></text>
            <text><span fg={palette.gold}>Evidence: </span><span fg={palette.muted}>{decision.evidence}</span></text>
            <text><span fg={palette.gold}>Creates: </span><span fg={palette.text}>{decision.creates}</span></text>
          </box>
        ) : null}
        <box style={{ flexDirection: "row", gap: 2 }}>
          <text bg={reportActionIndex === 0 ? palette.selBg : undefined} fg={palette.text}>{`${reportActionIndex === 0 ? "▸ " : "  "}Create selected`}</text>
          <text bg={reportActionIndex === 1 ? palette.selBg : undefined} fg={palette.text}>{`${reportActionIndex === 1 ? "▸ " : "  "}Create all (${creatableCount})`}</text>
        </box>
        {actionMessage ? <text fg={palette.warn}>{actionMessage}</text> : null}
        <box style={{ flexDirection: "column", flexGrow: 1, width: "100%" }}>
          <text fg={palette.gold}>{`Full report · lines ${safeReportOffset + 1}–${safeReportOffset + visibleReportLines.length} of ${lines.length}`}</text>
          {visibleReportLines.map((line, index) => <text key={`${safeReportOffset + index}-${line}`} fg={reportLineColor(line)}>{line || " "}</text>)}
        </box>
        <text fg={palette.muted}>Analysis is read-only. Creation always opens a separate review and confirmation step.</text>
        <KeyHints hint={bindingsHint(reportBindings)} />
      </box>
    );
  }

  const setupLabels = [
    adviceBackendControlLabel(state.backend, state.availability),
    `${state.includeSessions ? "[x]" : "[ ]"} Include project sessions`,
    `Session window: ‹ ${adviceSessionLookbackLabel(state.lookback)} › (${sessionCount}; ${sourceLabel(sources)})`,
    `Recommendation scope: ${state.scope === "all" ? "all categories" : state.scope}`,
    "Analyze project"
  ];

  return (
    <box style={{ border: true, padding: 1, flexDirection: "column", gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "column" }}>
        <text fg={palette.accent}>✦ Advise this project</text>
        <text fg={palette.muted}>Read-only analysis of guidance, hooks, skills, subagents, plugins, and MCP.</text>
      </box>
      {setupLabels.map((label, index) => (
        <text key={adviceSetupControls[index]!} bg={setupFocus === index ? palette.selBg : undefined}>
          <span fg={palette.accent}>{setupFocus === index ? "▸ " : "  "}</span><span fg={palette.text}>{label}</span>
        </text>
      ))}
      <text fg={palette.faint}>The selected reasoning backend determines its isolated session evidence and recommendation target.</text>
      <text fg={palette.faint}>Only sessions whose resolved project directory matches exactly are eligible.</text>
      {state.status === "running" ? (
        <box style={{ flexDirection: "column", gap: 0 }}>
          <text fg={palette.agent}>{`${spinner}  ${state.progress ?? "Analyzing bounded codebase and session evidence…"}`}</text>
          {state.progressHistory.slice(-7).map((message, index, visible) => (
            <text key={`${index}-${message}`} fg={index === visible.length - 1 ? palette.text : palette.success}>
              {`${index === visible.length - 1 ? "  ▸" : "  ✓"} ${message}`}
            </text>
          ))}
        </box>
      ) : null}
      {state.status === "error" ? <text fg={palette.warn}>Advice failed: {state.error}</text> : null}
      <text fg={palette.muted}>Analysis is read-only. Creating a recommendation requires a separate review and confirmation.</text>
      <KeyHints hint={bindingsHint(state.status === "error" ? errorBindings : state.status === "running" ? runningBindings : setupBindings)} />
    </box>
  );
}

export async function runAdviceWizard(
  targetDir: string,
  dependencies: Partial<{
    probeAvailability: () => Promise<AgentAvailability>;
    log: (message: string) => void;
  }> = {}
): Promise<AdviceWizardOutcome> {
  const log = dependencies.log ?? ((message: string) => console.error(message));
  const availability = await (dependencies.probeAvailability ?? probeAgents)();
  if (!initialAdviceBackend(availability)) {
    log("farrier advise: no agent backend found. Install claude or codex.");
    return "cancel";
  }
  log("farrier advise: Discovering exact-project session counts…");
  const sessionCounts = await discoverProjectSessionCounts({ targetDir, targets: ["claude", "codex"] });
  const controller = new AbortController();
  const actions = createAdviceWizardActions({
    targetDir,
    signal: controller.signal,
    loadModels: () => loadFarrierConfig({ projectDir: targetDir }).then((loaded) => loaded.config.models).catch(() => ({}))
  });
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  let sigintHandler: (() => void) | undefined;
  try {
    renderer = await createCliRenderer({ exitOnCtrlC: false });
    const cliRenderer = renderer;
    return await new Promise<AdviceWizardOutcome>((done) => {
      let settled = false;
      let applyingFiles = false;
      let activeBatchCancel: (() => void) | undefined;
      const finish = (outcome: AdviceWizardOutcome) => {
        if (settled) return;
        settled = true;
        if (sigintHandler) process.off("SIGINT", sigintHandler);
        cliRenderer.destroy();
        done(outcome);
      };
      const cancel = () => {
        if (activeBatchCancel) {
          activeBatchCancel();
          if (sigintHandler) process.once("SIGINT", sigintHandler);
          return;
        }
        if (applyingFiles) {
          if (sigintHandler) process.once("SIGINT", sigintHandler);
          return;
        }
        controller.abort();
        finish("cancel");
      };
      sigintHandler = cancel;
      process.once("SIGINT", sigintHandler);
      createRoot(cliRenderer).render(
        <AdviceApp
          sessionCounts={sessionCounts}
          availability={availability}
          onBack={() => finish("back")}
          onCancel={cancel}
          onDone={() => finish("done")}
          onCreateSkill={(request) => finish({ kind: "create-skill", request })}
          onPlan={actions.onPlan}
          onPlanBatch={actions.onPlanBatch}
          registerBatchCancellation={(handler) => { activeBatchCancel = handler; }}
          onApply={async (plan, force) => {
            applyingFiles = true;
            try {
              return await applyAdviceCreationPlan(targetDir, plan, force);
            } finally {
              applyingFiles = false;
            }
          }}
          onRun={actions.onRun}
        />
      );
    });
  } catch (error) {
    controller.abort();
    if (sigintHandler) process.off("SIGINT", sigintHandler);
    renderer?.destroy();
    log(`farrier advise: ${error instanceof Error ? error.message : String(error)}`);
    return "cancel";
  }
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/cli/advise.ts
```ts
import { resolve } from "node:path";
import { loadFarrierConfig, resolveModelSettings } from "../config/farrier-config";
import { adviseSkills, detectAgentBackend, resolveContext, type AdviseBackend } from "../engine/advise";
import {
  adviceCategories,
  adviceSessionLookbackLabel,
  isAdviceCategory,
  isAdviceSessionLookback,
  type AdviceCategory,
  type AdviceReport,
  type AdviceSessionLookback,
  type AdviceVendor
} from "../engine/advice-types";
import { profileProject, projectProfileSummary } from "../engine/project-profile";
import { adviseProject } from "../engine/project-advice";

export type AdviseCliOptions = {
  dir: string;
  context?: string;
  backend?: AdviseBackend;
  model?: string;
  sessions: "auto" | "none";
  since: AdviceSessionLookback;
  targets?: AdviceVendor[];
  only?: AdviceCategory[];
  legacySkills: boolean;
  json: boolean;
  help: boolean;
};

function adviseUsage(): string {
  return `farrier advise — inspect a project and recommend agent configuration improvements

Usage:
  farrier advise --dir <target> [--sessions auto|none] [--since 7d|14d|all] [--targets claude|codex]
                 [--only guidance,hooks,skills,subagents,plugins,mcp]
                 [--backend claude|codex] [--model <name>] [--json]
  farrier advise skills [--dir <target>] [--context <path|text>] [--backend claude|codex] [--json]

Options:
  --dir <path>          Project directory. Defaults to the current working directory.
  --sessions <mode>     Include exact-project Claude/Codex sessions (auto) or use code only (none).
  --since <window>      Session lookback: 7d (default), 14d, or all.
  --targets <vendor>    Recommendation target; must match --backend. Defaults to the selected backend.
  --only <categories>   Limit the report to selected categories. --only skills preserves skill-only advice.
  --context <path|text> Optional context for the legacy skill-only advisor.
  --backend <name>      Reasoning backend: claude or codex. Defaults to Claude when both are found.
  --model <name>        Backend model override.
  --json                Emit the same validated report as machine-readable JSON.
  --help                Show this help.

Advice is report-only. It never installs recommendations or changes project configuration.`;
}

function parseBackend(value: string): AdviseBackend {
  if (value === "claude" || value === "codex") return value;
  throw new Error("--backend must be claude or codex");
}

function commaValues(value: string, flag: string): string[] {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`${flag} requires at least one value`);
  return Array.from(new Set(values));
}

function parseTargets(value: string): AdviceVendor[] {
  if (value !== "claude" && value !== "codex") throw new Error("--targets must be exactly one provider: claude or codex");
  return [value];
}

function parseOnly(value: string): AdviceCategory[] {
  const values = commaValues(value, "--only");
  if (values.some((item) => !isAdviceCategory(item))) throw new Error(`--only must contain only ${adviceCategories.join(",")}`);
  return values as AdviceCategory[];
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseAdviseArgs(args: string[]): AdviseCliOptions {
  const options: AdviseCliOptions = {
    dir: process.cwd(),
    sessions: "auto",
    since: "7d",
    legacySkills: args[0] === "skills",
    json: false,
    help: false
  };
  const start = options.legacySkills ? 1 : 0;

  for (let index = start; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--dir") { options.dir = requiredValue(args, index, arg); index += 1; }
    else if (arg.startsWith("--dir=")) options.dir = arg.slice(6);
    else if (arg === "--context") { options.context = requiredValue(args, index, arg); index += 1; }
    else if (arg.startsWith("--context=")) options.context = arg.slice(10);
    else if (arg === "--backend") { options.backend = parseBackend(requiredValue(args, index, arg)); index += 1; }
    else if (arg.startsWith("--backend=")) options.backend = parseBackend(arg.slice(10));
    else if (arg === "--model") { options.model = requiredValue(args, index, arg); index += 1; }
    else if (arg.startsWith("--model=")) options.model = arg.slice(8);
    else if (arg === "--sessions") {
      const value = requiredValue(args, index, arg);
      if (value !== "auto" && value !== "none") throw new Error("--sessions must be auto or none");
      options.sessions = value;
      index += 1;
    } else if (arg.startsWith("--sessions=")) {
      const value = arg.slice(11);
      if (value !== "auto" && value !== "none") throw new Error("--sessions must be auto or none");
      options.sessions = value;
    } else if (arg === "--since") {
      const value = requiredValue(args, index, arg);
      if (!isAdviceSessionLookback(value)) throw new Error("--since must be 7d, 14d, or all");
      options.since = value;
      index += 1;
    } else if (arg.startsWith("--since=")) {
      const value = arg.slice(8);
      if (!isAdviceSessionLookback(value)) throw new Error("--since must be 7d, 14d, or all");
      options.since = value;
    } else if (arg === "--targets") { options.targets = parseTargets(requiredValue(args, index, arg)); index += 1; }
    else if (arg.startsWith("--targets=")) options.targets = parseTargets(arg.slice(10));
    else if (arg === "--only") { options.only = parseOnly(requiredValue(args, index, arg)); index += 1; }
    else if (arg.startsWith("--only=")) options.only = parseOnly(arg.slice(7));
    else throw new Error(`Unknown advise argument: ${arg}`);
  }

  if (options.only?.length === 1 && options.only[0] === "skills") options.legacySkills = true;
  return options;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSources(report: AdviceReport): string {
  return report.sessions.sources.map((source) => `${source.source} ${source.count}`).join(", ") || "none";
}

export function formatAdviceReport(report: AdviceReport): string {
  const sessionCount = report.sessions.sources.reduce((sum, source) => sum + source.count, 0);
  const funnel = report.sessions.funnel ?? { sources: [], visibleEvents: report.sessions.evidence.length, recurringPatterns: 0 };
  const lines = [
    "Farrier project advice — report only",
    `Project: ${report.targetDir}`,
    `Backend: ${report.backend}${report.model ? ` (${report.model})` : ""}`,
    `Sessions: ${report.sessions.included ? "included" : "not included"} (${adviceSessionLookbackLabel(report.sessions.lookback)}; ${formatSources(report)})`,
    `Evidence funnel: ${sessionCount} sessions → ${funnel.visibleEvents} visible events → ${funnel.recurringPatterns} recurring patterns → ${report.recommendations.length} supported recommendations`,
    ...(report.evidence ? [`Comparable evidence: ${report.evidence.result} (digest ${report.evidence.inputDigest})`] : []),
    "",
    "Codebase profile",
    `  Stacks: ${report.profile.stacks.join(", ") || "generic"}`,
    `  Languages: ${report.profile.languages.join(", ") || "unknown"}`,
    `  Tests: ${report.profile.tests.join(", ") || "none detected"}`,
    `  CI: ${report.profile.ci.join(", ") || "none detected"}`,
    "",
    "Recommendations"
  ];
  const evidence = new Map([...report.profile.evidence, ...report.sessions.evidence].map((item) => [item.id, item]));
  if (report.recommendations.length === 0) lines.push("  No supported high-value recommendations.");
  for (const category of adviceCategories) {
    const recommendations = report.recommendations.filter((item) => item.category === category);
    if (recommendations.length === 0) continue;
    lines.push("", category.toUpperCase());
    for (const recommendation of recommendations) {
      lines.push(`  ${recommendation.id} [${recommendation.confidence}] → ${recommendation.targetVendors.join(", ")}`);
      lines.push(`    Why: ${recommendation.reason}`);
      lines.push(`    Benefit: ${recommendation.benefit}`);
      lines.push(`    Route: ${recommendation.implementationRoute.description}`);
      if (recommendation.registryRef) lines.push(`    Registry: ${recommendation.registryRef}`);
      for (const evidenceId of recommendation.evidence) {
        const item = evidence.get(evidenceId);
        lines.push(`    Evidence: ${evidenceId}${item ? ` — ${item.summary}` : ""}`);
      }
    }
  }
  if ((report.weakLeads ?? []).length > 0) {
    lines.push("", "Weak leads");
    for (const recommendation of report.weakLeads ?? []) {
      lines.push(`  ${recommendation.id} [low] → ${recommendation.targetVendors.join(", ")}`);
      lines.push(`    Why confidence is low: ${recommendation.reason}`);
      lines.push("    Would strengthen: recurrence in another distinct session or a second independent visible signal.");
      lines.push(`    Possible benefit: ${recommendation.benefit}`);
    }
  }
  if (report.coverage.length > 0) {
    lines.push("", "Coverage");
    for (const item of report.coverage) {
      lines.push(`  ${item.status === "accepted" ? "✓" : "–"} ${item.category} [${item.status}]: ${item.reason}`);
    }
  }
  lines.push("", "Evidence diagnostics");
  for (const source of funnel.sources) {
    const discarded = Object.entries(source.discarded).filter(([, count]) => count > 0).map(([reason, count]) => `${reason} ${count}`).join(", ") || "none";
    lines.push(`  ${source.source}: discovered ${source.discovered}, eligible ${source.eligible}, read ${source.read}, parsed ${source.parsed}, events ${source.visibleEvents}, patterns ${source.retainedPatterns}, discarded ${discarded}`);
  }
  if (funnel.recommendation) {
    const item = funnel.recommendation;
    lines.push(`  backend: sent ${item.patternsSent}, returned ${item.returned}, accepted ${item.accepted}, merged ${item.merged}, rejected ${item.rejected}, recovery calls ${item.recoveryCalls}`);
  }
  if (report.notes.length > 0) {
    lines.push("", "Notes");
    for (const note of report.notes) lines.push(`  - ${note}`);
  }
  return `${lines.join("\n")}\n`;
}

async function resolveBackend(options: AdviseCliOptions): Promise<AdviseBackend | undefined> {
  if (options.backend) {
    if (!Bun.which(options.backend)) return undefined;
    return options.backend;
  }
  return detectAgentBackend();
}

async function runLegacySkills(options: AdviseCliOptions, backend: AdviseBackend, targetDir: string): Promise<number> {
  let context = await resolveContext({ targetDir, context: options.context });
  if (!context) {
    const profile = await profileProject(targetDir);
    context = { source: "deterministic-project-profile", text: projectProfileSummary(profile) };
  }
  const models = await loadFarrierConfig({ projectDir: targetDir }).then((loaded) => loaded.config.models).catch(() => ({}));
  const settings = resolveModelSettings({ models, backend, role: "advise", explicitModel: options.model });
  const profile = await profileProject(targetDir);
  const result = await adviseSkills({
    targetDir,
    packId: profile.stacks[0] ?? "generic",
    contextText: context.text,
    backend,
    model: settings.model,
    reasoningEffort: settings.reasoningEffort
  });
  const output = { backend: result.backend, contextSource: context.source, queries: result.queries, recommendations: result.recommendations, notes: [...result.notes, "Report only: no skills were installed."] };
  if (options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log("Farrier skill advice — report only");
    console.log(`Backend: ${result.backend}`);
    console.log(`Context: ${context.source}`);
    console.log(`Queries: ${result.queries.join(", ") || "none"}`);
    console.log("");
    if (result.recommendations.length === 0) console.log("No skill recommendations.");
    else for (const recommendation of result.recommendations) console.log(`  ${recommendation.ref} — ${recommendation.reason} (${recommendation.installs} installs)`);
    console.log("\nReport only: Farrier did not install skills or change project configuration.");
    for (const note of result.notes) console.log(`  - ${note}`);
  }
  return 0;
}

export async function runAdvise(args: string[]): Promise<number> {
  const options = parseAdviseArgs(args);
  if (options.help) { console.log(adviseUsage()); return 0; }
  const targetDir = resolve(options.dir);
  const backend = await resolveBackend(options);
  if (!backend) {
    const detail = options.backend ? `requested backend '${options.backend}' was not found on PATH` : "no agent backend found; install claude or codex, or pass --backend";
    console.error(`farrier advise: ${detail}.`);
    return 1;
  }

  try {
    if (options.legacySkills) return await runLegacySkills(options, backend, targetDir);
    const models = await loadFarrierConfig({ projectDir: targetDir }).then((loaded) => loaded.config.models).catch(() => ({}));
    const settings = resolveModelSettings({ models, backend, role: "advise", explicitModel: options.model });
    const report = await adviseProject({
      targetDir,
      backend,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
      sessions: options.sessions,
      lookback: options.since,
      targets: options.targets,
      only: options.only,
      onProgress: ({ message }) => console.error(`farrier advise: ${message}`)
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatAdviceReport(report).trimEnd());
    return 0;
  } catch (error) {
    console.error(`farrier advise: ${errorMessage(error)}`);
    return 1;
  }
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/src/engine/advice-types.ts
```ts
import type { EvidenceComparison } from "./behavior-evidence";

export const adviceCategories = ["guidance", "hooks", "skills", "subagents", "plugins", "mcp"] as const;
export const adviceSessionLookbacks = ["7d", "14d", "all"] as const;

export type AdviceCategory = (typeof adviceCategories)[number];
export type AdviceSessionLookback = (typeof adviceSessionLookbacks)[number];
export type AdviceVendor = "claude" | "codex";
export type AdviceConfidence = "high" | "medium" | "low";
export type AdviceEvidenceSource = "project" | AdviceVendor;

export type AdviceEvidence = {
  id: string;
  source: AdviceEvidenceSource;
  kind: string;
  summary: string;
  path?: string;
  sessionId?: string;
  occurrences?: number;
  distinctSessions?: number;
  lastSeenAt?: number;
  allowedCategories?: AdviceCategory[];
  targetVendors?: AdviceVendor[];
  implementationRoutes?: string[];
  selectedProvider?: AdviceVendor;
};

export type ProjectProfile = {
  targetDir: string;
  stacks: string[];
  languages: string[];
  tests: string[];
  ci: string[];
  services: string[];
  structure: string[];
  configuration: Record<string, string[]>;
  evidence: AdviceEvidence[];
};

export type AdviceSessionSourceSummary = {
  source: AdviceVendor;
  count: number;
};

export type AdviceSessionEvidence = {
  sources: AdviceSessionSourceSummary[];
  signals: AdviceEvidence[];
  notes: string[];
  funnel?: AdviceEvidenceFunnel;
};

export type AdviceDiscardCounts = {
  filtering: number;
  redaction: number;
  deduplication: number;
  malformed: number;
  limits: number;
};

export type AdviceSourceFunnel = {
  source: AdviceVendor;
  discovered: number;
  eligible: number;
  read: number;
  parsed: number;
  visibleEvents: number;
  discarded: AdviceDiscardCounts;
  retainedPatterns: number;
};

export type AdviceRecommendationFunnel = {
  patternsSent: number;
  returned: number;
  accepted: number;
  merged: number;
  rejected: number;
  rejectionReasons: string[];
  recoveryCalls: number;
};

export type AdviceEvidenceFunnel = {
  sources: AdviceSourceFunnel[];
  visibleEvents: number;
  recurringPatterns: number;
  recommendation?: AdviceRecommendationFunnel;
};

export type AdviceSessionCountInventory = Record<AdviceSessionLookback, AdviceSessionSourceSummary[]>;

export type AdviceImplementationRoute = {
  id: string;
  description: string;
};

export type AdviceRecommendation = {
  id: string;
  category: AdviceCategory;
  targetVendors: AdviceVendor[];
  reason: string;
  benefit: string;
  evidence: string[];
  confidence: AdviceConfidence;
  implementationRoute: AdviceImplementationRoute;
  creates?: AdviceArtifact[];
  registryRef?: string;
};

export type AdviceArtifact = {
  vendor: AdviceVendor | "shared";
  path: string;
  kind: "config" | "guidance" | "hook" | "skill" | "agent";
};

const defaultAdviceBenefits: Record<AdviceCategory, string> = {
  guidance: "Makes the project expectation persistent and visible to every supported agent.",
  hooks: "Automates the observed check so completion is consistent and requires less manual repetition.",
  skills: "Turns a repeated workflow into a reusable capability instead of requiring it to be explained again.",
  subagents: "Keeps specialist work and its context bounded so the main agent can stay focused.",
  plugins: "Adds a packaged capability that can be reused without rebuilding the integration each time.",
  mcp: "Gives agents direct, governed access to the relevant tool or data instead of relying on manual transfer."
};

export function adviceCategoryBenefit(category: AdviceCategory): string {
  return defaultAdviceBenefits[category];
}

export type AdviceCoverage = {
  category: AdviceCategory;
  status: "accepted" | "no-evidence" | "weak-evidence" | "supported-no-route" | "backend-omission" | "validation-rejection" | "recommended" | "no-strong-evidence";
  reason: string;
};

export type AdviceReport = {
  schemaVersion: 1;
  targetDir: string;
  backend: AdviceVendor;
  model?: string;
  reportOnly: true;
  targets?: AdviceVendor[];
  sessions: {
    mode: "auto" | "none";
    lookback: AdviceSessionLookback;
    included: boolean;
    requestedSources?: AdviceVendor[];
    sources: AdviceSessionSourceSummary[];
    evidence: AdviceEvidence[];
    funnel?: AdviceEvidenceFunnel;
  };
  profile: ProjectProfile;
  recommendations: AdviceRecommendation[];
  weakLeads?: AdviceRecommendation[];
  coverage: AdviceCoverage[];
  evidence?: EvidenceComparison;
  notes: string[];
};

export function isAdviceCategory(value: string): value is AdviceCategory {
  return (adviceCategories as readonly string[]).includes(value);
}

export function isAdviceSessionLookback(value: string): value is AdviceSessionLookback {
  return (adviceSessionLookbacks as readonly string[]).includes(value);
}

export function adviceSessionLookbackLabel(value: AdviceSessionLookback): string {
  if (value === "7d") return "past 7 days";
  if (value === "14d") return "past 14 days";
  return "all history";
}

```

File: /Users/ivor/src/tries/2026-07-02-farrier/tests/eval-skill.test.ts
```ts
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BackendCommandRunner, BackendCommandRunnerInput } from "../src/engine/backend";
import { validateLabeledEvalVerdict } from "../src/engine/eval-judge";
import { evaluatePerAgentSkill, resolvePerAgentSkillWinner } from "../src/engine/eval-skill";
import type { SkillCreationOutcome, SkillCreationRequest } from "../src/engine/create-skill";
import type { CommandRunner, CommandRunnerInput } from "../src/engine/skills";
import { createQueuedCollisionHandler, type CollisionPrompt } from "../src/tui/collision";
import { eligiblePerAgentEvals } from "../src/tui/create-eval";
import { runHarnessWrite } from "../src/tui/harness-write";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-eval-skill-"));
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

async function writeSkill(dir: string, root: string, name: string): Promise<void> {
  await mkdir(join(dir, root, name), { recursive: true });
  await writeFile(join(dir, root, name, "SKILL.md"), `---\nname: ${name}\ndescription: Test skill.\n---\n\nBody.\n`, "utf8");
}

async function writeCases(
  dir: string,
  root: string,
  name: string,
  cases: Array<{ id: string; kind: "positive" | "negative"; prompt: string; expectedBehavior: string }>
): Promise<void> {
  await mkdir(join(dir, root, name, "evals"), { recursive: true });
  await writeFile(join(dir, root, name, "evals", "cases.json"), JSON.stringify({ version: 1, cases }));
}

async function writePinnedCreator(dir: string): Promise<void> {
  const files = [
    ".claude/skills/skill-creator/SKILL.md",
    ".claude/skills/skill-creator/agents/comparator.md",
    ".claude/skills/skill-creator/agents/analyzer.md",
    ".claude/skills/skill-creator/references/schemas.md"
  ];

  for (const file of files) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), file, "utf8");
  }
}

function candidatePaths(prompt: string): { aPath: string; bPath: string } {
  const aPath = /Candidate A: (\S+)/.exec(prompt)?.[1];
  const bPath = /Candidate B: (\S+)/.exec(prompt)?.[1];

  if (!aPath || !bPath) {
    throw new Error(`prompt does not name both candidates: ${prompt.slice(0, 200)}`);
  }

  return { aPath, bPath };
}

/**
 * Fake judge: parses the staged candidate paths out of the prompt and votes.
 * The engine always stages claude at candidate-one, codex at candidate-two.
 * `winner: "claude"` votes consistently for claude in both passes;
 * `winner: "always-A"` simulates a position-biased judge.
 */
function labeledVerdictJson(
  prompt: string,
  skillName: string,
  winner: "claude" | "codex" | "tie" | "always-A"
): string {
  const { aPath, bPath } = candidatePaths(prompt);
  const claudeLabel = aPath.endsWith("candidate-one") ? "A" : "B";
  const recommended =
    winner === "tie" ? "tie" : winner === "always-A" ? "A" : winner === "claude" ? claudeLabel : claudeLabel === "A" ? "B" : "A";

  // Score by identity (claude's staged copy always 8, codex's 6), so the
  // engine's cross-pass average stays stable regardless of label order.
  const copy = (path: string) => ({
    path,
    score: path.endsWith("candidate-one") ? 8 : 6,
    rationale: "Judged blind.",
    strengths: ["specific strength"],
    weaknesses: ["specific weakness"]
  });

  return JSON.stringify({
    skill_name: skillName,
    recommended_winner: recommended,
    rationale: "One concise paragraph.",
    copies: { A: copy(aPath), B: copy(bPath) },
    notes: ["Recommendation is advisory."]
  });
}

function promptOf(input: BackendCommandRunnerInput): string {
  return `${input.cmd.join(" ")} ${input.stdin ?? ""}`;
}

describe("per-agent skill eval engine", () => {
  test("evaluatePerAgentSkill runs two blind read-only passes over staged neutral copies", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const calls: BackendCommandRunnerInput[] = [];
    const runner: BackendCommandRunner = async (input) => {
      calls.push(input);
      return { exitCode: 0, stdout: labeledVerdictJson(promptOf(input), "pii-masker", "claude"), stderr: "" };
    };

    const verdict = await evaluatePerAgentSkill({
      targetDir: dir,
      skillName: "pii-masker",
      description: "Mask PII in prompts",
      backend: "codex",
      runner
    });

    expect(verdict.recommendedWinner).toBe("claude");
    expect(verdict.copies.claude.path).toBe(".claude/skills/pii-masker");
    expect(verdict.copies.codex.path).toBe(".agents/skills/pii-masker");
    expect(verdict.copies.claude.score).toBe(8);
    expect(verdict.evidence).toMatchObject({ availability: "unavailable", result: "inconclusive", caseCount: 0 });
    expect(verdict.notes).toContainEqual(expect.stringContaining("Behavior cases unavailable"));

    // Two swapped passes, both read-only, both blind: the prompt names only
    // staged neutral paths, never the vendor-revealing native paths.
    expect(calls).toHaveLength(2);
    const prompts = calls.map(promptOf);
    expect(new Set(prompts.map((prompt) => candidatePaths(prompt).aPath)).size).toBe(2);
    for (const call of calls) {
      expect(call.cmd[0]).toBe("codex");
      expect(call.cmd).toContain("read-only");
      const prompt = promptOf(call);
      expect(prompt).toContain("Candidate A: candidate-");
      expect(prompt).not.toContain(".claude/skills/pii-masker");
      expect(prompt).not.toContain(".agents/skills/pii-masker");
      expect(prompt).not.toContain("Claude copy");
    }

    // Reports are written for both copies plus the raw verdict.
    expect(verdict.reportPaths).toBeDefined();
    const claudeReport = await readFile(join(dir, verdict.reportPaths!.claude), "utf8");
    expect(claudeReport).toContain("(recommended)");
    expect(claudeReport).toContain("8/10");
    expect(existsSync(join(dir, verdict.reportPaths!.codex))).toBe(true);
    expect(existsSync(join(dir, verdict.reportPaths!.verdict))).toBe(true);

    // The neutral staging copies are cleaned up.
    const staging = await readdir(join(dir, ".farrier-staging")).catch(() => [] as string[]);
    expect(staging.filter((entry) => entry.startsWith("eval-"))).toEqual([]);
  });

  test("distinct full case declarations are redacted, neutral, and non-directional", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "case-skill");
    await writeSkill(dir, ".agents/skills", "case-skill");
    const positive = { id: "expected-use", kind: "positive" as const, prompt: "token=seeded-secret dev@example.com", expectedBehavior: "Use the skill" };
    const negative = { id: "unrelated", kind: "negative" as const, prompt: "Unrelated request", expectedBehavior: "Do not use the skill" };
    await writeCases(dir, ".claude/skills", "case-skill", [positive, negative]);
    await writeCases(dir, ".agents/skills", "case-skill", [positive, { ...negative, prompt: "Changed full declaration", expectedBehavior: "Different expected behavior" }]);
    const prompts: string[] = [];
    const runner: BackendCommandRunner = async (input) => {
      prompts.push(promptOf(input));
      return {
        exitCode: 0,
        stdout: labeledVerdictJson(promptOf(input), "case-skill", "codex"),
        stderr: ""
      };
    };

    const verdict = await evaluatePerAgentSkill({ targetDir: dir, skillName: "case-skill", backend: "codex", runner });
    expect(verdict.recommendedWinner).toBe("codex");
    expect(verdict.evidence).toMatchObject({ availability: "available", result: "inconclusive", regressionVeto: false, caseCount: 3 });
    expect(verdict.notes).toContainEqual(expect.stringContaining("Declarations were supplied"));
    expect(verdict.notes).toContainEqual(expect.stringContaining("non-directional mismatch"));
    expect(prompts.every((prompt) => prompt.includes("Changed full declaration") && prompt.includes("Different expected behavior"))).toBeTrue();
    const serialized = JSON.stringify(verdict) + prompts.join("\n");
    expect(serialized).not.toContain("seeded-secret");
    expect(serialized).not.toContain("dev@example.com");
  });

  test("case-declaration comparison is symmetric when physical vendor copies are swapped", async () => {
    const declarations = [
      [
        { id: "expected-use", kind: "positive" as const, prompt: "first prompt", expectedBehavior: "first behavior" },
        { id: "unrelated", kind: "negative" as const, prompt: "unrelated", expectedBehavior: "do not use" }
      ],
      [
        { id: "expected-use", kind: "positive" as const, prompt: "changed prompt", expectedBehavior: "changed behavior" },
        { id: "unrelated", kind: "negative" as const, prompt: "unrelated", expectedBehavior: "do not use" }
      ]
    ] as const;
    const evaluate = async (swapped: boolean) => {
      const dir = await tempDir();
      await writePinnedCreator(dir);
      await writeSkill(dir, ".claude/skills", "swap-skill");
      await writeSkill(dir, ".agents/skills", "swap-skill");
      await writeCases(dir, ".claude/skills", "swap-skill", [...declarations[swapped ? 1 : 0]]);
      await writeCases(dir, ".agents/skills", "swap-skill", [...declarations[swapped ? 0 : 1]]);
      return evaluatePerAgentSkill({
        targetDir: dir,
        skillName: "swap-skill",
        backend: "codex",
        runner: async (input) => ({
          exitCode: 0,
          stdout: labeledVerdictJson(promptOf(input), "swap-skill", "claude"),
          stderr: ""
        })
      });
    };

    const [one, two] = await Promise.all([evaluate(false), evaluate(true)]);
    expect(one.recommendedWinner).toBe(two.recommendedWinner);
    expect(one.evidence).toMatchObject({ result: "inconclusive", regressionVeto: false });
    expect(two.evidence).toMatchObject({ result: "inconclusive", regressionVeto: false });
    expect(one.evidence?.inputDigest).toBe(two.evidence?.inputDigest);
  });

  test("evaluation cancellation stops before backend work", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await expect(evaluatePerAgentSkill({
      targetDir: await tempDir(),
      skillName: "cancelled-skill",
      backend: "codex",
      signal: controller.signal,
      runner: async () => {
        calls += 1;
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }
    })).rejects.toThrow("cancelled before start");
    expect(calls).toBe(0);
  });

  test("evaluation rejects unexpected staged output without writing reports", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");
    const runner: BackendCommandRunner = async (input) => {
      await writeFile(join(input.cwd, "unexpected.txt"), "not allowed");
      return { exitCode: 0, stdout: labeledVerdictJson(promptOf(input), "pii-masker", "claude"), stderr: "" };
    };

    await expect(evaluatePerAgentSkill({ targetDir: dir, skillName: "pii-masker", backend: "claude", runner }))
      .rejects.toThrow("unexpected output");
    expect(existsSync(join(dir, ".farrier-staging", "eval", "pii-masker"))).toBe(false);
  });

  test("evaluatePerAgentSkill passes reasoningEffort through to the codex judge command", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const calls: BackendCommandRunnerInput[] = [];
    const runner: BackendCommandRunner = async (input) => {
      calls.push(input);
      return { exitCode: 0, stdout: labeledVerdictJson(promptOf(input), "pii-masker", "claude"), stderr: "" };
    };

    await evaluatePerAgentSkill({
      targetDir: dir,
      skillName: "pii-masker",
      backend: "codex",
      reasoningEffort: "xhigh",
      runner
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.cmd.join(" ")).toContain("-c model_reasoning_effort=xhigh");
    }
  });

  test("a judge that flips with candidate order degrades the recommendation to a tie", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const runner: BackendCommandRunner = async (input) => ({
      exitCode: 0,
      stdout: labeledVerdictJson(promptOf(input), "pii-masker", "always-A"),
      stderr: ""
    });

    const verdict = await evaluatePerAgentSkill({ targetDir: dir, skillName: "pii-masker", backend: "claude", runner });

    expect(verdict.recommendedWinner).toBe("tie");
    expect(verdict.notes.join(" ")).toContain("disagreed with itself");
  });

  test("validateLabeledEvalVerdict accepts the documented shape and rejects malformed output with backend-named errors", () => {
    const expected = { skillName: "router", aPath: "x/candidate-one", bPath: "x/candidate-two" };
    const prompt = "Candidate A: x/candidate-one\nCandidate B: x/candidate-two";
    const valid = validateLabeledEvalVerdict(JSON.parse(labeledVerdictJson(prompt, "router", "claude")), "claude", expected);
    expect(valid.recommendedWinner).toBe("A");
    expect(valid.copies.A.score).toBe(8);

    expect(() => validateLabeledEvalVerdict({ skill_name: "router" }, "claude", expected)).toThrow(
      "claude backend JSON must have shape"
    );

    const wrongScore = JSON.parse(labeledVerdictJson(prompt, "router", "claude")) as { copies: { A: { score: number } } };
    wrongScore.copies.A.score = 11;
    expect(() => validateLabeledEvalVerdict(wrongScore, "codex", expected)).toThrow("codex backend JSON field copies.A.score");

    const wrongSkill = JSON.parse(labeledVerdictJson(prompt, "other", "claude"));
    expect(() => validateLabeledEvalVerdict(wrongSkill, "claude", expected)).toThrow("skill_name must be router");

    const wrongPath = JSON.parse(labeledVerdictJson(prompt, "router", "claude")) as { copies: { B: { path: string } } };
    wrongPath.copies.B.path = "elsewhere";
    expect(() => validateLabeledEvalVerdict(wrongPath, "claude", expected)).toThrow("copies.B.path must be x/candidate-two");
  });

  test("a verdict for the wrong skill fails the eval loudly", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const runner: BackendCommandRunner = async (input) => ({
      exitCode: 0,
      stdout: labeledVerdictJson(promptOf(input), "other-skill", "claude"),
      stderr: ""
    });

    await expect(evaluatePerAgentSkill({ targetDir: dir, skillName: "pii-masker", backend: "claude", runner })).rejects.toThrow(
      "skill_name must be pii-masker"
    );
  });

  test("evaluatePerAgentSkill falls back to a global pinned creator when the project has none", async () => {
    const dir = await tempDir();
    const fakeHome = await tempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      await writePinnedCreator(fakeHome);
      await writeSkill(dir, ".claude/skills", "pii-masker");
      await writeSkill(dir, ".agents/skills", "pii-masker");

      const globalRoot = join(fakeHome, ".claude/skills/skill-creator");
      const runner: BackendCommandRunner = async (input) => {
        expect(promptOf(input)).toContain("Read creator/agents/comparator.md");
        return { exitCode: 0, stdout: labeledVerdictJson(promptOf(input), "pii-masker", "claude"), stderr: "" };
      };

      const verdict = await evaluatePerAgentSkill({ targetDir: dir, skillName: "pii-masker", backend: "claude", runner });
      expect(verdict.recommendedWinner).toBe("claude");
    } finally {
      restoreEnv("HOME", previousHome);
    }
  });

  test("evaluatePerAgentSkill self-heals a missing pinned creator by installing it globally", async () => {
    const dir = await tempDir();
    const fakeHome = await tempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      await writeSkill(dir, ".claude/skills", "pii-masker");
      await writeSkill(dir, ".agents/skills", "pii-masker");

      const skillsCalls: CommandRunnerInput[] = [];
      const skillsRunner: CommandRunner = async (input) => {
        skillsCalls.push(input);
        await writePinnedCreator(fakeHome);
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const runner: BackendCommandRunner = async (input) => ({
        exitCode: 0,
        stdout: labeledVerdictJson(promptOf(input), "pii-masker", "claude"),
        stderr: ""
      });

      const verdict = await evaluatePerAgentSkill({
        targetDir: dir,
        skillName: "pii-masker",
        backend: "claude",
        runner,
        skillsRunner,
        resolveDeps: { which: () => "skills", exists: () => false }
      });

      expect(verdict.recommendedWinner).toBe("claude");
      expect(skillsCalls).toHaveLength(1);
      expect(skillsCalls[0]?.cmd).toContain("-g");
    } finally {
      restoreEnv("HOME", previousHome);
    }
  });

  test("evaluatePerAgentSkill fails loudly when the pinned creator is missing everywhere and install fails", async () => {
    const dir = await tempDir();
    const fakeHome = await tempDir();
    const previousHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      await writeSkill(dir, ".claude/skills", "pii-masker");
      await writeSkill(dir, ".agents/skills", "pii-masker");

      const skillsRunner: CommandRunner = async () => ({ exitCode: 1, stdout: "", stderr: "network unreachable" });
      const runner: BackendCommandRunner = async () => ({ exitCode: 0, stdout: "{}", stderr: "" });

      await expect(
        evaluatePerAgentSkill({
          targetDir: dir,
          skillName: "pii-masker",
          backend: "claude",
          runner,
          skillsRunner,
          resolveDeps: { which: () => "skills", exists: () => false }
        })
      ).rejects.toThrow("Pinned Anthropic skill-creator eval tooling is missing from both");
    } finally {
      restoreEnv("HOME", previousHome);
    }
  });

  test("eval and winner resolution reject non-kebab-case skill names before touching any path", async () => {
    const dir = await tempDir();
    let runnerCalls = 0;
    const runner: BackendCommandRunner = async () => {
      runnerCalls += 1;
      return { exitCode: 0, stdout: "{}", stderr: "" };
    };

    await expect(
      evaluatePerAgentSkill({ targetDir: dir, skillName: "../pii-masker", backend: "codex", runner })
    ).rejects.toThrow("must be kebab-case");
    expect(runnerCalls).toBe(0);

    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");
    await expect(
      resolvePerAgentSkillWinner({ targetDir: dir, skillName: "../../etc", winner: "claude", confirmDeleteAndLink: true })
    ).rejects.toThrow("must be kebab-case");
    expect((await lstat(join(dir, ".agents/skills/pii-masker"))).isDirectory()).toBe(true);
  });

  test("diverged per-agent names are evaluated blind and resolved under the winner's name", async () => {
    const dir = await tempDir();
    await writePinnedCreator(dir);
    await writeSkill(dir, ".claude/skills", "pdf-tables");
    await writeSkill(dir, ".agents/skills", "convert-tables");

    const names = { claude: "pdf-tables", codex: "convert-tables" };
    const runner: BackendCommandRunner = async (input) => ({
      exitCode: 0,
      stdout: labeledVerdictJson(promptOf(input), "pdf-tables", "claude"),
      stderr: ""
    });

    const verdict = await evaluatePerAgentSkill({ targetDir: dir, skillName: "pdf-tables", names, backend: "codex", runner });
    expect(verdict.recommendedWinner).toBe("claude");
    expect(verdict.copies.codex.path).toBe(".agents/skills/convert-tables");

    const resolution = await resolvePerAgentSkillWinner({
      targetDir: dir,
      skillName: "pdf-tables",
      names,
      winner: "claude",
      confirmDeleteAndLink: true
    });

    expect(resolution.deleted).toEqual([".agents/skills/convert-tables"]);
    expect(resolution.links[0]?.path).toBe(".agents/skills/pdf-tables");
    expect(existsSync(join(dir, ".agents/skills/convert-tables"))).toBe(false);
    expect(await realpath(join(dir, ".agents/skills/pdf-tables/SKILL.md"))).toBe(
      await realpath(join(dir, ".claude/skills/pdf-tables/SKILL.md"))
    );
  });

  test("diverged-name resolution refuses when the winner's name already exists in the loser's root", async () => {
    const dir = await tempDir();
    await writeSkill(dir, ".claude/skills", "pdf-tables");
    await writeSkill(dir, ".agents/skills", "convert-tables");
    await writeSkill(dir, ".agents/skills", "pdf-tables");

    await expect(
      resolvePerAgentSkillWinner({
        targetDir: dir,
        skillName: "pdf-tables",
        names: { claude: "pdf-tables", codex: "convert-tables" },
        winner: "claude",
        confirmDeleteAndLink: true
      })
    ).rejects.toThrow(".agents/skills/pdf-tables already exists");
    expect((await lstat(join(dir, ".agents/skills/convert-tables"))).isDirectory()).toBe(true);
  });

  test("resolvePerAgentSkillWinner deletes exactly the loser and creates a resolving relative symlink", async () => {
    const dir = await tempDir();
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const resolution = await resolvePerAgentSkillWinner({
      targetDir: dir,
      skillName: "pii-masker",
      winner: "claude",
      confirmDeleteAndLink: true
    });

    expect(resolution.deleted).toEqual([".agents/skills/pii-masker"]);
    expect(resolution.links[0]?.path).toBe(".agents/skills/pii-masker");
    expect(resolution.backupPath).toBeUndefined();
    expect(await lstat(join(dir, ".farrier-staging", "transactions")).catch(() => undefined)).toBeUndefined();
    expect(await readlink(join(dir, ".agents/skills/pii-masker"))).toBe("../../.claude/skills/pii-masker");
    expect((await lstat(join(dir, ".agents/skills/pii-masker"))).isSymbolicLink()).toBe(true);
    expect(await realpath(join(dir, ".agents/skills/pii-masker/SKILL.md"))).toBe(
      await realpath(join(dir, ".claude/skills/pii-masker/SKILL.md"))
    );
    expect(existsSync(join(dir, ".agents/skills/pii-masker.farrier-delete"))).toBe(false);
  });

  test("retainBackupInTrash keeps the deleted copy under .farrier-staging/trash/", async () => {
    const dir = await tempDir();
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    const resolution = await resolvePerAgentSkillWinner({
      targetDir: dir,
      skillName: "pii-masker",
      winner: "codex",
      confirmDeleteAndLink: true,
      retainBackupInTrash: true
    });

    expect(resolution.deleted).toEqual([".claude/skills/pii-masker"]);
    expect(resolution.backupPath).toMatch(/^\.farrier-staging\/trash\/pii-masker-/);
    expect(await readFile(join(dir, resolution.backupPath!, "SKILL.md"), "utf8")).toContain("name: pii-masker");
    expect((await lstat(join(dir, ".claude/skills/pii-masker"))).isSymbolicLink()).toBe(true);
    expect(resolution.notes.join(" ")).toContain("change your mind");
    expect(resolution.backupPath).toBeDefined();
  });

  test("resolvePerAgentSkillWinner refuses unsafe paths and missing confirmation", async () => {
    const dir = await tempDir();
    await writeSkill(dir, ".claude/skills", "pii-masker");
    await writeSkill(dir, ".agents/skills", "pii-masker");

    await expect(
      resolvePerAgentSkillWinner({ targetDir: dir, skillName: "pii-masker", winner: "claude", confirmDeleteAndLink: false })
    ).rejects.toThrow("explicit confirmation");
    expect((await lstat(join(dir, ".agents/skills/pii-masker"))).isDirectory()).toBe(true);

    await rm(join(dir, ".agents/skills/pii-masker"), { recursive: true, force: true });
    await expect(
      resolvePerAgentSkillWinner({ targetDir: dir, skillName: "pii-masker", winner: "claude", confirmDeleteAndLink: true })
    ).rejects.toThrow("missing .agents/skills/pii-masker");

    await mkdir(join(dir, ".agents/skills"), { recursive: true });
    await symlink("../elsewhere", join(dir, ".agents/skills/pii-masker"));
    await expect(
      resolvePerAgentSkillWinner({ targetDir: dir, skillName: "pii-masker", winner: "claude", confirmDeleteAndLink: true })
    ).rejects.toThrow("already a symlink");
  });

  test("eligiblePerAgentEvals offers only per-agent outcomes with both copies in place", () => {
    const perAgent: SkillCreationRequest = { description: "Mask PII", agents: ["claude", "codex"], mode: "per-agent" };
    const bothCopies: SkillCreationOutcome = {
      request: perAgent,
      name: "pii-masker",
      files: [".claude/skills/pii-masker/SKILL.md", ".agents/skills/pii-masker/SKILL.md"],
      installed: false,
      notes: []
    };

    expect(eligiblePerAgentEvals([bothCopies])).toEqual([
      { skillName: "pii-masker", names: { claude: "pii-masker", codex: "pii-masker" }, description: "Mask PII" }
    ]);
    expect(eligiblePerAgentEvals([{ ...bothCopies, error: "codex: leg failed" }])).toEqual([]);
    expect(eligiblePerAgentEvals([{ ...bothCopies, files: [".claude/skills/pii-masker/SKILL.md"] }])).toEqual([]);
    expect(
      eligiblePerAgentEvals([{ ...bothCopies, request: { ...perAgent, mode: "author-claude" } }])
    ).toEqual([]);
  });

  test("eligiblePerAgentEvals recovers diverged per-agent names from the outcome files", () => {
    const perAgent: SkillCreationRequest = { description: "Tables to markdown", agents: ["claude", "codex"], mode: "per-agent" };
    const diverged: SkillCreationOutcome = {
      request: perAgent,
      name: "pdf-tables",
      files: [
        ".claude/skills/pdf-tables/SKILL.md",
        ".claude/skills/pdf-tables/scripts/tablesToMarkdown.ts",
        ".agents/skills/convert-tables/SKILL.md"
      ],
      installed: false,
      notes: ["The copies chose different names: pdf-tables, convert-tables."]
    };

    expect(eligiblePerAgentEvals([diverged])).toEqual([
      { skillName: "pdf-tables", names: { claude: "pdf-tables", codex: "convert-tables" }, description: "Tables to markdown" }
    ]);
  });

  test("harness write forwards an onCollision handler into createSkills", async () => {
    const dir = await tempDir();
    const request: SkillCreationRequest = { description: "x", agents: ["claude"], mode: "author-claude" };
    const decisions: string[] = [];
    const outcome: SkillCreationOutcome = { request, name: "x", files: [], installed: false, notes: [] };

    await runHarnessWrite(
      {
        reviewPlan: { targetDir: dir, files: [] },
        selectedSkills: [],
        createRequests: [request],
        targetDir: dir,
        signal: new AbortController().signal,
        onCollision: async (info) => {
          decisions.push(`${info.path}:${info.stagingPath}`);
          return "replace";
        }
      },
      {
        writeRenderPlan: async () => ({ written: [], unchanged: [], writtenFiles: [], unchangedFiles: [], backupDir: null }),
        installSkills: async () => [],
        createSkills: async (_requests, _targetDir, deps) => {
          expect(deps).toBeDefined();
          expect(await deps!.onCollision?.({ path: "skills/x", stagingPath: ".farrier-staging/1/x" })).toBe("replace");
          return [outcome];
        }
      }
    );

    expect(decisions).toEqual(["skills/x:.farrier-staging/1/x"]);
  });

  test("queued collision handler resolves replace and keep decisions", async () => {
    let collision: CollisionPrompt | null = null;
    const currentCollision = (): CollisionPrompt => {
      if (!collision) {
        throw new Error("collision prompt was not shown");
      }
      return collision;
    };
    const chainRef = { current: Promise.resolve() };
    const handler = createQueuedCollisionHandler({
      signal: new AbortController().signal,
      chainRef,
      setCollision: (value) => {
        collision = typeof value === "function" ? value(collision) : value;
      }
    });

    const replace = handler({ path: "skills/replace-me", stagingPath: ".farrier-staging/1/replace-me" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    currentCollision().resolve("replace");
    expect(await replace).toBe("replace");

    const keep = handler({ path: "skills/keep-me", stagingPath: ".farrier-staging/1/keep-me" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    currentCollision().resolve("keep");
    expect(await keep).toBe("keep");
  });
});

```
</file_contents>
<meta prompt 1 = "[Architect]">
You are producing an implementation-ready technical plan. The implementer will work from your plan without asking clarifying questions, so every design decision must be resolved, every touched component must be identified, and every behavioral change must be specified precisely.

Your job:
1. Analyze the requested change against the provided code — identify the relevant architecture, constraints, data flow, and extension points.
2. Decide whether this is best solved by a targeted change or a broader refactor, and justify that decision.
3. Produce a plan detailed enough that an engineer can implement it file-by-file without making design decisions of their own.

Hard constraints:
- Do not write production code, patches, diffs, or copy-paste-ready implementations.
- Stay in analysis and architecture mode only.
- Use illustrative snippets, interface shapes, sample signatures, state/data shapes, or pseudocode when they communicate the design more precisely than prose. Keep them partial — enough to remove ambiguity, not enough to copy-paste.
- Scale your response to the complexity of the request. Small, localized changes need short plans; only expand sections for changes that genuinely require the detail.

─── ANALYSIS ───

Current-state analysis (always include):
- Map the existing responsibilities, type relationships, ownership, data flow, and mutation points relevant to the request.
- Identify existing code that should be reused or extended — never duplicate what already exists without justification.
- Note hard constraints: API contracts, protocol conformances, state ownership rules, thread/actor isolation, persistence schemas, UI update mechanisms.
- When multiple subsystems interact, trace the call chain end-to-end and identify each transformation boundary.

─── DESIGN ───

Design standards — address only the standards relevant to the change; skip sections that don't apply:

1. New and modified components/types: For each, specify:
   - The name, kind (for example: class, interface, enum, record, service, module, controller), and why that kind fits the codebase and language.
   - The fields/properties/state it owns, including data shape, mutability, and ownership/lifecycle semantics.
   - Key callable interfaces or signatures, including inputs, outputs, and whether execution is synchronous/asynchronous or can fail.
   - Contracts it implements, extends, composes with, or depends on.
   - For closed sets of variants (for example enums, tagged unions, discriminated unions): all cases/variants and any attached data.
   - Where the component lives (file path) and who creates/owns its instances.

2. State and data flow: For each state change the plan introduces or modifies:
   - What triggers the change (user action, callback, notification, timer, stream event).
   - The exact path the data travels: source → transformations → destination.
   - Thread/actor/queue context at each step.
   - How downstream consumers observe the change (published property, delegate, notification, binding, callback).
   - What happens if the change arrives out of order, is duplicated, or is dropped.

3. API and interface changes: For each modified public/internal interface:
   - The before and after signatures (or new signature if additive).
   - Every call site that must be updated, grouped by file.
   - Backward-compatibility strategy if the interface is used by external consumers or persisted data.

4. Persistence and serialization: When the plan touches stored data:
   - Schema changes with exact field names, types, and defaults.
   - Migration strategy: how existing data is read, transformed, and re-persisted.
   - What happens when new code reads old data and when old code reads new data (if rollback is possible).

5. Concurrency and lifecycle:
   - Specify the execution model and safety boundaries for each new/modified component: thread affinity, event-loop/runtime constraints, isolation boundaries, queue/worker discipline, or thread-safety expectations as applicable.
   - Identify potential races, leaked references/resources, or lifecycle mismatches introduced by the change.
   - When operations are asynchronous, specify cancellation/abort behavior and what state remains after interruption.

6. Error handling and edge cases:
   - For each operation that can fail, specify what failures are possible and how they propagate.
   - Describe degraded-mode behavior: what the user sees, what state is preserved, what recovery is available.
   - Identify boundary conditions: empty collections, missing/null/optional values, first-run states, interrupted operations.

7. Algorithmic and logic-heavy work (include whenever the change involves non-trivial control flow, state machines, data transformations, or performance-sensitive paths):
   - Describe the algorithm step-by-step: inputs, outputs, invariants, and data structures.
   - Cover edge cases, failure modes, and performance characteristics (time/space complexity if relevant).
   - Explain why this approach over the most plausible alternatives.

8. Avoid unnecessary complexity:
   - Do not add layers, abstractions, or indirection without a concrete benefit identified in the plan.
   - Do not create parallel code paths — unify where possible.
   - Reuse existing patterns unless those patterns are themselves the problem.

─── OUTPUT ───

Structure your response as:

1. **Summary** — One paragraph: what changes, why, and the high-level approach.

2. **Current-state analysis** — How the relevant code works today. Trace the data/control flow end-to-end. Identify what is reusable and what is blocking.

3. **Design** — The core of the plan. Apply every applicable standard from above. Organize by logical component or subsystem, not by standard number. Each component section should cover types, state flow, interfaces, persistence, concurrency, and error handling as relevant to that component.

4. **File-by-file impact** — For every file that changes, list:
   - What changes (added/modified/removed types, methods, properties).
   - Why (which design decision drives this change).
   - Dependencies on other changes in this plan (ordering constraints).

5. **Risks and migration** — Include only when the change introduces breaking changes, data migration, or rollback concerns. Omit for additive or non-breaking work.

6. **Implementation order** — A numbered sequence of steps. Each step should be independently compilable and testable where possible. Call out steps that must be atomic (landed together).

Response discipline:
- Be specific to the provided code — reference actual type names, file paths, method names, and property names.
- Make every assumption explicit.
- Flag unknowns that must be validated during implementation, with a suggested validation approach.
- When a design decision has a non-obvious rationale, explain it in one sentence.
- Do not pad with generic advice. Every sentence should convey information the implementer needs.

Please proceed with your analysis based on the following <user instructions>
</meta prompt 1>
<user_instructions>
<taskname="Provider native plan"/>

<task>
Write one concise, ready-to-execute implementation plan at `docs/plans/provider-native-authoring-shared-skills-2026-07-14.md`. Plan only. Do not implement source changes. Replace the existing scaffold in that file with ordered work items and concrete file/test references for a complete migration from ambiguous public authoring concepts (`--backend`, advice `--targets`, skill `--agents`/`--mode`) to canonical `--author claude|codex`.

The plan must cover provider-owned native config, project-advice session/evidence/recommendation/artifact routing, later file authoring, standalone native skills, shared skills, repeatable independent authors, evaluation/winner linking, compatibility aliases/conflicts/warnings/removal timing, JSON compatibility, TUI/headless parity, generated commands, doctor/update, manifests/lock behavior, and repository gates. Work from the current dirty tree and preserve unrelated edits. Do not edit protected generated/owned files such as `skills-lock.json` or `.farrier.json`; the only requested write is the plan document.
</task>

<architecture>
- `src/cli.ts` is the top-level command router and global help. Subcommand parsers live in `src/cli/advise.ts`, `skill-new.ts`, `skill-eval.ts`, `doctor.ts`, and `update.ts`.
- `src/engine/backend.ts` probes Claude/Codex and builds provider-specific invocations; `agent-selection.ts` holds provider selection parsing. `project-advice.ts` is the provider-purity boundary: backend, targets, session source, evidence provider, report provider, and artifact routes must agree. `advice-sessions.ts`, `behavior-evidence.ts`, `advice-types.ts`, and `advice-catalog.ts` define the supporting evidence/report/recommendation contracts.
- Advice application flows through `advice-apply.ts` and `create-plan.ts`/`create-plan-apply.ts`. TUI routing and review are in `advice-actions.ts`, `advise-machine.ts`, `advise-app.tsx`, `create-app.tsx`, and `create-eval.tsx`.
- Standalone creation is parsed in `skill-new.ts` and implemented by `create-skill.ts`. `skill-creation-plan.ts`, `skill-authoring-prompt.ts`, and `execution-isolation.ts` define creation modes, provider prompts, and isolated staging. `skill-paths.ts` is the canonical native route map: Claude `.claude/skills`, Codex `.agents/skills`.
- `skills.ts` owns skill install and manifest recording. `doctor.ts` and `update.ts` validate/repair manifest, lock, and installed trees.
- `mutation-transaction.ts` provides reviewed fingerprints, write/replace/remove/link operations, relative in-root link validation, backups, concurrent-edit detection, rollback, and recoverable rollback failure. `eval-skill.ts` already uses this transaction to replace the losing native copy with a safe relative link after blind evaluation and winner selection.
- Generated advisor instructions are provider-specific templates under `src/templates/skills`. README and CLI help currently expose contradictory legacy grammar.
</architecture>

<selected_context>
- `docs/plans/provider-native-authoring-shared-skills-2026-07-14.md`: current 28-line scaffold and sole edit target.
- `src/cli.ts`, `src/cli/advise.ts`: documented/parser mismatch for advice targets, Claude-first backend detection, legacy JSON/report behavior.
- `src/cli/skill-new.ts`: current `--agents`, `--mode author-claude|author-codex|per-agent`, `--eval`, `--no-llm`, `--no-install`, force/confirmation, model handling, manifest recording.
- `src/cli/skill-eval.ts`: blind comparison and apply-winner CLI surface.
- `src/engine/project-advice.ts`, `advice-types.ts`, `advice-sessions.ts`, `behavior-evidence.ts`, `advice-catalog.ts`, `advice-apply.ts`: provider-pure analysis and native artifact creation seams.
- `src/engine/create-skill.ts`, `skill-creation-plan.ts`, `skill-authoring-prompt.ts`, `execution-isolation.ts`, `skill-paths.ts`: existing canonical-copy/per-agent authoring, isolated drafts, prompt ownership, and native routes.
- `src/engine/mutation-transaction.ts`, `eval-skill.ts`: reusable collision review, relative links, atomic backup/rollback, concurrent-change checks, blind verdict/tie/winner/loser-link behavior.
- `src/engine/skills.ts`, `doctor.ts`, `update.ts`; CLI doctor/update wrappers: manifest/lock ownership and validation/repair seams.
- TUI files: selected advice author state currently called backend, provider-first defaulting, advice-created skill requests, creation/eval flow, and parity surface.
- Generated templates: `claude-automation-recommender/SKILL.md` currently emits `--targets claude`; `farrier-project-advisor/SKILL.md` emits `--targets codex`; `harness-advisor/SKILL.md` supplies adjacent generated guidance.
- `README.md`: current public advice and skill-new grammar and behavior. `package.json`, `justfile`, `konsistent.json`: repository checks.
- Tests selected in full: `advice-cli.test.ts`, `project-advice.test.ts`, `skill-new-cli.test.ts`, `create-skill.test.ts`, `eval-skill.test.ts`, `mutation-transaction.test.ts`, `tui-parity.test.ts`, `update.test.ts`.
</selected_context>

<relationships>
- Headless advice: CLI parser → provider resolution/probe → model settings → `adviseProject` → exact provider session discovery/evidence → provider-matched report/recommendations → native artifact route.
- TUI advice: `advise-machine` author/backend state → `advise-app` run → `project-advice` → `advice-actions` → native file plan or provider-owned skill creation request.
- Skill new: parser grammar → `SkillCreationRequest`/creation mode → isolated provider authoring → reviewed placement → native route/install → manifest and `skills-lock.json`.
- Shared skill required topology: real `.agents/skills/<name>`; relative `.claude/skills/<name> -> ../../.agents/skills/<name>`; both destinations reviewed before mutation; refusal by default; explicit replacement through the existing transaction.
- Independent repeatable `--author`: Claude and Codex native copies must coexist so later invocation authors the missing/selected copy without destroying the other; blind eval compares both; ties keep both; selected winner may replace loser with a transactionally reviewed relative link.
- Existing machine-facing fields named `backend`, `targets`, `agents`, and `mode` may remain where compatibility requires even though public grammar becomes author-centric.
</relationships>

<required_decisions>
State exact decisions, not open questions:
- Whether advice requires `--author` when both CLIs exist or uses a documented default. Prevent accidental Claude-first routing for generated Codex commands.
- Canonical and repeated `--author` grammar for independent copies; define duplicates, ordering, `--shared` exactly-one-author constraint, and conflicts.
- Temporary `--backend` alias rules, promotion of legacy single `--targets claude|codex`, mapping of skill-new `--agents`/`--mode`, conflict examples such as `--author codex --backend claude`, warnings, and staged removal release/timing.
- Manifest ownership and `skills-lock.json` representation for native, independent, and shared skills without unnecessary schema migration.
- Exact `--no-llm` scaffold and `--no-install` behavior for native/shared/independent cases.
</required_decisions>

<acceptance>
Include explicit coverage for Claude and Codex native advice/artifacts; both CLIs installed; native skill creation; shared real tree and exact relative link; collisions at both destinations; default refusal and forced transactional replacement; rollback, recoverable rollback, and concurrent edits; independently authored copies; blind comparison, ties, winner selection, loser replacement/link; legacy aliases and conflicts; human/JSON/TUI parity; doctor/update tree/link/manifest/behavior/drift checks; generated advisor commands; and `just check` plus `just konsistent`.
</acceptance>

<ambiguities>
The requested migration deliberately leaves policy choices to the plan author. Resolve them in the plan rather than retaining an “Open Questions” section. The current working tree has 79 modified and 16 untracked files, including the target scaffold and new provider-purity/mutation-safety helpers, so references must describe the current implementation rather than assume HEAD behavior.
</ambiguities>
</user_instructions>

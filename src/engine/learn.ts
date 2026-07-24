import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { notFarrierProjectMessage, readManifest, type NormalizedManifest } from "./manifest";
import { hooksDirectory } from "./render";
import type { ToolPolicyRule } from "../packs/types";
import type { ReasoningEffort } from "../config/farrier-config";
import { applyMutationPlan, fingerprintPath, inspectMutationPlan } from "./mutation-transaction";
import { isolatedAuthoringTimeoutMs, withIsolatedExecution } from "./execution-isolation";
import {
  backendEnvironmentOverrides,
  backendEnvironmentPassthrough,
  backendFailureMessage,
  defaultBackendRunner,
  type BackendCommandRunner,
  type BackendCommandRunnerInput,
  type BackendCommandRunnerOutput
} from "./backend";
import { compareEvidence, createEvidenceSet, type EvidenceComparison } from "./behavior-evidence";
import { toolResultsFromRecord, toolUseFromRecord, type FailureSignal } from "./learn-signals";
import { mineFailureSignalsFromSources } from "./learn-signals-codex";
import { routeFailureSignals, type PrimitiveProposal } from "./failure-router";
import { refineProposalText, type DroppedRefinement } from "./proposal-authoring";

export type CandidateEvent = {
  command: string;
  reason: string;
  count: number;
};

export type LearnBackend = "claude" | "codex";

export type LearnCommandRunnerInput = BackendCommandRunnerInput;
export type LearnCommandRunnerOutput = BackendCommandRunnerOutput;
export type LearnCommandRunner = BackendCommandRunner;

export type DroppedProposal = {
  id?: string;
  reason: string;
};

export type LearnOptions = {
  targetDir: string;
  transcriptsDir?: string;
  /** Override for the codex rollout directory; defaults to ~/.codex/sessions. */
  codexSessionsDir?: string;
  yes?: boolean;
  json?: boolean;
  noLlm?: boolean;
  backend?: LearnBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner?: LearnCommandRunner;
};

export type LearnReport = {
  targetDir: string;
  manifestPath: string;
  learnEnabled: boolean;
  transcriptsDir: string;
  candidateEvents: CandidateEvent[];
  proposedRules: ToolPolicyRule[];
  droppedProposals: DroppedProposal[];
  /** Deterministic failure signals mined with counts, dates, and session refs. */
  signals: FailureSignal[];
  /** Failure→primitive router output; review-only, never auto-applied. */
  primitiveProposals: PrimitiveProposal[];
  /** Proposal ids whose text the refinement backend rewrote (wording only). */
  refinedProposalIds: string[];
  /** Rejected text refinements, with reasons; the deterministic text stays. */
  droppedRefinements: DroppedRefinement[];
  evidence?: EvidenceComparison;
  notes: string[];
  errors: string[];
};

export type LearnApplyResult = {
  report: LearnReport;
  appendedRules: ToolPolicyRule[];
  skippedExistingIds: string[];
  rulesPath: string;
};

export type RuleValidationContext = {
  existingIds: Set<string>;
  proposedIds: Set<string>;
  candidateCommands?: string[];
};

export type RuleValidationResult =
  | {
      ok: true;
      rule: ToolPolicyRule;
    }
  | {
      ok: false;
      reason: string;
      id?: string;
    };

type TranscriptObservation = {
  command: string;
  reason: string;
};

type ToolPolicyRulesDocument = {
  version: 1;
  rules: unknown[];
};

type ReadToolPolicyRulesResult = {
  path: string;
  missing: boolean;
  document: ToolPolicyRulesDocument;
  existingIds: Set<string>;
  errors: string[];
};

const transcriptEventLimit = 200;
const rulesRelativePath = `${hooksDirectory}/tool-policy-rules.json`;
const kebabCasePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const allowedRegexFlagsPattern = /^[ims]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slug(value: string): string {
  const slugged = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slugged.length > 0 ? slugged : "cmd";
}

function shellTokens(command: string): string[] {
  return (
    command
      .match(/[A-Za-z0-9_./:-]+/g)
      ?.filter((token) => token.length > 0 && !["sudo", "env"].includes(token.toLowerCase())) ?? []
  );
}

function firstTwoTokenPrefix(command: string): [string, string] | undefined {
  const tokens = shellTokens(command);

  if (tokens.length < 2) {
    return undefined;
  }

  return [tokens[0]!, tokens[1]!];
}

function prefixKey(command: string): string | undefined {
  const prefix = firstTwoTokenPrefix(command);
  return prefix ? `${prefix[0]}\u0000${prefix[1]}` : undefined;
}

function summarizeReason(text: string, denied: boolean): string {
  if (denied) {
    return "blocked by hook or permission denial";
  }

  const firstUsefulLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstUsefulLine) {
    return "repeated Bash command failed";
  }

  return firstUsefulLine.length > 160 ? `${firstUsefulLine.slice(0, 157)}...` : firstUsefulLine;
}

function toCandidateEvents(observations: TranscriptObservation[]): CandidateEvent[] {
  const byCommand = new Map<string, { command: string; reasons: string[]; count: number }>();
  const prefixCounts = new Map<string, number>();

  for (const observation of observations) {
    const current = byCommand.get(observation.command) ?? {
      command: observation.command,
      reasons: [],
      count: 0
    };

    current.count += 1;
    current.reasons.push(observation.reason);
    byCommand.set(observation.command, current);

    const key = prefixKey(observation.command);
    if (key) {
      prefixCounts.set(key, (prefixCounts.get(key) ?? 0) + 1);
    }
  }

  return Array.from(byCommand.values())
    .map((entry) => {
      const key = prefixKey(entry.command);
      const prefixCount = key ? prefixCounts.get(key) ?? 0 : 0;

      return {
        command: entry.command,
        reason: entry.reasons[0] ?? "blocked or failed Bash command",
        count: Math.max(entry.count, prefixCount)
      };
    })
    .sort((left, right) => right.count - left.count || left.command.localeCompare(right.command));
}

export function defaultTranscriptDir(targetDir: string): string {
  const absoluteTargetDir = resolve(targetDir);
  // Claude Code slugs every non-alphanumeric character to "-" (underscores and
  // dots included), not just path separators.
  const slugged = absoluteTargetDir.replace(/[^a-zA-Z0-9]/g, "-");

  return join(process.env.HOME || homedir(), ".claude", "projects", slugged);
}

export async function extractCandidateEvents(
  transcriptsDir: string,
  options: {
    maxEvents?: number;
    fileFilter?: (fileName: string) => boolean;
    recordFilter?: (record: Record<string, unknown>) => boolean;
  } = {}
): Promise<{ events: CandidateEvent[]; notes: string[] }> {
  const maxEvents = options.maxEvents ?? transcriptEventLimit;
  const notes: string[] = [];
  const observations: TranscriptObservation[] = [];
  const commandByToolUseId = new Map<string, string>();
  let lastBashCommand: string | undefined;
  let malformedLines = 0;

  let entries: string[];
  try {
    entries = await readdir(transcriptsDir);
  } catch {
    return {
      events: [],
      notes: [`Transcript directory not found or unreadable: ${transcriptsDir}`]
    };
  }

  const files = entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .filter((entry) => options.fileFilter?.(entry) ?? true)
    .sort();

  for (const file of files) {
    if (observations.length >= maxEvents) {
      break;
    }

    const text = await readFile(join(transcriptsDir, file), "utf8");
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      if (observations.length >= maxEvents) {
        break;
      }

      if (!line.trim()) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue;
      }

      if (!isRecord(parsed)) {
        continue;
      }

      if (options.recordFilter && !options.recordFilter(parsed)) {
        continue;
      }

      const uses = toolUseFromRecord(parsed);
      for (const use of uses) {
        lastBashCommand = use.command;
        if (use.id) {
          commandByToolUseId.set(use.id, use.command);
        }
      }

      const directCommand = uses[0]?.command ?? lastBashCommand;
      const results = toolResultsFromRecord(parsed);

      for (const result of results) {
        const command = result.toolUseId ? commandByToolUseId.get(result.toolUseId) ?? directCommand : directCommand;

        if (!command) {
          continue;
        }

        observations.push({
          command,
          reason: summarizeReason(result.text, result.isDenied)
        });

        if (observations.length >= maxEvents) {
          break;
        }
      }
    }
  }

  if (malformedLines > 0) {
    notes.push(`Skipped ${malformedLines} malformed transcript line(s).`);
  }

  if (observations.length >= maxEvents) {
    notes.push(`Stopped after ${maxEvents} candidate transcript event(s).`);
  }

  return {
    events: toCandidateEvents(observations),
    notes
  };
}

export function deterministicRuleProposals(events: CandidateEvent[]): ToolPolicyRule[] {
  const proposals = new Map<string, ToolPolicyRule>();

  for (const event of events) {
    if (event.count < 2) {
      continue;
    }

    const prefix = firstTwoTokenPrefix(event.command);
    if (!prefix) {
      continue;
    }

    const [first, second] = prefix;
    const id = `learn-ban-${slug(first)}-${slug(second)}`;

    if (proposals.has(id)) {
      continue;
    }

    const pattern = `(^|[;&|()\\s])${escapeRegExp(first)}\\s+${escapeRegExp(second)}\\b`;

    proposals.set(id, {
      id,
      description: `Learned from repeated transcript failures for \`${first} ${second}\`.`,
      tool: "Bash",
      commandPattern: pattern,
      flags: "i",
      message: `Avoid \`${first} ${second}\` in this project. This pattern was learned from repeated blocked or failing transcript events.`,
      redirect: "Use the project-approved command documented in AGENTS.md or justfile, or ask the user before retrying."
    });
  }

  return Array.from(proposals.values());
}

function compileRulePattern(pattern: string, flags?: string): string | undefined {
  try {
    new RegExp(pattern, flags ?? "");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function ruleMatchesAnyCandidate(rule: ToolPolicyRule, candidateCommands: string[] | undefined): boolean {
  if (!candidateCommands || candidateCommands.length === 0) {
    return true;
  }

  let pattern: RegExp;
  try {
    pattern = new RegExp(rule.commandPattern, rule.flags ?? "");
  } catch {
    return false;
  }

  return candidateCommands.some((command) => pattern.test(command));
}

export function validateToolPolicyRuleProposal(value: unknown, context: RuleValidationContext): RuleValidationResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      reason: "proposal must be an object"
    };
  }

  const id = optionalString(value.id);

  if (!id) {
    return {
      ok: false,
      reason: "proposal is missing required string field id"
    };
  }

  if (!kebabCasePattern.test(id)) {
    return {
      ok: false,
      id,
      reason: "rule id must be kebab-case"
    };
  }

  if (context.existingIds.has(id)) {
    return {
      ok: false,
      id,
      reason: "rule id already exists"
    };
  }

  if (context.proposedIds.has(id)) {
    return {
      ok: false,
      id,
      reason: "rule id duplicates another proposal"
    };
  }

  const description = optionalString(value.description);
  const commandPattern = optionalString(value.commandPattern);
  const message = optionalString(value.message);
  const redirect = optionalString(value.redirect);

  if (!description) {
    return {
      ok: false,
      id,
      reason: "proposal is missing required string field description"
    };
  }

  if (value.tool !== "Bash") {
    return {
      ok: false,
      id,
      reason: 'proposal field tool must be exactly "Bash"'
    };
  }

  if (!commandPattern) {
    return {
      ok: false,
      id,
      reason: "proposal is missing required string field commandPattern"
    };
  }

  if (!message) {
    return {
      ok: false,
      id,
      reason: "proposal is missing required string field message"
    };
  }

  if (!redirect) {
    return {
      ok: false,
      id,
      reason: "proposal is missing required string field redirect"
    };
  }

  const flags = value.flags === undefined ? undefined : optionalString(value.flags);
  if (value.flags !== undefined && flags === undefined) {
    return {
      ok: false,
      id,
      reason: "proposal field flags must be a non-empty string when present"
    };
  }

  if (flags !== undefined && !allowedRegexFlagsPattern.test(flags)) {
    return {
      ok: false,
      id,
      reason: "proposal field flags may contain only i, m, and s"
    };
  }

  const compileError = compileRulePattern(commandPattern, flags);
  if (compileError) {
    return {
      ok: false,
      id,
      reason: `commandPattern does not compile: ${compileError}`
    };
  }

  const rule: ToolPolicyRule = {
    id,
    description,
    tool: "Bash",
    commandPattern,
    ...(flags !== undefined ? { flags } : {}),
    message,
    redirect
  };

  if (!ruleMatchesAnyCandidate(rule, context.candidateCommands)) {
    return {
      ok: false,
      id,
      reason: "commandPattern does not match any mined candidate command"
    };
  }

  return {
    ok: true,
    rule
  };
}

export async function readToolPolicyRulesDocument(targetDir: string): Promise<ReadToolPolicyRulesResult> {
  const path = join(targetDir, rulesRelativePath);

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return {
      path,
      missing: true,
      document: {
        version: 1,
        rules: []
      },
      existingIds: new Set(),
      errors: []
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      path,
      missing: false,
      document: {
        version: 1,
        rules: []
      },
      existingIds: new Set(),
      errors: [`invalid ${rulesRelativePath}: ${message}`]
    };
  }

  if (!isRecord(parsed)) {
    return {
      path,
      missing: false,
      document: {
        version: 1,
        rules: []
      },
      existingIds: new Set(),
      errors: [`invalid ${rulesRelativePath}: root must be an object`]
    };
  }

  if (parsed.version !== 1) {
    return {
      path,
      missing: false,
      document: {
        version: 1,
        rules: []
      },
      existingIds: new Set(),
      errors: [`invalid ${rulesRelativePath}: version must be 1`]
    };
  }

  if (!Array.isArray(parsed.rules)) {
    return {
      path,
      missing: false,
      document: {
        version: 1,
        rules: []
      },
      existingIds: new Set(),
      errors: [`invalid ${rulesRelativePath}: rules must be an array`]
    };
  }

  const existingIds = new Set<string>();
  for (const rule of parsed.rules) {
    if (isRecord(rule) && typeof rule.id === "string" && rule.id.length > 0) {
      existingIds.add(rule.id);
    }
  }

  return {
    path,
    missing: false,
    document: {
      version: 1,
      rules: [...parsed.rules]
    },
    existingIds,
    errors: []
  };
}

function parseBackendJson(stdout: string): unknown {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error("backend returned empty stdout");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error("backend did not return JSON");
  }
}

function proposalArrayFromBackendOutput(stdout: string): unknown[] {
  const parsed = parseBackendJson(stdout);

  if (!isRecord(parsed) || !Array.isArray(parsed.rules)) {
    throw new Error('backend JSON must have shape {"rules":[...]}');
  }

  return parsed.rules;
}

function buildProposalPrompt(input: {
  events: CandidateEvent[];
  existingIds: string[];
  evidenceDigest: string;
}): string {
  return `You are Farrier's self-learning tool-policy proposal generator.

Return JSON only with this exact shape:

{
  "rules": [
    {
      "id": "kebab-case-id",
      "description": "short description",
      "tool": "Bash",
      "commandPattern": "JavaScript-compatible regular expression",
      "flags": "i",
      "message": "short deny message",
      "redirect": "what to do instead"
    }
  ]
}

Rules:
- Emit only declarative ToolPolicyRule data.
- Do not emit hook code, shell code, prose, markdown, or explanations.
- Propose rules only for repeated blocked or failing Bash behavior represented in the candidate events.
- Prefer narrowly-scoped command-prefix patterns.
- Do not reuse existing rule ids.

Evidence digest (the same bounded set is used for validation):
${input.evidenceDigest}

Existing rule ids:
${JSON.stringify(input.existingIds, null, 2)}

Candidate events:
${JSON.stringify(input.events, null, 2)}
`;
}

async function llmRuleProposals(input: {
  targetDir: string;
  events: CandidateEvent[];
  existingIds: Set<string>;
  backend: LearnBackend;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runner: LearnCommandRunner;
}): Promise<unknown[]> {
  const model = input.model ?? (input.backend === "claude" ? "haiku" : "gpt-5.5");
  const evidence = createEvidenceSet({ workflow: "learn", items: input.events });
  const prompt = buildProposalPrompt({
    events: evidence.items,
    existingIds: Array.from(input.existingIds).sort(),
    evidenceDigest: evidence.digest
  });

  const command =
    input.backend === "claude"
      ? {
          cmd: [
            "claude", "-p", "--model", model,
            ...(input.reasoningEffort ? ["--effort", input.reasoningEffort] : []),
            "--permission-mode", "plan"
          ],
          stdin: prompt
        }
      : {
          cmd: [
            // The isolated workspace is a fresh, untrusted, non-git temp dir;
            // codex ≥0.145 refuses it without --skip-git-repo-check.
            "codex", "exec", "--skip-git-repo-check", "-s", "read-only", "--model", model,
            ...(input.reasoningEffort ? ["-c", `model_reasoning_effort=${input.reasoningEffort}`] : []),
            prompt
          ],
          stdin: undefined
        };

  const isolated = await withIsolatedExecution({
    targetDir: input.targetDir,
    nativeConfinement: input.backend === "codex",
    environmentPassthrough: backendEnvironmentPassthrough(input.backend),
    environmentOverrides: backendEnvironmentOverrides(input.backend),
    // Mining rule proposals is a full backend reasoning pass; use the authoring
    // budget rather than the 120s fallback.
    timeoutMs: isolatedAuthoringTimeoutMs,
    readOnlyWorkspace: true,
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
    throw new Error(backendFailureMessage({
      backend: input.backend,
      exitCode: output.exitCode,
      output,
      redactValues
    }));
  }
  if (output.capture?.stdout.truncated) {
    throw new Error(
      `${input.backend} backend stdout exceeded the capture limit (received ${output.capture.stdout.byteCount} bytes; sha256 ${output.capture.stdout.sha256})`
    );
  }

  return proposalArrayFromBackendOutput(output.stdout);
}

function validateProposals(input: {
  proposals: unknown[];
  existingIds: Set<string>;
  candidateCommands: string[];
}): { accepted: ToolPolicyRule[]; dropped: DroppedProposal[] } {
  const accepted: ToolPolicyRule[] = [];
  const dropped: DroppedProposal[] = [];
  const proposedIds = new Set<string>();

  for (const proposal of input.proposals) {
    const result = validateToolPolicyRuleProposal(proposal, {
      existingIds: input.existingIds,
      proposedIds,
      candidateCommands: input.candidateCommands
    });

    if (result.ok) {
      proposedIds.add(result.rule.id);
      accepted.push(result.rule);
    } else {
      dropped.push({
        id: result.id,
        reason: result.reason
      });
    }
  }

  return {
    accepted,
    dropped
  };
}

export async function createLearnReport(options: LearnOptions): Promise<LearnReport> {
  const targetDir = resolve(options.targetDir);
  const manifestPath = join(targetDir, ".farrier.json");
  const transcriptsDir = options.transcriptsDir ? resolve(options.transcriptsDir) : defaultTranscriptDir(targetDir);
  const notes: string[] = [];
  const errors: string[] = [];

  // Mining and proposing need no harness; a repo without .farrier.json is the
  // growth model's entry case, and every proposal is a reason to create one.
  // Only APPLYING hook-dependent artifacts requires the manifest (applyLearn
  // and the proposal-apply path still refuse without it).
  let installedHookIds: NormalizedManifest["hookIds"] = [];
  let installedGuards: unknown;
  let learnEnabled = false;
  try {
    const manifest = await readManifest(targetDir);
    installedHookIds = manifest.hookIds;
    installedGuards = manifest.guards;
    learnEnabled = manifest.learn.enabled;
    if (!manifest.learn.enabled) {
      notes.push("learn.enabled is false in .farrier.json; proceeding because farrier learn was invoked explicitly.");
    }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== notFarrierProjectMessage) {
      throw error;
    }
    notes.push("No .farrier.json here yet: mined sessions only. Applying a proposal installs into the harness, so run farrier create first.");
  }

  const [candidateResult, existingRules, signalScan] = await Promise.all([
    extractCandidateEvents(transcriptsDir),
    readToolPolicyRulesDocument(targetDir),
    mineFailureSignalsFromSources({
      claudeTranscriptsDir: transcriptsDir,
      codexProjectDir: targetDir,
      codexSessionsDir: options.codexSessionsDir
    })
  ]);

  notes.push(...candidateResult.notes);
  errors.push(...existingRules.errors);
  const signals = signalScan.signals;
  let primitiveProposals = routeFailureSignals({
    signals,
    installedHookIds,
    guards: installedGuards
  });
  for (const note of signalScan.notes) {
    if (!notes.includes(note)) notes.push(note);
  }
  const reportEvidenceSet = createEvidenceSet({
    workflow: "learn",
    items: candidateResult.events,
    maxItems: 200,
    maxItemBytes: 8_000,
    maxTotalBytes: 1_600_000
  });
  const candidateEvents = reportEvidenceSet.items;
  const evidenceSet = createEvidenceSet({ workflow: "learn", items: candidateEvents });
  const backendCandidateEvents = evidenceSet.items;
  if (reportEvidenceSet.truncated) {
    notes.push(`Learn report evidence was bounded: retained ${reportEvidenceSet.itemCount}/${reportEvidenceSet.inputItemCount} candidates; ${reportEvidenceSet.truncatedItemCount} truncated and ${reportEvidenceSet.omittedItemCount} omitted.`);
  }
  if (evidenceSet.truncated) {
    notes.push(`Backend evidence was bounded to ${evidenceSet.itemCount}/${evidenceSet.inputItemCount} candidates (${evidenceSet.byteCount} bytes); deterministic analysis and the report retain the larger redacted inventory.`);
  }

  if (candidateEvents.length === 0) {
    notes.push("No transcript candidates found.");
  }

  if (existingRules.errors.length > 0) {
    notes.push("Skipping proposal generation until the existing tool-policy rules file is valid.");
    return {
      targetDir,
      manifestPath,
      learnEnabled,
      transcriptsDir,
      candidateEvents,
      proposedRules: [],
      droppedProposals: [],
      signals,
      primitiveProposals,
      refinedProposalIds: [],
      droppedRefinements: [],
      evidence: compareEvidence({
        beforeSet: evidenceSet,
        afterSet: evidenceSet,
        before: backendCandidateEvents.map((_, index) => ({ id: `candidate-${index}`, outcome: "inconclusive" as const })),
        after: backendCandidateEvents.map((_, index) => ({ id: `candidate-${index}`, outcome: "inconclusive" as const }))
      }),
      notes,
      errors
    };
  }

  let rawProposals: unknown[] = [];

  if (candidateEvents.length > 0) {
    if (options.noLlm) {
      rawProposals = deterministicRuleProposals(candidateEvents);
      notes.push("Using deterministic --no-llm proposal mode.");
    } else {
      const backend = options.backend ?? "claude";

      try {
        rawProposals = await llmRuleProposals({
          targetDir,
          events: backendCandidateEvents,
          existingIds: existingRules.existingIds,
          backend,
          model: options.model,
          reasoningEffort: options.reasoningEffort,
            runner: options.runner ?? defaultBackendRunner
        });
        notes.push(`Used ${backend} backend to propose rule data from an isolated staging workspace.`);
        notes.push(backend === "codex"
          ? "Isolation mode: native-confinement (Codex read-only sandbox)."
          : "Isolation mode: staged-best-effort; Claude has no supported native write-root confinement, so target fingerprints were verified and residual OS-user write risk remains.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rawProposals = deterministicRuleProposals(candidateEvents);
        notes.push(`LLM proposal backend failed (${message}); fell back to deterministic proposals.`);
      }
    }
  }

  let refinedProposalIds: string[] = [];
  let droppedRefinements: DroppedRefinement[] = [];

  if (!options.noLlm && primitiveProposals.length > 0) {
    const backend = options.backend ?? "claude";

    try {
      const refined = await refineProposalText({
        targetDir,
        proposals: primitiveProposals,
        backend,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        runner: options.runner ?? defaultBackendRunner
      });
      primitiveProposals = refined.proposals;
      refinedProposalIds = refined.refinedIds;
      droppedRefinements = refined.dropped;
      notes.push(refinedProposalIds.length > 0
        ? `Used ${backend} backend to refine proposal text for: ${refinedProposalIds.join(", ")}.`
        : `Used ${backend} backend for proposal text refinement; no refinement was accepted.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notes.push(`Proposal text refinement backend failed (${message}); kept deterministic proposal text.`);
    }
  }

  const validation = validateProposals({
    proposals: rawProposals,
    existingIds: existingRules.existingIds,
    candidateCommands: candidateEvents.map((event) => event.command)
  });
  const before = backendCandidateEvents.map((_, index) => ({ id: `candidate-${index}`, outcome: "fail" as const }));
  const after = backendCandidateEvents.map((event, index) => ({
    id: `candidate-${index}`,
    outcome: validation.accepted.some((rule) => ruleMatchesAnyCandidate(rule, [event.command])) ? "pass" as const : "fail" as const
  }));
  const evidence = compareEvidence({ beforeSet: evidenceSet, afterSet: evidenceSet, before, after });

  return {
    targetDir,
    manifestPath,
    learnEnabled,
    transcriptsDir,
    candidateEvents,
    proposedRules: validation.accepted,
    droppedProposals: validation.dropped,
    signals,
    primitiveProposals,
    refinedProposalIds,
    droppedRefinements,
    evidence,
    notes,
    errors
  };
}

export async function applyLearn(options: LearnOptions): Promise<LearnApplyResult> {
  const targetDir = resolve(options.targetDir);
  if (options.yes) {
    // Reporting works without a harness; writing rules into .farrier/hooks/
    // does not — the tool-policy hook that reads them must exist.
    await readManifest(targetDir);
  }
  const reviewedRulesFingerprint = await fingerprintPath(join(targetDir, rulesRelativePath));
  const report = await createLearnReport({
    ...options,
    targetDir
  });

  const existingRules = await readToolPolicyRulesDocument(targetDir);
  const rulesPath = existingRules.path;

  if (!options.yes) {
    return {
      report,
      appendedRules: [],
      skippedExistingIds: [],
      rulesPath
    };
  }

  if (report.errors.length > 0 || existingRules.errors.length > 0) {
    throw new Error(`cannot append learned rules: ${[...report.errors, ...existingRules.errors].join("; ")}`);
  }

  const existingIds = new Set(existingRules.existingIds);
  const appendedRules: ToolPolicyRule[] = [];
  const skippedExistingIds: string[] = [];

  for (const rule of report.proposedRules) {
    if (existingIds.has(rule.id)) {
      skippedExistingIds.push(rule.id);
      continue;
    }

    existingIds.add(rule.id);
    appendedRules.push(rule);
  }

  if (appendedRules.length > 0 || existingRules.missing) {
    const relativeRulesPath = relative(targetDir, rulesPath);
    const content = `${JSON.stringify(
      { version: 1, rules: [...existingRules.document.rules, ...appendedRules] },
      null,
      2
    )}\n`;
    const plan = await inspectMutationPlan(targetDir, [
      { kind: "write-file", path: relativeRulesPath, content }
    ]);
    plan.operations[0]!.expected = reviewedRulesFingerprint;
    await applyMutationPlan(plan);
  }

  return {
    report,
    appendedRules,
    skippedExistingIds,
    rulesPath
  };
}

function renderList(values: string[], empty: string): string[] {
  if (values.length === 0) {
    return [`  ${empty}`];
  }

  return values.map((value) => `  - ${value}`);
}

export function formatLearnReport(report: LearnReport): string {
  const lines: string[] = [
    `Farrier learn report for ${report.targetDir}`,
    "",
    `Manifest: ${report.manifestPath}`,
    `Learn enabled: ${report.learnEnabled ? "yes" : "no"}`,
    `Transcripts: ${report.transcriptsDir}`,
    "",
    "Candidate events:",
    ...renderList(
      report.candidateEvents.map((event) => `${event.command} (${event.count}): ${event.reason}`),
      "none"
    ),
    "",
    "Proposed tool-policy rules:",
    ...renderList(
      report.proposedRules.map((rule) => `${rule.id}: ${rule.description}`),
      "none"
    ),
    "",
    "Dropped proposals:",
    ...renderList(
      report.droppedProposals.map((proposal) =>
        proposal.id ? `${proposal.id}: ${proposal.reason}` : proposal.reason
      ),
      "none"
    ),
    "",
    "Failure signals (deterministic, with evidence):",
    ...renderList(
      report.signals.map((signal) =>
        `[${signal.class}] ${signal.key}: ${signal.count}x across ${signal.sessionCount} session(s)${signal.dates.length > 0 ? ` (${signal.dates.join(", ")})` : ""}`
      ),
      "none"
    ),
    "",
    "Primitive proposals (review in the TUI; nothing is applied automatically):",
    ...renderList(
      report.primitiveProposals.map((proposal) => {
        const refined = report.refinedProposalIds.includes(proposal.id);
        const head = `[${proposal.kind}] ${proposal.id}: ${proposal.title}${refined ? " (text refined)" : ""}`;
        return refined ? `${head}\n    ${proposal.message}` : head;
      }),
      "none"
    )
  ];

  if (report.droppedRefinements.length > 0) {
    lines.push(
      "",
      "Dropped text refinements (deterministic text kept):",
      ...renderList(
        report.droppedRefinements.map((refinement) =>
          refinement.id ? `${refinement.id}: ${refinement.reason}` : refinement.reason
        ),
        "none"
      )
    );
  }

  if (report.evidence) {
    lines.push("", `Behavior evidence: ${report.evidence.result} (digest ${report.evidence.inputDigest}; before ${report.evidence.before.passed} pass/${report.evidence.before.failed} fail, after ${report.evidence.after.passed} pass/${report.evidence.after.failed} fail).`);
  }

  if (report.errors.length > 0) {
    lines.push("", "Errors:", ...renderList(report.errors, "none"));
  }

  if (report.notes.length > 0) {
    lines.push("", "Notes:", ...renderList(report.notes, "none"));
  }

  lines.push("", "No files were changed. Re-run with --yes to append proposed new rules.");

  return `${lines.join("\n")}\n`;
}

export function formatLearnApplyResult(result: LearnApplyResult): string {
  const lines = [
    formatLearnReport(result.report).trimEnd(),
    "",
    "Applied learned rules:",
    ...renderList(result.appendedRules.map((rule) => rule.id), "none"),
    "",
    "Skipped existing rule ids:",
    ...renderList(result.skippedExistingIds, "none"),
    "",
    `Rules file: ${result.rulesPath}`
  ];

  return `${lines.join("\n")}\n`;
}

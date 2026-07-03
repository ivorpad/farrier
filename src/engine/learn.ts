import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readManifest } from "./update";
import type { ToolPolicyRule } from "../packs/types";

export type CandidateEvent = {
  command: string;
  reason: string;
  count: number;
};

export type LearnBackend = "claude" | "codex";

export type LearnCommandRunnerInput = {
  cmd: string[];
  cwd: string;
  stdin?: string;
};

export type LearnCommandRunnerOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type LearnCommandRunner = (input: LearnCommandRunnerInput) => Promise<LearnCommandRunnerOutput>;

export type DroppedProposal = {
  id?: string;
  reason: string;
};

export type LearnOptions = {
  targetDir: string;
  transcriptsDir?: string;
  yes?: boolean;
  json?: boolean;
  noLlm?: boolean;
  backend?: LearnBackend;
  model?: string;
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

type ToolUse = {
  id?: string;
  command: string;
};

type ToolResult = {
  toolUseId?: string;
  text: string;
  isError: boolean;
  isDenied: boolean;
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
const rulesRelativePath = ".claude/hooks/tool-policy-rules.json";
const kebabCasePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const allowedRegexFlagsPattern = /^[ims]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
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

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStrings(item));
  }

  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => flattenStrings(item));
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  return [];
}

function textFrom(value: unknown): string {
  return flattenStrings(value).join("\n");
}

function booleanField(record: Record<string, unknown>, names: string[]): boolean {
  return names.some((name) => record[name] === true);
}

function lowerText(value: string): string {
  return value.toLowerCase();
}

function looksDenied(text: string): boolean {
  const lower = lowerText(text);

  return (
    (lower.includes("permissiondecision") && lower.includes("deny")) ||
    lower.includes("permission decision") && lower.includes("deny") ||
    lower.includes("permission denied") ||
    lower.includes("denied") ||
    lower.includes("blocked by hook") ||
    lower.includes("hook blocked") ||
    lower.includes("blocked")
  );
}

function looksErrored(text: string): boolean {
  const lower = lowerText(text);

  return (
    lower.includes("exit code") ||
    lower.includes("exited with code") ||
    lower.includes("not found") ||
    lower.includes("permission denied") ||
    lower.includes("failed") ||
    lower.includes("traceback") ||
    lower.includes("error")
  );
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

function toolUseFromRecord(record: Record<string, unknown>): ToolUse[] {
  const uses: ToolUse[] = [];

  function addUse(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }

    const name = optionalString(value.name) ?? optionalString(value.tool_name);
    const input = isRecord(value.input) ? value.input : isRecord(value.tool_input) ? value.tool_input : undefined;
    const command = input ? optionalString(input.command) : undefined;

    if (name === "Bash" && command) {
      uses.push({
        id: optionalString(value.id),
        command: normalizeCommand(command)
      });
    }
  }

  addUse(record);

  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];

  for (const item of content) {
    if (isRecord(item) && item.type === "tool_use") {
      addUse(item);
    }
  }

  return dedupeToolUses(uses);
}

function dedupeToolUses(uses: ToolUse[]): ToolUse[] {
  const seen = new Set<string>();
  const deduped: ToolUse[] = [];

  for (const use of uses) {
    const key = `${use.id ?? ""}\u0000${use.command}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(use);
  }

  return deduped;
}

function toolResultsFromRecord(record: Record<string, unknown>): ToolResult[] {
  const results: ToolResult[] = [];

  function addResult(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }

    const text = textFrom(value);
    const isDenied = looksDenied(text);
    const isError = booleanField(value, ["is_error", "isError", "error"]) || looksErrored(text);

    if (!isDenied && !isError) {
      return;
    }

    results.push({
      toolUseId: optionalString(value.tool_use_id) ?? optionalString(value.toolUseId),
      text,
      isError,
      isDenied
    });
  }

  if (record.type === "tool_result") {
    addResult(record);
  }

  const message = isRecord(record.message) ? record.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : Array.isArray(record.content) ? record.content : [];

  for (const item of content) {
    if (isRecord(item) && item.type === "tool_result") {
      addResult(item);
    }
  }

  for (const key of ["tool_response", "tool_result", "result", "response"]) {
    addResult(record[key]);
  }

  const fullText = textFrom(record);
  if (looksDenied(fullText) || looksErrored(fullText)) {
    results.push({
      toolUseId: optionalString(record.tool_use_id) ?? optionalString(record.toolUseId),
      text: fullText,
      isError: looksErrored(fullText),
      isDenied: looksDenied(fullText)
    });
  }

  return results;
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
  const slugged = absoluteTargetDir.replaceAll("\\", "/").replaceAll("/", "-");

  return join(process.env.HOME || homedir(), ".claude", "projects", slugged);
}

export async function extractCandidateEvents(
  transcriptsDir: string,
  options: { maxEvents?: number } = {}
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

  const files = entries.filter((entry) => entry.endsWith(".jsonl")).sort();

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

Existing rule ids:
${JSON.stringify(input.existingIds, null, 2)}

Candidate events:
${JSON.stringify(input.events, null, 2)}
`;
}

async function defaultRunner(input: LearnCommandRunnerInput): Promise<LearnCommandRunnerOutput> {
  const proc = Bun.spawn({
    cmd: input.cmd,
    cwd: input.cwd,
    stdin: input.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });

  if (input.stdin !== undefined) {
    const stdin = proc.stdin as unknown as { write(data: string): unknown; end(): unknown } | undefined;
    stdin?.write(input.stdin);
    stdin?.end();
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("")
  ]);

  return {
    exitCode,
    stdout,
    stderr
  };
}

async function llmRuleProposals(input: {
  targetDir: string;
  events: CandidateEvent[];
  existingIds: Set<string>;
  backend: LearnBackend;
  model?: string;
  runner: LearnCommandRunner;
}): Promise<unknown[]> {
  const model = input.model ?? (input.backend === "claude" ? "haiku" : "gpt-5.5");
  const prompt = buildProposalPrompt({
    events: input.events,
    existingIds: Array.from(input.existingIds).sort()
  });

  const command =
    input.backend === "claude"
      ? {
          cmd: ["claude", "-p", "--model", model],
          stdin: prompt
        }
      : {
          cmd: ["codex", "exec", "--model", model, prompt],
          stdin: undefined
        };

  const output = await input.runner({
    cmd: command.cmd,
    cwd: input.targetDir,
    stdin: command.stdin
  });

  if (output.exitCode !== 0) {
    const stderr = output.stderr.trim();
    throw new Error(
      `${input.backend} backend exited with code ${output.exitCode}${stderr ? `: ${stderr}` : ""}`
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
  const manifest = await readManifest(targetDir);
  const manifestPath = join(targetDir, ".farrier.json");
  const transcriptsDir = options.transcriptsDir ? resolve(options.transcriptsDir) : defaultTranscriptDir(targetDir);
  const notes: string[] = [];
  const errors: string[] = [];

  if (!manifest.learn.enabled) {
    notes.push("learn.enabled is false in .farrier.json; proceeding because farrier learn was invoked explicitly.");
  }

  const [candidateResult, existingRules] = await Promise.all([
    extractCandidateEvents(transcriptsDir),
    readToolPolicyRulesDocument(targetDir)
  ]);

  notes.push(...candidateResult.notes);
  errors.push(...existingRules.errors);

  if (candidateResult.events.length === 0) {
    notes.push("No transcript candidates found.");
  }

  if (existingRules.errors.length > 0) {
    notes.push("Skipping proposal generation until the existing tool-policy rules file is valid.");
    return {
      targetDir,
      manifestPath,
      learnEnabled: manifest.learn.enabled,
      transcriptsDir,
      candidateEvents: candidateResult.events,
      proposedRules: [],
      droppedProposals: [],
      notes,
      errors
    };
  }

  let rawProposals: unknown[] = [];

  if (candidateResult.events.length > 0) {
    if (options.noLlm) {
      rawProposals = deterministicRuleProposals(candidateResult.events);
      notes.push("Using deterministic --no-llm proposal mode.");
    } else {
      const backend = options.backend ?? "claude";

      try {
        rawProposals = await llmRuleProposals({
          targetDir,
          events: candidateResult.events,
          existingIds: existingRules.existingIds,
          backend,
          model: options.model,
          runner: options.runner ?? defaultRunner
        });
        notes.push(`Used ${backend} backend to propose rule data.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rawProposals = deterministicRuleProposals(candidateResult.events);
        notes.push(`LLM proposal backend failed (${message}); fell back to deterministic proposals.`);
      }
    }
  }

  const validation = validateProposals({
    proposals: rawProposals,
    existingIds: existingRules.existingIds,
    candidateCommands: candidateResult.events.map((event) => event.command)
  });

  return {
    targetDir,
    manifestPath,
    learnEnabled: manifest.learn.enabled,
    transcriptsDir,
    candidateEvents: candidateResult.events,
    proposedRules: validation.accepted,
    droppedProposals: validation.dropped,
    notes,
    errors
  };
}

export async function applyLearn(options: LearnOptions): Promise<LearnApplyResult> {
  const targetDir = resolve(options.targetDir);
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
    await mkdir(dirname(rulesPath), { recursive: true });
    await writeFile(
      rulesPath,
      `${JSON.stringify(
        {
          version: 1,
          rules: [...existingRules.document.rules, ...appendedRules]
        },
        null,
        2
      )}\n`,
      "utf8"
    );
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
    )
  ];

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

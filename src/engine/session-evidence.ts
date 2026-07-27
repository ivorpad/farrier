import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { boundSessionText, stripSessionAmbient } from "./advice-patterns";
import { projectSkillRoots } from "./skill-paths";
import { defaultTranscriptDir } from "./learn";
import { SignalCollector, scanClaudeTranscripts, type FailureSignal, type SkillInvocationEvent } from "./learn-signals";
import { codexScanCapNote, scanCodexSessions } from "./learn-signals-codex";
import { scopeDir, steerContextSummary, type SessionActivityEvent } from "./session-activity";

/**
 * Session evidence preparation: local, complete, no vetoes.
 *
 * Deterministic mining alone cannot produce a playbook — on the WalkLedger
 * fixture (45 sessions) the threshold-gated miner finds zero repeated
 * failures while every lesson that mattered lives in user steers and the
 * crystallized final docs. So this layer only prepares: it extracts steers
 * (user messages minus known machine noise), clusters every failure
 * including the verification/build failures learn's proposal thresholds
 * exclude, and hands counts, quotes, and clusters to a review surface. It
 * classifies nothing, and nothing here leaves the machine; the LLM layer
 * that judges this evidence is consented and review-gated separately.
 */

export type SteerSignal = {
  /** Redacted, ambient-stripped, bounded steer text. */
  text: string;
  sessionRef: string;
  date?: string;
  truncated: boolean;
  /**
   * Redacted, bounded (≤ 160 chars) one-line summary of the assistant action
   * this steer immediately followed — what provoked the correction. Absent
   * when no action preceded the steer.
   */
  context?: string;
};

/**
 * Deterministic per-session activity counts. A session with real edits and
 * commands but zero steers is the compliance evidence the over-constraint
 * softening arrow requires before a rule may be relaxed.
 */
export type SessionActivity = {
  /** The session's backend-prefixed ref (e.g. "codex:rollout-…", "claude:stem"). */
  ref: string;
  steerCount: number;
  editCount: number;
  commandCount: number;
  /** Up to 3 most-touched directories, most-frequent first. */
  topDirs: string[];
};

/**
 * One skill's observed use across the scanned sessions, diffed against the
 * on-disk install. Zero-invoked installed skills and skill dirs without a
 * SKILL.md are the evidence rows pruning and scoping proposals feed on.
 */
export type SkillUsage = {
  name: string;
  /** Invocation events across all scanned sessions (both backends). */
  invocations: number;
  /** Distinct sessions that invoked it. */
  sessions: number;
  /** Present under skills/, .agents/skills, or .claude/skills. */
  installed: boolean;
  /** Installed but no root provides a SKILL.md (empty or broken dir). */
  missingSkillMd: boolean;
};

export type SessionEvidence = {
  projectDir: string;
  steers: SteerSignal[];
  /** Full clustered failure record: work-loop failures included, no thresholds. */
  failureClusters: FailureSignal[];
  /** Installed ∪ invoked skills, most-invoked first. */
  skillUsage: SkillUsage[];
  /** Per-session activity counts (busiest first, capped). Absent from older fixtures. */
  sessionActivity?: SessionActivity[];
  codexSessionsMatched: number;
  codexSessionsScanned: number;
  notes: string[];
};

/**
 * The user-selected sessions, expressed in each backend's own file identity:
 * Claude transcript stems (file name without .jsonl) and Codex thread ids
 * (rollout file names embed the thread uuid). An empty set means "none of
 * this backend's sessions"; an absent field means "all of them".
 */
export type SessionSelection = {
  claudeStems?: ReadonlySet<string>;
  codexThreadIds?: ReadonlySet<string>;
};

export type SessionEvidenceOptions = {
  projectDir: string;
  /** Override for tests; defaults to ~/.codex/sessions. */
  codexSessionsDir?: string;
  /** Claude JSONL transcripts for failure clusters; defaults to ~/.claude/projects/<slug>. */
  claudeTranscriptsDir?: string;
  maxFiles?: number;
  /** Restrict mining to the user-selected sessions. Absent = every session. */
  selection?: SessionSelection;
};

const maxSteerBytes = 1_500;
const maxSteers = 500;
const maxSessionActivity = 30;

/**
 * Machine-generated user_message shapes observed in Codex Desktop 0.145
 * rollouts and Claude Code JSONL transcripts (validated on the WalkLedger
 * sessions, 2026-07-23/24). These are noise filters, not judgment: each
 * matches a producer that is not the human steering the agent.
 */
const judgeDumpPattern = /^\s*The following is the Codex agent history/i;
const attachmentDumpPattern = /^\s*#\s*Files mentioned by the user:/i;
const agentsDumpPattern = /^\s*#\s*AGENTS\.md instructions/i;
const internalAdvisorMarker = "farrier's read-only project advisor";
const commandWrapperPattern = /<command-(?:name|message|args)(?:\s[^>]*)?>[\s\S]*?<\/command-(?:name|message|args)>/gi;
const localCommandOutputPattern = /<local-command-(?:stdout|stderr)(?:\s[^>]*)?>[\s\S]*?<\/local-command-(?:stdout|stderr)>/gi;
const interruptedRequestPattern = /^\s*\[Request interrupted by user[^\]]*\]/i;
const localCommandCaveatPattern = /^\s*Caveat: The messages below were generated by the user while running local commands\./i;

/**
 * Turns one raw user_message into a steer, or undefined when the message is
 * machine noise (stop/approval-judge history dumps, attachment manifests,
 * AGENTS.md dumps, farrier's own advisor sessions, or pure ambient context).
 * The surviving text is redacted and bounded by boundSessionText.
 */
export function steerFromUserMessage(raw: string): { text: string; truncated: boolean } | undefined {
  if (judgeDumpPattern.test(raw) || attachmentDumpPattern.test(raw) || agentsDumpPattern.test(raw)) {
    return undefined;
  }
  if (interruptedRequestPattern.test(raw) || localCommandCaveatPattern.test(raw)) {
    return undefined;
  }
  if (raw.toLowerCase().includes(internalAdvisorMarker)) {
    return undefined;
  }
  const stripped = stripSessionAmbient(raw.replace(commandWrapperPattern, " ").replace(localCommandOutputPattern, " "));
  const bounded = boundSessionText(stripped, maxSteerBytes);
  if (bounded.text.length < 2) {
    return undefined;
  }
  return bounded;
}

/**
 * Skill directories on disk across the three roots, deduplicated by name.
 * missingSkillMd stays true only when NO root provides a SKILL.md;
 * skillMdPath is the first root's readable SKILL.md (for descriptions).
 */
export async function installedSkillDirs(
  projectDir: string
): Promise<Map<string, { missingSkillMd: boolean; skillMdPath?: string }>> {
  const installed = new Map<string, { missingSkillMd: boolean; skillMdPath?: string }>();
  for (const root of projectSkillRoots) {
    const dir = join(projectDir, root);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      // Skill installs are often symlinks (the skills package links shared
      // trees); stat follows them where entry.isDirectory() would not.
      const isDirectory = await stat(join(dir, entry.name))
        .then((stats) => stats.isDirectory())
        .catch(() => false);
      if (!isDirectory) continue;
      const skillMdPath = join(dir, entry.name, "SKILL.md");
      const hasSkillMd = await stat(skillMdPath)
        .then((stats) => stats.isFile())
        .catch(() => false);
      const existing = installed.get(entry.name);
      installed.set(entry.name, {
        missingSkillMd: (existing?.missingSkillMd ?? true) && !hasSkillMd,
        ...(existing?.skillMdPath ? { skillMdPath: existing.skillMdPath } : hasSkillMd ? { skillMdPath } : {})
      });
    }
  }
  return installed;
}

export async function prepareSessionEvidence(options: SessionEvidenceOptions): Promise<SessionEvidence> {
  const projectDir = resolve(options.projectDir);
  const collector = new SignalCollector({ keepAllFailures: true });
  const steers: SteerSignal[] = [];
  let omittedSteers = 0;

  // Per-session activity, keyed by backend-prefixed ref. Directory counts feed
  // topDirs. A session appears here if it has any steer or classified action.
  const activityByRef = new Map<
    string,
    { steerCount: number; editCount: number; commandCount: number; dirs: Map<string, number> }
  >();
  const activityFor = (ref: string) => {
    let entry = activityByRef.get(ref);
    if (!entry) {
      entry = { steerCount: 0, editCount: 0, commandCount: 0, dirs: new Map() };
      activityByRef.set(ref, entry);
    }
    return entry;
  };

  const collectSteer = (event: { text: string; sessionRef: string; date: string | undefined; context?: string }): void => {
    const steer = steerFromUserMessage(event.text);
    if (!steer) return;
    // Count the real steer against its session even when the list is capped.
    activityFor(event.sessionRef).steerCount += 1;
    if (steers.length >= maxSteers) {
      omittedSteers += 1;
      return;
    }
    const context = event.context ? steerContextSummary(event.context) : undefined;
    steers.push({
      ...steer,
      sessionRef: event.sessionRef,
      ...(event.date ? { date: event.date } : {}),
      ...(context ? { context } : {})
    });
  };

  const collectActivity = (event: SessionActivityEvent): void => {
    const entry = activityFor(event.sessionRef);
    if (event.kind === "edit") entry.editCount += 1;
    else entry.commandCount += 1;
    // Scope directories to the project before they can reach the prompt: a
    // path outside projectDir (another client's tree) must never be sent.
    for (const dir of event.dirs) {
      const scoped = scopeDir(dir, projectDir);
      if (scoped) entry.dirs.set(scoped, (entry.dirs.get(scoped) ?? 0) + 1);
    }
  };

  const invoked = new Map<string, { invocations: number; sessions: Set<string> }>();
  const collectSkill = (event: SkillInvocationEvent): void => {
    const entry = invoked.get(event.skill) ?? { invocations: 0, sessions: new Set<string>() };
    entry.invocations += 1;
    entry.sessions.add(event.sessionRef);
    invoked.set(event.skill, entry);
  };

  const codex = await scanCodexSessions({
    projectDir,
    sessionsDir: options.codexSessionsDir,
    maxFiles: options.maxFiles,
    collector,
    onUserMessage: collectSteer,
    onSkillInvocation: collectSkill,
    onActivity: collectActivity,
    ...(options.selection?.codexThreadIds ? { includeThreadIds: options.selection.codexThreadIds } : {})
  });

  const claude = await scanClaudeTranscripts(
    options.claudeTranscriptsDir ?? defaultTranscriptDir(projectDir),
    collector,
    {
      // The Claude scanner's sessionRefs are bare transcript stems; prefix the
      // source so mixed-backend evidence stays attributable.
      onUserMessage: ({ text, sessionRef, date, context }) =>
        collectSteer({ text, sessionRef: `claude:${sessionRef}`, date, ...(context ? { context } : {}) }),
      onSkillInvocation: ({ skill, sessionRef, date }) => collectSkill({ skill, sessionRef: `claude:${sessionRef}`, date }),
      onActivity: ({ sessionRef, kind, dirs }) => collectActivity({ sessionRef: `claude:${sessionRef}`, kind, dirs }),
      ...(options.selection?.claudeStems ? { includeStems: options.selection.claudeStems } : {}),
      ...(options.maxFiles !== undefined ? { maxFiles: options.maxFiles } : {})
    }
  );

  const installed = await installedSkillDirs(projectDir);
  const skillUsage: SkillUsage[] = Array.from(new Set([...installed.keys(), ...invoked.keys()]))
    .map((name) => ({
      name,
      invocations: invoked.get(name)?.invocations ?? 0,
      sessions: invoked.get(name)?.sessions.size ?? 0,
      installed: installed.has(name),
      missingSkillMd: installed.get(name)?.missingSkillMd ?? false
    }))
    .sort((left, right) => right.invocations - left.invocations || left.name.localeCompare(right.name));

  const notes = [...codex.notes, ...claude.notes];
  const installedNames = skillUsage.filter((usage) => usage.installed);
  if (installedNames.length > 0 || invoked.size > 0) {
    const neverInvoked = installedNames.filter((usage) => usage.invocations === 0).length;
    const broken = installedNames.filter((usage) => usage.missingSkillMd).length;
    notes.push(
      `Skill usage: ${installedNames.length} installed, ` +
        `${installedNames.length - neverInvoked} invoked in the scanned sessions, ${neverInvoked} never invoked` +
        `${broken > 0 ? `, ${broken} without a SKILL.md` : ""}.`
    );
  }
  if (omittedSteers > 0) {
    notes.push(`Steer extraction kept the newest ${maxSteers} steer(s); ${omittedSteers} older one(s) were omitted.`);
  }

  // Busiest sessions first, capped; a session with real activity and zero
  // steers is the compliance evidence a softening proposal must point to.
  const sessionActivity = Array.from(activityByRef.entries())
    .map(([ref, entry]) => ({
      ref,
      steerCount: entry.steerCount,
      editCount: entry.editCount,
      commandCount: entry.commandCount,
      topDirs: Array.from(entry.dirs.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 3)
        .map(([dir]) => dir)
    }))
    .sort(
      (left, right) =>
        right.steerCount + right.editCount + right.commandCount - (left.steerCount + left.editCount + left.commandCount) ||
        left.ref.localeCompare(right.ref)
    );
  if (sessionActivity.length > maxSessionActivity) {
    notes.push(`Session activity table kept the ${maxSessionActivity} busiest of ${sessionActivity.length} session(s).`);
  }
  if (options.selection) {
    const selected = (options.selection.claudeStems?.size ?? 0) + (options.selection.codexThreadIds?.size ?? 0);
    notes.push(`Mining was restricted to the ${selected} selected session(s).`);
  }
  notes.push(
    `Session evidence: ${steers.length} steer(s) from ${codex.filesMatched} codex session(s) ` +
      `(of ${codex.filesScanned} scanned) and ${claude.filesScanned} Claude transcript file(s). ` +
      "Every failure cluster is kept (verification and build failures included) with no thresholds. Nothing left this machine."
  );

  // Keep exactly one codex cap note and move it to the end: the scanner
  // already emitted it into codex.notes, but the TUI shows only the final
  // notes, so the honest disclosure must be last (and not duplicated).
  const finalNotes = codex.truncated
    ? [...notes.filter((note) => note !== codexScanCapNote(codex.filesScanned)), codexScanCapNote(codex.filesScanned)]
    : notes;

  return {
    projectDir,
    steers,
    failureClusters: collector.signals(),
    skillUsage,
    sessionActivity: sessionActivity.slice(0, maxSessionActivity),
    codexSessionsMatched: codex.filesMatched,
    codexSessionsScanned: codex.filesScanned,
    notes: finalNotes
  };
}

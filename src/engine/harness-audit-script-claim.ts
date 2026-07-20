const verificationStages = [
  { claim: /\bsecrets?\b|secret validation/i, command: /\bsecrets?\b/i },
  { claim: /\btests?\b|test suite/i, command: /\b(?:test|vitest|jest|pytest|mocha)\b/i },
  { claim: /\btypechecks?\b|\btype checks?\b/i, command: /\b(?:typecheck|tsc|mypy|pyright)\b/i },
  { claim: /\blints?\b/i, command: /\b(?:lint|eslint|oxlint|ruff)\b/i },
  { claim: /\bformats?\b/i, command: /\b(?:format|prettier|black)\b/i },
  { claim: /\bbuilds?\b/i, command: /\bbuild\b/i },
];

function packageScriptTarget(claim: string, result: string): [string, string] | undefined {
  const definitions = new Map<string, string>();
  for (const entry of result.split(/; (?=[A-Za-z0-9][A-Za-z0-9:_-]*=)/)) {
    const separator = entry.indexOf("=");
    if (separator > 0) definitions.set(entry.slice(0, separator), entry.slice(separator + 1));
  }
  const mentioned = [...definitions].filter(([name]) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, "i").test(claim);
  });
  const subject = "(?:script|gate|target|task|body)";
  const subjectMatch = (name: string, nearby: boolean) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const token = `(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`;
    const gap = nearby ? "[^.]{0,24}" : "\\s*";
    return new RegExp(`(?:${token}${gap}${subject}|${subject}${gap}${token})`, "i").test(claim);
  };
  return mentioned.find(([name]) => subjectMatch(name, false))
    ?? mentioned.find(([name]) => subjectMatch(name, true))
    ?? mentioned[0];
}

function stageClaimedOmitted(claim: string, stage: RegExp): boolean {
  const token = `(?:${stage.source})`;
  const before = "(?:omit(?:s|ted)?|skip(?:s|ped)?|exclude(?:s|d)?|without|lacks?|missing|bypass(?:es|ed)?|does not (?:run|invoke|include)|never (?:runs?|invokes?|includes?))";
  const after = "(?:omitted|skipped|excluded|missing|absent|outside|bypassed|not (?:run|invoked|included)|free)";
  return new RegExp(`\\b${before}\\b[^.]{0,80}${token}`, "i").test(claim)
    || new RegExp(`${token}[^.]{0,80}\\b${after}\\b`, "i").test(claim);
}

export function verificationStageOmissionClaim(claim: string): boolean {
  return verificationStages.some((stage) => stageClaimedOmitted(claim, stage.claim));
}

export function testExecutionProhibitionClaim(claim: string): boolean {
  const tests = verificationStages[1]!.claim;
  return stageClaimedOmitted(claim, tests)
    || /\b(?:do not|don't|must not|cannot|can't)\s+(?:run|invoke|execute)\b[^.]{0,80}\btests?\b/i.test(claim)
    || /\b(?:forbid(?:s|den)?|prohibit(?:s|ed)?|disallow(?:s|ed)?)\b[^.]{0,80}\btests?\b|\btests?\b[^.]{0,80}\b(?:forbidden|prohibited|disallowed)\b/i.test(claim);
}

export function packageScriptOmissionSupported(claim: string, result: string): boolean {
  const target = packageScriptTarget(claim, result);
  const omitted = verificationStages.filter((stage) => stageClaimedOmitted(claim, stage.claim));
  return Boolean(target && omitted.length
    && omitted.every((stage) => !stage.command.test(target[1])));
}

export function packageScriptRunsTests(claim: string, result: string): boolean {
  const target = packageScriptTarget(claim, result);
  return Boolean(target && verificationStages[1]!.command.test(target[1]));
}

export function packageScriptOmissionCitationSupported(
  claim: string,
  result: string,
  lines: { text: string }[],
): boolean {
  const target = packageScriptTarget(claim, result);
  if (!target) return false;
  const citedText = lines.map((line) => line.text).join("\n");
  return citedText.includes(JSON.stringify(target[0]))
    && citedText.includes(JSON.stringify(target[1]));
}

export function packageScriptOmissionClaim(claim: string): boolean {
  return /\b(?:omit|omits|omitted|skip|skips|exclude|excludes|missing from|without|lacks?|bypass|bypasses|bypassed)\b/i.test(claim)
    || /\b(?:does not|doesn't|never)\s+(?:run|invoke|include)\b/i.test(claim)
    || /\bleaves?\b[^.]{0,80}\boutside\b/i.test(claim)
    || /\b(?:tests?|typechecks?|lints?|formats?|builds?|secrets?)[- ](?:only|free)\b/i.test(claim);
}

const managerName = "(?:npm|bun|pnpm|yarn)";
const exactVersion = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const managerSubject = "(?:packageManager|package manager (?:field|declaration))";
const pinningState = "(?:unpinned|not pinned|does not pin|floating|latest|no exact version)";
const packageManagerPinning = new RegExp(
  `\\b${managerSubject}\\b[^.]{0,100}\\b${pinningState}\\b|\\b${pinningState}\\b[^.]{0,100}\\b${managerSubject}\\b`,
  "i",
);

export function packageManagerVersionIsExact(result: string): boolean {
  const version = result.match(/^(?:npm|bun|pnpm|yarn)@(.+)$/)?.[1];
  return Boolean(version && exactVersion.test(version));
}

export function packageManagerCitationSupported(result: string, lines: { text: string }[]): boolean {
  if (result === "not declared") return false;
  const citedText = lines.map((line) => line.text).join("\n");
  return /"packageManager"\s*:/.test(citedText)
    && citedText.includes(JSON.stringify(result));
}

export function packageManagerArtifactSupported(input: {
  claim: string;
  artifact: string;
  declarationPath: string;
}): boolean {
  return !packageManagerPinning.test(input.claim) || input.artifact === input.declarationPath;
}

function explicitManagerIdentity(claim: string): string | undefined {
  const normalizedClaim = claim.replace(/`packageManager`/gi, "packageManager");
  const patterns = [
    new RegExp(`\\bpackageManager(?:\\s+(?:field|declaration))?\\s+(?:declares|selects|uses|pins|points to|is(?: set to)?)\\s+(${managerName})\\b`, "i"),
    new RegExp(`\\b(?:declared|selected|configured)\\s+package manager\\s+(?:is|as|uses)\\s+(${managerName})\\b`, "i"),
    new RegExp(`\\bpackage manager\\s+(?:field|declaration)\\s+(?:is(?: set to)?|selects|uses)\\s+(${managerName})\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = normalizedClaim.match(pattern);
    if (match) return match[1]!.toLowerCase();
  }
  return undefined;
}

export function packageManagerPolicySupported(claim: string, result: string): boolean {
  if (/\b(?:missing|absent|undeclared|not declared|does not declare|no packageManager)\b/i.test(claim)) {
    return result === "not declared";
  }
  if (/\b(?:unpinned|not pinned|does not pin|floating|no exact version)\b/i.test(claim)) {
    if (result === "not declared") return true;
    const version = result.match(/^(?:npm|bun|pnpm|yarn)@(.+)$/)?.[1];
    if (!version) return true;
    return !packageManagerVersionIsExact(result);
  }
  const expectedManager = explicitManagerIdentity(claim);
  if (!expectedManager) return true;
  return result.match(/^(npm|bun|pnpm|yarn)(?:@|$)/i)?.[1]?.toLowerCase() === expectedManager;
}

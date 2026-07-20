type BlindedAliases = Record<string, Record<string, { targetDir: string }>>;

export function harnessAuditAliasCopyProblems(aliasesByReviewer: BlindedAliases): string[] {
  const owners = new Map<string, string>();
  const problems: string[] = [];
  for (const [reviewerId, aliases] of Object.entries(aliasesByReviewer ?? {})) {
    for (const [alias, item] of Object.entries(aliases)) {
      if (!item.targetDir?.trim()) continue;
      const owner = `${reviewerId}:${alias}`;
      const previous = owners.get(item.targetDir);
      if (previous) {
        problems.push(`Blinded repository target ${item.targetDir} is shared by ${previous} and ${owner}.`);
      } else {
        owners.set(item.targetDir, owner);
      }
    }
  }
  return problems;
}

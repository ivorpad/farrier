export function coordinatorFixtureResponse(prompt: string): string | undefined {
  if (!prompt.includes("advice coordinator")) return undefined;
  const rawCandidates = prompt.match(/Candidate set:\n([^\n]+)\n\nCited evidence summaries:/)?.[1];
  const candidates = rawCandidates ? JSON.parse(rawCandidates) as Array<{ id: string; category: string }> : [];
  const categoryCounts = new Map<string, number>();
  const selectedIds: string[] = [];
  const omissions: Array<{ id: string; kind: "limit"; reason: string }> = [];
  for (const candidate of candidates) {
    const count = categoryCounts.get(candidate.category) ?? 0;
    if (count < 2) {
      selectedIds.push(candidate.id);
      categoryCounts.set(candidate.category, count + 1);
    } else omissions.push({
      id: candidate.id,
      kind: "limit",
      reason: "A stronger candidate already fills this category's report limit.",
    });
  }
  return JSON.stringify({ selectedIds, omissions });
}

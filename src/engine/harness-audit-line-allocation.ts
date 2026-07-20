export type HarnessAuditLineAllocationInput = {
  path: string;
  indexes: number[];
  priority: boolean;
};

function grantEvenly(
  inputs: HarnessAuditLineAllocationInput[],
  quotas: Map<string, number>,
  requested: number,
): number {
  let remaining = requested;
  let active = inputs.filter((input) => (quotas.get(input.path) ?? 0) < input.indexes.length);
  while (remaining > 0 && active.length) {
    const share = Math.max(1, Math.floor(remaining / active.length));
    for (const input of active) {
      if (remaining === 0) break;
      const current = quotas.get(input.path) ?? 0;
      const granted = Math.min(share, input.indexes.length - current, remaining);
      quotas.set(input.path, current + granted);
      remaining -= granted;
    }
    active = active.filter((input) => (quotas.get(input.path) ?? 0) < input.indexes.length);
  }
  return requested - remaining;
}

export function spreadHarnessAuditLineIndexes(indexes: number[], count: number): number[] {
  if (count >= indexes.length) return indexes;
  if (count <= 0) return [];
  const prefixCount = Math.min(16, Math.max(1, Math.floor(count / 2)));
  const suffixCount = Math.min(16, count - prefixCount);
  const middleCount = count - prefixCount - suffixCount;
  const selected = [
    ...indexes.slice(0, prefixCount),
    ...indexes.slice(indexes.length - suffixCount),
  ];
  if (middleCount > 0) {
    const start = prefixCount;
    const end = indexes.length - suffixCount - 1;
    for (let index = 0; index < middleCount; index += 1) {
      const offset = Math.floor((index + 1) * (end - start + 1) / (middleCount + 1));
      selected.push(indexes[Math.min(end, start + offset)]!);
    }
  }
  return selected.sort((left, right) => left - right);
}

export function allocateHarnessAuditLineIndexes(
  inputs: HarnessAuditLineAllocationInput[],
  maxLines: number,
): Map<string, number[]> {
  const priority = inputs.filter((input) => input.priority && input.indexes.length);
  const remaining = inputs.filter((input) => !input.priority && input.indexes.length);
  const quotas = new Map(inputs.map((input) => [input.path, 0]));
  const reservedRemaining = remaining.length ? Math.floor(maxLines / 3) : 0;

  let used = grantEvenly(priority, quotas, maxLines - reservedRemaining);
  used += grantEvenly(remaining, quotas, Math.min(reservedRemaining, maxLines - used));
  used += grantEvenly(priority, quotas, maxLines - used);
  grantEvenly(remaining, quotas, maxLines - used);

  return new Map(inputs.map((input) => [
    input.path,
    spreadHarnessAuditLineIndexes(input.indexes, quotas.get(input.path) ?? 0),
  ]));
}

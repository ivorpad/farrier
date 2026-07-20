import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { AdviceSessionLookback, AdviceVendor } from "./advice-types";
import type {
  SessionIndexEntry,
  SessionMetadataInventory,
  SessionMetadataProviderLimit,
} from "./advice-session-consent";

export type UnknownRecord = Record<string, unknown>;

export type SourceStatFingerprint = {
  device: string;
  inode: string;
  size: number;
  mtimeNs: string;
  ctimeNs: string;
};

export type IndexedSession<Locator> = {
  entry: SessionIndexEntry;
  locator: Locator;
  updatedAt: number;
};

export type ProviderSessionIndex<Locator> = {
  provider: AdviceVendor;
  sessions: IndexedSession<Locator>[];
  discovered: number;
  invalid: number;
  omitted: number;
  filtered: number;
  notes: string[];
};

const dayMs = 86_400_000;

export function sha256(...values: string[]): string {
  const hash = createHash("sha256");
  for (const value of values) hash.update(value).update("\0");
  return hash.digest("hex");
}

export function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function resultRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

export function timestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function cutoffMs(lookback: AdviceSessionLookback, now: number): number | undefined {
  if (lookback === "all") return undefined;
  return now - (lookback === "7d" ? 7 : 14) * dayMs;
}

export function withinLookback(
  updatedAt: number,
  lookback: AdviceSessionLookback,
  now: number,
): boolean {
  const cutoff = cutoffMs(lookback, now);
  return cutoff === undefined || updatedAt >= cutoff;
}

export function sourceStatFingerprint(stats: BigIntStats): SourceStatFingerprint {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    size: Number(stats.size),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString(),
  };
}

export function sameSourceStat(
  left: SourceStatFingerprint,
  right: SourceStatFingerprint,
): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

export function sourceFingerprint(
  provider: AdviceVendor,
  fields: Record<string, unknown>,
): string {
  const ordered = Object.fromEntries(Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)));
  return sha256("farrier-session-source-v1", provider, JSON.stringify(ordered));
}

export async function sessionProjectRoot(input: string): Promise<{ root: string; digest: string }> {
  const root = await realpath(resolve(input));
  const stats = await lstat(root, { bigint: true });
  if (!stats.isDirectory()) throw new Error("Session project root is not a directory.");
  return {
    root,
    digest: sha256(
      "farrier-session-project-v1",
      root,
      stats.dev.toString(),
      stats.ino.toString(),
    ),
  };
}

export async function sessionProjectRootDigest(input: string): Promise<string> {
  return (await sessionProjectRoot(input)).digest;
}

export function metadataInventory(
  projectRootDigest: string,
  indexes: ProviderSessionIndex<unknown>[],
): SessionMetadataInventory {
  const entries = indexes
    .flatMap((index) => index.sessions.map((session) => session.entry))
    .sort((left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      || left.provider.localeCompare(right.provider)
      || left.opaqueId.localeCompare(right.opaqueId));
  const limits: SessionMetadataProviderLimit[] = indexes.map((index) => ({
    provider: index.provider,
    discovered: index.discovered,
    retained: index.sessions.length,
    omitted: index.omitted + index.filtered,
    invalid: index.invalid,
  }));
  return {
    entries,
    limits,
    projectRootDigest,
    notes: indexes.flatMap((index) => index.notes),
  };
}

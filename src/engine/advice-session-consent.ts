import { createHash } from "node:crypto";
import type { AdviceSessionEpisode, AdviceSessionSourceSummary, AdviceVendor } from "./advice-types";
import type {
  SessionConsent,
  SessionConsentCategory,
  SessionConsentSelection,
  SessionIndexEntry,
} from "./skill-types";

export type {
  SessionConsent,
  SessionConsentCategory,
  SessionConsentSelection,
  SessionIndexEntry,
} from "./skill-types";

export const sessionConsentCategories = [
  "requests",
  "corrections",
  "commands",
  "files",
  "outcomes",
] as const satisfies readonly SessionConsentCategory[];

export const recentSessionConsentDefaults = {
  sessionLimit: 20,
  maxBytes: 250_000,
  maxTurns: 20,
} as const;

export type SessionMetadataProviderLimit = {
  provider: AdviceVendor;
  discovered: number;
  retained: number;
  omitted: number;
  invalid: number;
};

export type SessionMetadataInventory = {
  entries: SessionIndexEntry[];
  notes: string[];
  limits: SessionMetadataProviderLimit[];
  projectRootDigest: string;
};

const maxSelections = 50;
const maxSelectionBytes = 2_000_000;
const maxConsentBytes = 8_000_000;
const maxSelectionTurns = 200;
const maxConsentTurns = 1_000;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedProvider(value: unknown): AdviceVendor {
  const provider = String(value).toLowerCase();
  if (provider !== "claude" && provider !== "codex") {
    throw new Error("Session consent contains an unsupported provider.");
  }
  return provider;
}

function normalizedCategories(values: readonly unknown[]): SessionConsentCategory[] {
  const selected = new Set(values.map((value) => String(value).toLowerCase()));
  for (const value of selected) {
    if (!(sessionConsentCategories as readonly string[]).includes(value)) {
      throw new Error(`Session consent contains an unsupported category: ${value}.`);
    }
  }
  const categories = sessionConsentCategories.filter((category) => selected.has(category));
  if (!categories.length) throw new Error("Session consent must select at least one data category.");
  return categories;
}

function normalizedSelections(values: readonly SessionConsentSelection[]): SessionConsentSelection[] {
  if (!values.length) throw new Error("Session consent must select at least one session.");
  if (values.length > maxSelections) throw new Error(`Session consent selects more than ${maxSelections} sessions.`);

  const seen = new Set<string>();
  let totalBytes = 0;
  let totalTurns = 0;
  const selected = values.map((value) => {
    const provider = normalizedProvider(value.provider);
    const opaqueId = String(value.opaqueId);
    const expectedFingerprint = String(value.expectedFingerprint);
    const key = `${provider}\0${opaqueId}`;
    if (!opaqueId || !expectedFingerprint) throw new Error("Session consent selection identifiers and fingerprints must be non-empty.");
    if (seen.has(key)) throw new Error(`Session consent contains duplicate selection ${provider}:${opaqueId}.`);
    seen.add(key);
    if (!Number.isSafeInteger(value.maxBytes) || value.maxBytes <= 0 || value.maxBytes > maxSelectionBytes) {
      throw new Error(`Session consent maxBytes must be between 1 and ${maxSelectionBytes} per selection.`);
    }
    if (!Number.isSafeInteger(value.maxTurns) || value.maxTurns <= 0 || value.maxTurns > maxSelectionTurns) {
      throw new Error(`Session consent maxTurns must be between 1 and ${maxSelectionTurns} per selection.`);
    }
    totalBytes += value.maxBytes;
    totalTurns += value.maxTurns;
    return { provider, opaqueId, expectedFingerprint, maxBytes: value.maxBytes, maxTurns: value.maxTurns };
  });
  if (totalBytes > maxConsentBytes) throw new Error(`Session consent exceeds the ${maxConsentBytes}-byte aggregate limit.`);
  if (totalTurns > maxConsentTurns) throw new Error(`Session consent exceeds the ${maxConsentTurns}-turn aggregate limit.`);
  return selected.sort((left, right) =>
    left.provider.localeCompare(right.provider) || left.opaqueId.localeCompare(right.opaqueId));
}

function canonicalConsentFields(input: {
  projectRootDigest: string;
  selected: SessionConsentSelection[];
  categories: SessionConsentCategory[];
}): string {
  return JSON.stringify({
    version: 1,
    projectRootDigest: input.projectRootDigest,
    selected: input.selected,
    categories: input.categories,
  });
}

export function sessionConsentDigest(input: {
  projectRootDigest: string;
  selected: readonly SessionConsentSelection[];
  categories: readonly SessionConsentCategory[];
}): string {
  const selected = normalizedSelections(input.selected);
  const categories = normalizedCategories(input.categories);
  return digest(canonicalConsentFields({ projectRootDigest: input.projectRootDigest, selected, categories }));
}

export function createSessionConsent(input: {
  projectRootDigest: string;
  selected: Array<{ entry: SessionIndexEntry; maxBytes: number; maxTurns: number }>;
  categories: readonly SessionConsentCategory[];
}): SessionConsent {
  if (!input.projectRootDigest) throw new Error("Session consent requires a project-root digest.");
  const selected = normalizedSelections(input.selected.map(({ entry, maxBytes, maxTurns }) => ({
    provider: entry.provider,
    opaqueId: entry.opaqueId,
    expectedFingerprint: entry.sourceFingerprint,
    maxBytes,
    maxTurns,
  })));
  const categories = normalizedCategories(input.categories);
  return {
    version: 1,
    projectRootDigest: input.projectRootDigest,
    selected,
    categories,
    selectionDigest: digest(canonicalConsentFields({
      projectRootDigest: input.projectRootDigest,
      selected,
      categories,
    })),
  };
}

export function createRecentSessionConsent(input: {
  inventory: SessionMetadataInventory;
  provider: AdviceVendor;
  sessionLimit?: number;
  maxBytes?: number;
  maxTurns?: number;
  categories?: readonly SessionConsentCategory[];
}): SessionConsent | undefined {
  const selected = input.inventory.entries
    .filter((entry) => entry.provider === input.provider)
    .slice(0, input.sessionLimit ?? recentSessionConsentDefaults.sessionLimit);
  if (selected.length === 0) return undefined;
  return createSessionConsent({
    projectRootDigest: input.inventory.projectRootDigest,
    selected: selected.map((entry) => ({
      entry,
      maxBytes: input.maxBytes ?? recentSessionConsentDefaults.maxBytes,
      maxTurns: input.maxTurns ?? recentSessionConsentDefaults.maxTurns,
    })),
    categories: input.categories ?? sessionConsentCategories,
  });
}

export function validateSessionConsent(
  consent: SessionConsent,
  expectedProjectRootDigest?: string,
): SessionConsent {
  if (!consent || consent.version !== 1) throw new Error("Session consent version must be 1.");
  if (!consent.projectRootDigest) throw new Error("Session consent requires a project-root digest.");
  if (expectedProjectRootDigest && consent.projectRootDigest !== expectedProjectRootDigest) {
    throw new Error("Session consent project root has changed.");
  }
  const selected = normalizedSelections(consent.selected);
  const categories = normalizedCategories(consent.categories);
  const expectedDigest = digest(canonicalConsentFields({
    projectRootDigest: consent.projectRootDigest,
    selected,
    categories,
  }));
  if (consent.selectionDigest !== expectedDigest) throw new Error("Session consent selection digest is invalid.");
  return { ...consent, selected, categories };
}

export function filterEpisodeByConsent(
  episode: AdviceSessionEpisode,
  categories: readonly SessionConsentCategory[],
): AdviceSessionEpisode | undefined {
  const allowed = new Set(categories);
  if (!allowed.has("requests")) return undefined;
  return {
    ...episode,
    corrections: allowed.has("corrections") ? episode.corrections : [],
    actions: episode.actions.filter((item) =>
      item.type === "file-change" ? allowed.has("files") : allowed.has("commands")),
    ...(allowed.has("outcomes") && episode.outcome ? { outcome: episode.outcome } : { outcome: undefined }),
  };
}

export function selectedSourceCounts(consent: SessionConsent): AdviceSessionSourceSummary[] {
  return (["claude", "codex"] as const).flatMap((source) => {
    const count = consent.selected.filter((selection) => selection.provider === source).length;
    return count ? [{ source, count }] : [];
  });
}

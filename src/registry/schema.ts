import type {
  KonsistentTemplate,
  PackDetect,
  PackVerbs,
  SecondaryDetector,
  ToolPolicyRule
} from "../packs/types";
import { isRegistryRef } from "./ref";

export type RegistryItemType = "pack" | "hook" | "skill";

export type RegistryIndexItem = {
  name: string;
  type: RegistryItemType;
  description?: string;
  version: string;
};

export type RegistryIndex = {
  schemaVersion: 1;
  name: string;
  description?: string;
  items: RegistryIndexItem[];
};

export type RegistryPackPayload = {
  extends?: string;
  detect: PackDetect;
  generator?: {
    command: string;
    args: string[];
    onlyWhenEmptyDir: boolean;
  };
  skills: string[];
  hooks: string[];
  toolPolicyRules?: ToolPolicyRule[];
  konsistentTemplate?: KonsistentTemplate;
  konsistentTool?: string;
  verbs?: PackVerbs;
  agentsRules?: string[];
  secondaryDetectors?: SecondaryDetector[];
};

export type RegistryPackItem = {
  schemaVersion: 1;
  type: "pack";
  name: string;
  version: string;
  description?: string;
  pack: RegistryPackPayload;
};

export type RegistryHookEventName = "PreToolUse" | "PostToolUse" | "Stop";
export type RegistryHookRunner = "python3" | "bash" | "bun";

export type RegistryHookEvent = {
  event: RegistryHookEventName;
  matcher?: string;
};

export type RegistryHookFile = {
  path: string;
  content: string;
  executable?: boolean;
};

export type RegistryHookPayload = {
  hookVersion: number;
  events: RegistryHookEvent[];
  entry: string;
  runner: RegistryHookRunner;
  files: RegistryHookFile[];
};

export type RegistryHookItem = {
  schemaVersion: 1;
  type: "hook";
  name: string;
  version: string;
  description?: string;
  hook: RegistryHookPayload;
};

export type RegistrySkillItem = {
  schemaVersion: 1;
  type: "skill";
  name: string;
  version: string;
  description?: string;
  skill: {
    refs: string[];
  };
};

export type RegistryItem = RegistryPackItem | RegistryHookItem | RegistrySkillItem;

const itemNamePattern = /^[a-z0-9][a-z0-9-]*$/;
const hookEvents = new Set(["PreToolUse", "PostToolUse", "Stop"]);
const hookRunners = new Set(["python3", "bash", "bun"]);

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function optionalStringField(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return stringField(value, path);
}

function booleanField(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    fail(path, "must be a boolean");
  }
  return value;
}

function stringArray(value: unknown, path: string, required = false): string[] {
  if (value === undefined && !required) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    fail(path, "must be a string array");
  }

  return [...value];
}

function assertSchemaVersion(value: unknown, path: string): void {
  if (value !== 1) {
    fail(`${path}.schemaVersion`, "must be 1");
  }
}

function validateItemName(value: unknown, path: string): string {
  const name = stringField(value, path);

  if (!itemNamePattern.test(name)) {
    fail(path, "must match ^[a-z0-9][a-z0-9-]*$");
  }

  if (name === "registry") {
    fail(path, "is reserved");
  }

  return name;
}

function validateType(value: unknown, path: string): RegistryItemType {
  if (value !== "pack" && value !== "hook" && value !== "skill") {
    fail(path, 'must be "pack", "hook", or "skill"');
  }
  return value;
}

function validateDetect(value: unknown, path: string): PackDetect {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  return {
    files: stringArray(value.files, `${path}.files`),
    anyFiles: stringArray(value.anyFiles, `${path}.anyFiles`),
    globs: stringArray(value.globs, `${path}.globs`),
    pyprojectDependencies: stringArray(value.pyprojectDependencies, `${path}.pyprojectDependencies`),
    packageJsonDependencies: stringArray(value.packageJsonDependencies, `${path}.packageJsonDependencies`),
    packageJsonDevDependencies: stringArray(value.packageJsonDevDependencies, `${path}.packageJsonDevDependencies`),
    packageJsonAnyDependencies: stringArray(value.packageJsonAnyDependencies, `${path}.packageJsonAnyDependencies`),
    gemfileGems: stringArray(value.gemfileGems, `${path}.gemfileGems`),
    any: validateDetectList(value.any, `${path}.any`)
  };
}

function validateDetectList(value: unknown, path: string): PackDetect[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    fail(path, "must be an array");
  }

  return value.map((item, index) => validateDetect(item, `${path}.${index}`));
}

function validateGenerator(value: unknown, path: string): RegistryPackPayload["generator"] {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  return {
    command: stringField(value.command, `${path}.command`),
    args: stringArray(value.args, `${path}.args`, true),
    onlyWhenEmptyDir: booleanField(value.onlyWhenEmptyDir, `${path}.onlyWhenEmptyDir`)
  };
}

function validateVerbs(value: unknown, path: string): PackVerbs | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  return {
    check: stringField(value.check, `${path}.check`),
    test: stringField(value.test, `${path}.test`),
    fmt: stringField(value.fmt, `${path}.fmt`),
    konsistent: optionalStringField(value.konsistent, `${path}.konsistent`)
  };
}

function recordArray(value: unknown, path: string): Record<string, unknown>[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every(isRecord)) {
    fail(path, "must be an object array");
  }

  return value as Record<string, unknown>[];
}

function validateToolPolicyRules(value: unknown, path: string): ToolPolicyRule[] | undefined {
  return recordArray(value, path)?.map((rule, index) => {
    const rulePath = `${path}.${index}`;
    if (rule.tool !== "Bash") {
      fail(`${rulePath}.tool`, 'must be "Bash"');
    }
    return {
      id: stringField(rule.id, `${rulePath}.id`),
      description: stringField(rule.description, `${rulePath}.description`),
      tool: "Bash",
      commandPattern: stringField(rule.commandPattern, `${rulePath}.commandPattern`),
      flags: optionalStringField(rule.flags, `${rulePath}.flags`),
      message: stringField(rule.message, `${rulePath}.message`),
      redirect: stringField(rule.redirect, `${rulePath}.redirect`)
    };
  });
}

function validateSecondaryDetectors(value: unknown, path: string): SecondaryDetector[] | undefined {
  return recordArray(value, path)?.map((detector, index) => {
    const detectorPath = `${path}.${index}`;
    if (detector.detect === undefined) {
      fail(`${detectorPath}.detect`, "is required");
    }
    return {
      id: stringField(detector.id, `${detectorPath}.id`),
      description: stringField(detector.description, `${detectorPath}.description`),
      detect: validateDetect(detector.detect, `${detectorPath}.detect`),
      suggestSkills: stringArray(detector.suggestSkills, `${detectorPath}.suggestSkills`),
      suggestPackIds: stringArray(detector.suggestPackIds, `${detectorPath}.suggestPackIds`),
      notes: stringArray(detector.notes, `${detectorPath}.notes`)
    };
  });
}

function validateKonsistentTemplate(value: unknown, path: string): KonsistentTemplate | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  if (value.version !== "v1") {
    fail(`${path}.version`, 'must be "v1"');
  }

  if (!Array.isArray(value.conventions)) {
    fail(`${path}.conventions`, "must be an array");
  }

  const conventions = value.conventions.map((convention, index) => {
    const conventionPath = `${path}.conventions.${index}`;
    if (!isRecord(convention)) {
      fail(conventionPath, "must be an object");
    }

    const paths = convention.paths;
    if (typeof paths !== "string" && !(Array.isArray(paths) && paths.every((item) => typeof item === "string"))) {
      fail(`${conventionPath}.paths`, "must be a string or string array");
    }

    const hasMust = convention.must !== undefined;
    const hasMustNot = convention.mustNot !== undefined;
    if (hasMust === hasMustNot) {
      fail(conventionPath, "must have exactly one of must or mustNot");
    }
    const predicate = hasMust ? convention.must : convention.mustNot;
    if (!isRecord(predicate)) {
      fail(`${conventionPath}.${hasMust ? "must" : "mustNot"}`, "must be an object");
    }

    return {
      name: stringField(convention.name, `${conventionPath}.name`),
      description: stringField(convention.description, `${conventionPath}.description`),
      paths: typeof paths === "string" ? paths : [...paths],
      ...(convention.excludeFiles === undefined
        ? {}
        : { excludeFiles: stringArray(convention.excludeFiles, `${conventionPath}.excludeFiles`) }),
      ...(hasMust ? { must: predicate } : { mustNot: predicate })
    };
  });

  return { version: "v1", conventions: conventions as KonsistentTemplate["conventions"] };
}

function validatePackItem(record: Record<string, unknown>, base: Omit<RegistryPackItem, "pack" | "type">): RegistryPackItem {
  if (!isRecord(record.pack)) {
    fail("pack", "must be an object");
  }

  if (record.pack.id !== undefined) {
    fail("pack.id", "must not be supplied; registry pack ids are derived from the namespace and item name");
  }

  const verbs = validateVerbs(record.pack.verbs, "pack.verbs");
  const extendsId = optionalStringField(record.pack.extends, "pack.extends");
  if (!extendsId && !verbs) {
    fail("pack.verbs", "is required when pack.extends is absent");
  }

  return {
    ...base,
    type: "pack",
    pack: {
      extends: extendsId,
      detect: validateDetect(record.pack.detect, "pack.detect"),
      generator: validateGenerator(record.pack.generator, "pack.generator"),
      skills: stringArray(record.pack.skills, "pack.skills"),
      hooks: stringArray(record.pack.hooks, "pack.hooks"),
      toolPolicyRules: validateToolPolicyRules(record.pack.toolPolicyRules, "pack.toolPolicyRules"),
      konsistentTemplate: validateKonsistentTemplate(record.pack.konsistentTemplate, "pack.konsistentTemplate"),
      konsistentTool: optionalStringField(record.pack.konsistentTool, "pack.konsistentTool"),
      verbs,
      agentsRules: stringArray(record.pack.agentsRules, "pack.agentsRules"),
      secondaryDetectors: validateSecondaryDetectors(record.pack.secondaryDetectors, "pack.secondaryDetectors")
    }
  };
}

function validateHookPath(value: unknown, path: string): string {
  const filePath = stringField(value, path).replaceAll("\\", "/");

  if (filePath.startsWith("/") || filePath.startsWith("\\") || filePath.split("/").includes("..")) {
    fail(path, "must be relative and must not contain ..");
  }

  return filePath;
}

function validateHookEvents(value: unknown): RegistryHookEvent[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("hook.events", "must be a non-empty array");
  }

  return value.map((item, index) => {
    const path = `hook.events.${index}`;
    if (!isRecord(item)) {
      fail(path, "must be an object");
    }
    if (typeof item.event !== "string" || !hookEvents.has(item.event)) {
      fail(`${path}.event`, 'must be "PreToolUse", "PostToolUse", or "Stop"');
    }
    return {
      event: item.event as RegistryHookEventName,
      matcher: optionalStringField(item.matcher, `${path}.matcher`)
    };
  });
}

function validateHookFiles(value: unknown): RegistryHookFile[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("hook.files", "must be a non-empty array");
  }

  return value.map((item, index) => {
    const path = `hook.files.${index}`;
    if (!isRecord(item)) {
      fail(path, "must be an object");
    }
    return {
      path: validateHookPath(item.path, `${path}.path`),
      content: stringField(item.content, `${path}.content`),
      ...(item.executable === undefined ? {} : { executable: booleanField(item.executable, `${path}.executable`) })
    };
  });
}

function validateHookItem(record: Record<string, unknown>, base: Omit<RegistryHookItem, "hook" | "type">): RegistryHookItem {
  if (!isRecord(record.hook)) {
    fail("hook", "must be an object");
  }

  const hookVersionValue = record.hook.hookVersion;
  if (!Number.isInteger(hookVersionValue) || (hookVersionValue as number) < 1) {
    fail("hook.hookVersion", "must be a positive integer");
  }
  const hookVersion = hookVersionValue as number;

  const runner = record.hook.runner ?? "python3";
  if (typeof runner !== "string" || !hookRunners.has(runner)) {
    fail("hook.runner", 'must be "python3", "bash", or "bun"');
  }

  const files = validateHookFiles(record.hook.files);
  const entry = validateHookPath(record.hook.entry, "hook.entry");
  if (!files.some((file) => file.path === entry)) {
    fail("hook.entry", "must match a files[].path value");
  }

  return {
    ...base,
    type: "hook",
    hook: {
      hookVersion,
      events: validateHookEvents(record.hook.events),
      entry,
      runner: runner as RegistryHookRunner,
      files
    }
  };
}

function validateSkillItem(record: Record<string, unknown>, base: Omit<RegistrySkillItem, "skill" | "type">): RegistrySkillItem {
  if (!isRecord(record.skill)) {
    fail("skill", "must be an object");
  }

  return {
    ...base,
    type: "skill",
    skill: {
      refs: stringArray(record.skill.refs, "skill.refs", true)
    }
  };
}

export function validateRegistryIndex(value: unknown, namespace: string): RegistryIndex {
  if (!isRecord(value)) {
    fail("registry", "must be an object");
  }

  assertSchemaVersion(value.schemaVersion, "registry");
  if (value.name !== namespace) {
    fail("registry.name", `must equal configured namespace ${namespace}`);
  }

  if (!Array.isArray(value.items)) {
    fail("registry.items", "must be an array");
  }

  return {
    schemaVersion: 1,
    name: namespace,
    description: optionalStringField(value.description, "registry.description"),
    items: value.items.map((item, index) => {
      const path = `registry.items.${index}`;
      if (!isRecord(item)) {
        fail(path, "must be an object");
      }
      return {
        name: validateItemName(item.name, `${path}.name`),
        type: validateType(item.type, `${path}.type`),
        description: optionalStringField(item.description, `${path}.description`),
        version: stringField(item.version, `${path}.version`)
      };
    })
  };
}

export function validateRegistryItem(value: unknown, expected: { name: string; type: RegistryItemType }): RegistryItem {
  if (!isRecord(value)) {
    fail("item", "must be an object");
  }

  assertSchemaVersion(value.schemaVersion, "item");
  const name = validateItemName(value.name, "item.name");
  const type = validateType(value.type, "item.type");
  if (name !== expected.name) {
    fail("item.name", `must equal requested item ${expected.name}`);
  }
  if (type !== expected.type) {
    fail("item.type", `must equal index type ${expected.type}`);
  }

  const base = {
    schemaVersion: 1 as const,
    name,
    version: stringField(value.version, "item.version"),
    description: optionalStringField(value.description, "item.description")
  };

  if (type === "pack") {
    return validatePackItem(value, base);
  }
  if (type === "hook") {
    return validateHookItem(value, base);
  }
  return validateSkillItem(value, base);
}

export function assertRegistryItemRef(value: string, path: string): void {
  if (!isRegistryRef(value)) {
    fail(path, "must be a registry item ref like @namespace/name");
  }
}

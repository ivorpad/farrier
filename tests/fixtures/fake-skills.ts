#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = Bun.argv.slice(2);

if (args[0] !== "add" || !args[1]) {
  console.error("fake skills fixture only supports: add <source> -s <skills...> -a <agents...> -y");
  process.exit(2);
}

const source = args[1];
const skillsStart = args.indexOf("-s") + 1;
const agentsStart = args.indexOf("-a") + 1;

if (skillsStart === 0 || agentsStart === 0 || agentsStart <= skillsStart) {
  console.error("fake skills fixture received malformed arguments");
  process.exit(2);
}

const skillIds = args.slice(skillsStart, agentsStart - 1);
const agents = args.slice(agentsStart).filter((arg) => arg !== "-y" && arg !== "-g");
const roots: Record<string, string> = {
  "claude-code": ".claude/skills",
  codex: ".agents/skills",
};

for (const agent of agents) {
  const root = roots[agent];
  if (!root) {
    continue;
  }

  for (const skillId of skillIds) {
    const dir = join(process.cwd(), root, skillId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---\nname: ${skillId}\ndescription: Test fixture installed from ${source}.\n---\n`, "utf8");
  }
}

const lockPath = join(process.cwd(), "skills-lock.json");
let lock: { skills: Record<string, unknown> } = { skills: {} };
try {
  lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    skills: Record<string, unknown>;
  };
} catch {
  // A new target has no lock yet.
}

for (const skillId of skillIds) {
  lock.skills[skillId] = { source };
}

await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

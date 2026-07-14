import { posix } from "node:path";
import type { AgentBackend } from "./backend";

export const nativeSkillRoots: Record<AgentBackend, string> = {
  claude: ".claude/skills",
  codex: ".agents/skills"
};

export function nativeSkillPath(author: AgentBackend, name: string): string {
  return posix.join(nativeSkillRoots[author], name);
}

export function nativeSkillRef(author: AgentBackend, name: string): string {
  return `./${nativeSkillRoots[author]}@${name}`;
}

export function orderedNativeSkillRefs(entries: ReadonlyArray<{ author: AgentBackend; name: string }>): string[] {
  const byAuthor = new Map(entries.map((entry) => [entry.author, entry.name]));
  return (["claude", "codex"] as const).flatMap((author) => {
    const name = byAuthor.get(author);
    return name ? [nativeSkillRef(author, name)] : [];
  });
}

export function sharedSkillLinkTarget(name: string): string {
  return `../../.agents/skills/${name}`;
}

export function isNativeLocalSkillRef(ref: string): boolean {
  return /^\.\/\.(?:claude|agents)\/skills@[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ref);
}

export function parseNativeLocalSkillRef(ref: string): { author: AgentBackend; name: string } | undefined {
  const match = ref.match(/^\.\/(\.(?:claude|agents)\/skills)@([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  if (!match) return undefined;
  return { author: match[1] === ".claude/skills" ? "claude" : "codex", name: match[2]! };
}

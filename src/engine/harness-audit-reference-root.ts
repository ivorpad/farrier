import { dirname } from "node:path";

type ReferenceDocument = {
  path: string;
  kind: "guidance" | "skill" | "hook" | "toolchain";
  text: string;
};

const localResourcePattern = /\b(?:scripts|docs|tests?|rules|references|referencias|assets|sub-agents|modes|themes)\/[A-Za-z0-9_./-]+/g;

function installedSkillTreeRoot(path: string): string | undefined {
  return path.match(/^((?:skills|\.agents\/skills|\.claude\/skills)\/[^/]+)\//)?.[1];
}

export function skillReferenceRoot(
  document: ReferenceDocument,
  documents: ReferenceDocument[],
  lineText: string,
): string | undefined {
  if (document.kind !== "skill") return undefined;
  const paths = lineText.match(localResourcePattern) ?? [];
  const lineNamesRepositoryRoot = /\b(?:in\s+(?:this|the)\s+(?:repo|repository)|(?:repo|repository|project)\s+root)\b/i
    .test(lineText);
  const documentNamesRepositoryDocs = paths.some((path) => path.startsWith("docs/"))
    && /\b(?:docs|documentation)\b[^.]{0,160}\b(?:in|under)\s+(?:this|the)\s+(?:repo|repository)\b/is
      .test(document.text);
  const documentNamesRootCommand = paths.some((path) => path.startsWith("scripts/"))
    && /\bcwd-agnostic\b[^.]{0,200}\b(?:repo|repository|project)\s+root\b/is.test(document.text);
  if (lineNamesRepositoryRoot || documentNamesRepositoryDocs || documentNamesRootCommand) return ".";
  const treeRoot = installedSkillTreeRoot(document.path);
  if (!treeRoot || dirname(document.path) === treeRoot) return undefined;
  const shared = document.text.match(/\bshared (scripts|resources)\b.{0,120}\bskill root\b/is)?.[1];
  if (shared === "resources" || (shared === "scripts" && paths.some((path) => path.startsWith("scripts/")))) {
    return treeRoot;
  }
  const rootDocument = documents.find((item) => item.path === `${treeRoot}/SKILL.md`);
  if (!rootDocument) return undefined;
  return paths.some((path) => rootDocument.text.includes(path)) ? treeRoot : undefined;
}

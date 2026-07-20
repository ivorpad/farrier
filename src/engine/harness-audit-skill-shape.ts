import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import type { HarnessAuditCorpus } from "./harness-audit-evidence";
import type {
  HarnessAuditCheck,
  HarnessAuditCitation,
  HarnessAuditLine,
  HarnessAuditRecommendation,
} from "./harness-audit-types";

function citation(line: HarnessAuditLine): HarnessAuditCitation {
  return { path: line.path, line: line.line, excerpt: line.text.trim().slice(0, 320) };
}

function descriptionSource(lines: HarnessAuditLine[], path: string, after: number): HarnessAuditLine | undefined {
  const body = lines.filter((line) => line.path === path && line.line > after);
  return body.find((line) => /^[A-Za-z0-9]/.test(line.text.trim()))
    ?? body.find((line) => /^#{1,6}\s+\S/.test(line.text.trim()))
    ?? body[0];
}

function descriptionText(line: HarnessAuditLine): string {
  return line.text.trim().replace(/^#{1,6}\s+/, "");
}

function exactChange(frontmatterEnd: number, fields: string[]): string {
  if (frontmatterEnd > 0) {
    return ["Add these exact fields inside the existing YAML frontmatter:", ...fields].join("\n");
  }
  return ["Insert this exact YAML frontmatter before line 1:", "---", ...fields, "---"].join("\n");
}

export function skillShapeFindings(corpus: HarnessAuditCorpus): HarnessAuditRecommendation[] {
  const findings: HarnessAuditRecommendation[] = [];
  const supplied = new Set(corpus.lines.filter((item) => item.kind === "skill").map((item) => item.path));
  for (const document of corpus.documents.filter((item) => item.kind === "skill" && supplied.has(item.path))) {
    const lines = document.text.split("\n");
    const frontmatterEnd = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
    const frontmatter = frontmatterEnd > 0 ? lines.slice(1, frontmatterEnd).join("\n") : "";
    const required = document.path.startsWith(".claude/skills/") ? [] : ["name", "description"];
    const missing = required.filter((field) => !new RegExp(`^${field}:\\s*\\S`, "m").test(frontmatter));
    if (!missing.length) continue;
    const first = corpus.lines.find((line) => line.path === document.path && line.line === 1)
      ?? { id: "local", path: document.path, line: 1, text: lines[0] ?? "", kind: "skill" as const };
    const descriptionLine = missing.includes("description")
      ? descriptionSource(corpus.lines, document.path, Math.max(frontmatterEnd + 1, 0))
      : undefined;
    if (missing.includes("description") && !descriptionLine) continue;
    const name = basename(dirname(document.path));
    const fields = missing.map((field) => field === "name"
      ? `name: ${/^[a-z0-9][a-z0-9-]*$/.test(name) ? name : JSON.stringify(name)}`
      : `description: ${JSON.stringify(descriptionText(descriptionLine!))}`);
    const metadataCheck: HarnessAuditCheck = {
      id: `check:skill-frontmatter:${document.path}`,
      layers: ["skill"],
      description: `Parsed required YAML frontmatter fields in ${document.path}.`,
      result: `missing ${missing.join(" and ")}`,
    };
    const derivationCheck: HarnessAuditCheck = {
      id: `check:skill-metadata-source:${document.path}`,
      layers: ["skill"],
      description: "Derived exact metadata values from the installed directory and existing skill body.",
      result: descriptionLine
        ? `name=${name}; description from ${document.path}:${descriptionLine.line}`
        : `name=${name}; existing description retained`,
    };
    const digest = createHash("sha256").update(`${document.path}:${missing.join(",")}`, "utf8")
      .digest("hex").slice(0, 10);
    findings.push({
      id: `skill:${digest}`,
      layer: "skill",
      severity: "high",
      title: "Skill metadata is incomplete",
      defect: `${document.path} is missing parseable ${missing.join(" and ")} frontmatter.`,
      citations: [first, ...(descriptionLine ? [descriptionLine] : [])].filter((line, index, items) =>
        items.findIndex((item) => item.line === line.line) === index).map(citation),
      counterchecks: [metadataCheck, derivationCheck].map((item) => ({
        description: item.description,
        result: item.result,
      })),
      proposal: { artifact: document.path, change: exactChange(frontmatterEnd, fields) },
      risk: "Agents may not discover the skill or may load it without the intended trigger description.",
      uncertainty: "The proposed description reuses existing skill text; provider discovery and trigger behavior were not executed.",
      source: "deterministic",
    });
  }
  return findings;
}

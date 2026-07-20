import type { PermissionFinding, SkillPermissionSummary } from "./skill-types";

function unknownFinding(): PermissionFinding {
  return { status: "unknown", values: [] };
}

export function unknownSkillPermissions(): SkillPermissionSummary {
  return {
    shell: unknownFinding(),
    filesystemReads: unknownFinding(),
    filesystemWrites: unknownFinding(),
    networkDomains: unknownFinding(),
    browser: unknownFinding(),
    mcpServers: unknownFinding(),
    secretNames: unknownFinding(),
    requiredTools: unknownFinding(),
    unclassified: [],
  };
}

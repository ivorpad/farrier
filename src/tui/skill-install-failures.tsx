import type { InstallSkillResult } from "../engine/skills";
import { palette } from "./chrome";

const maxVisibleRetries = 4;

export function skillRetryCommand(ref: string): string | undefined {
  const separator = ref.lastIndexOf("@");
  if (separator <= 0 || separator >= ref.length - 1) return undefined;
  return `skills add ${ref.slice(0, separator)} -s ${ref.slice(separator + 1)} -a claude-code codex -y`;
}

export function skillRetryCommands(results: InstallSkillResult[], limit = maxVisibleRetries): { commands: string[]; omitted: number } {
  const all = results
    .filter((result) => !result.ok)
    .flatMap((result) => {
      const command = skillRetryCommand(result.ref);
      return command ? [command] : [];
    });
  return { commands: all.slice(0, limit), omitted: Math.max(all.length - limit, 0) };
}

export function SkillInstallFailureDetails(props: { results: InstallSkillResult[] }) {
  const failed = props.results.filter((result) => !result.ok);
  if (failed.length === 0) return null;

  const retries = skillRetryCommands(failed);
  return (
    <box style={{ flexDirection: "column", gap: 0 }}>
      <text fg={palette.warn}>{`Partial failure: ${failed.length} skill install${failed.length === 1 ? "" : "s"} failed after the harness files were applied.`}</text>
      {failed.map((result) => (
        <text key={result.ref} fg={palette.muted}>{`  • ${result.ref}: ${result.error ?? result.stderr ?? "unknown failure"}`}</text>
      ))}
      {retries.commands.map((command) => (
        <text key={command} fg={palette.gold}>{`  retry: ${command}`}</text>
      ))}
      {retries.omitted > 0 ? <text fg={palette.faint}>{`  ${retries.omitted} more retry command(s) omitted; rerun the wizard or use the refs above.`}</text> : null}
    </box>
  );
}

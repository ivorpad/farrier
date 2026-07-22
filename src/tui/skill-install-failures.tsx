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

/** Network-shaped install errors get a plain-language lead instead of raw fetch/stderr text. */
export function isNetworkFailure(result: InstallSkillResult): boolean {
  const text = `${result.error ?? ""} ${result.stderr ?? ""}`.toLowerCase();
  return /fetch failed|enotfound|econnrefused|econnreset|etimedout|network|getaddrinfo/.test(text);
}

export function SkillInstallFailureDetails(props: { results: InstallSkillResult[] }) {
  const failed = props.results.filter((result) => !result.ok);
  if (failed.length === 0) return null;

  const retries = skillRetryCommands(failed);
  const network = failed.some(isNetworkFailure);
  return (
    <box style={{ flexDirection: "column", gap: 0 }}>
      <text fg={palette.warn}>
        {network
          ? "Couldn't reach the skills library — check your internet connection. You can continue without it; your harness files were applied."
          : `${failed.length} skill install${failed.length === 1 ? "" : "s"} failed after your harness files were applied.`}
      </text>
      {failed.map((result) => (
        <text key={result.ref} fg={palette.faint}>{`  • ${result.ref}: ${result.error ?? result.stderr ?? "unknown failure"}`}</text>
      ))}
      {retries.commands.length > 0 ? <text fg={palette.muted}>{"  To finish this later, run:"}</text> : null}
      {retries.commands.map((command) => (
        <text key={command} fg={palette.gold}>{`    ${command}`}</text>
      ))}
      {retries.omitted > 0 ? <text fg={palette.faint}>{`  ${retries.omitted} more retry command(s) omitted; rerun the wizard or use the refs above.`}</text> : null}
    </box>
  );
}

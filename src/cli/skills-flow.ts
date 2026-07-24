import type { SessionAgentContext } from "../tui/session-context";

/**
 * The launcher's "Find/Create skills" flow: a picker chooses between the
 * search surface and the create wizard. esc/b walks up one level each time
 * (Find or Create -> picker -> launcher). Returns an exit code to bubble up,
 * or undefined to fall back to the launcher.
 */
export async function runSkillsFlow(
  targetDir: string,
  session: SessionAgentContext,
  initialQuery?: string
): Promise<number | undefined> {
  const cancelled = (): number => {
    console.error("farrier: cancelled.");
    return 1;
  };

  // The Find surface plus its `a` (author) handoff: back from authoring
  // reopens Find with the described text restored.
  const find = async (query?: string): Promise<number | "back"> => {
    const { runSkillsApp } = await import("../tui/skills-app");
    for (;;) {
      const outcome = await runSkillsApp(targetDir, session, { initialQuery: query });
      if (outcome === "back") return "back";
      if (outcome === "quit") return cancelled();

      const { runCreateWizard } = await import("../tui/create-app");
      const code = await runCreateWizard(targetDir, [outcome.request], session, { backToLauncher: true });
      if (code !== "back") return code;
      query = outcome.request.description;
    }
  };

  // An Improve skill suggestion arrives with the query prefilled: the picker
  // is skipped and back from Find returns straight to the launcher.
  if (initialQuery !== undefined) {
    const result = await find(initialQuery);
    return result === "back" ? undefined : result;
  }

  const { runSkillsPicker } = await import("../tui/skills-picker");
  for (;;) {
    const picked = await runSkillsPicker();
    if (picked === "back") return undefined;
    if (picked === "quit") return cancelled();

    let result: number | "back";
    if (picked === "create") {
      const { runCreateWizard } = await import("../tui/create-app");
      result = await runCreateWizard(targetDir, [], session, { backToLauncher: true });
    } else {
      result = await find();
    }
    if (result !== "back") return result;
  }
}

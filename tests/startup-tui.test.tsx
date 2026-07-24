import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";
import { act } from "react";
import type { ModelsConfig } from "../src/config/farrier-config";
import type { AgentDetection, AgentDetectionInventory } from "../src/engine/agent-detection";
import type { CliBackendListing } from "../src/engine/model-listing";
import { AdviceApp } from "../src/tui/advise-app";
import { createInitialAdviceTuiState } from "../src/tui/advise-machine";
import { LauncherApp } from "../src/tui/launcher";
import { createInitialWizardState } from "../src/tui/machine";
import { launcherSessionView, sessionAgentContext } from "../src/tui/session-context";
import { agentDetectionLabel, StartupApp, type StartupSelection } from "../src/tui/startup";

const renderOptions = { width: 120, height: 40 };

const notInstalled: AgentDetection = { installed: false, auth: "unknown" };
const signedIn = (version: string): AgentDetection => ({ installed: true, version, auth: "signed-in" });

const bothInstalled: AgentDetectionInventory = { claude: signedIn("2.1.217"), codex: signedIn("0.145.0") };
const claudeOnly: AgentDetectionInventory = { claude: signedIn("2.1.217"), codex: notInstalled };
const neitherInstalled: AgentDetectionInventory = { claude: notInstalled, codex: notInstalled };

const emptyListing: CliBackendListing = { models: [], efforts: [] };

function startupProps(
  detection: AgentDetectionInventory,
  confirmations: StartupSelection[],
  extras: Partial<Parameters<typeof StartupApp>[0]> = {}
): Parameters<typeof StartupApp>[0] {
  return {
    detection,
    models: {},
    // Tests never spawn the real CLIs; the default prop would.
    listCli: async () => emptyListing,
    onConfirm: (selection) => confirmations.push(selection),
    onCancel: () => undefined,
    ...extras
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function interact(view: TestRendererSetup, action: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await action();
    await view.flush();
  });
}

describe("startup screen", () => {
  test("first run shows detection per row, marks nothing as chosen, and needs an explicit pick", async () => {
    const confirmations: StartupSelection[] = [];
    const view = await testRender(<StartupApp {...startupProps(bothInstalled, confirmations)} />, renderOptions);
    try {
      const frame = await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      expect(frame).toContain("Claude Code");
      expect(frame).toContain("v2.1.217 · signed in");
      expect(frame).toContain("v0.145.0 · signed in");
      expect(frame).toContain("No default is assumed; pick explicitly.");
      expect(frame).not.toContain("◉");
      expect(confirmations).toHaveLength(0);

      await interact(view, () => view.mockInput.pressEnter());
      const models = await view.waitForFrame((value) => value.includes("Model and effort for this session"));
      expect(models).toContain("Claude Code model:");
      expect(models).toContain("Claude Code effort:");
      expect(models).toContain("‹ config default ›");
      expect(models).toContain("▸ Continue");
      expect(confirmations).toHaveLength(0);

      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "claude", models: {}, efforts: {} }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a remembered pick preselects the row, its model, and its effort but still requires Enter", async () => {
    const confirmations: StartupSelection[] = [];
    const view = await testRender(
      <StartupApp
        {...startupProps(bothInstalled, confirmations, {
          remembered: { agent: "codex", models: { codex: "gpt-5.5" }, efforts: { codex: "xhigh" } }
        })}
      />,
      renderOptions
    );
    try {
      const frame = await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      expect(frame).toContain("◉ Codex");
      expect(frame).toContain("▸ ◉ Codex");
      expect(frame).toContain("Remembered from last time. Enter confirms; arrows change it.");
      expect(confirmations).toHaveLength(0);

      await interact(view, () => view.mockInput.pressEnter());
      // Neither remembered value is among the configured or CLI-listed
      // suggestions here, so both carry over as prefilled free text.
      const models = await view.waitForFrame((value) => value.includes("Codex model:"));
      expect(models).toContain("gpt-5.5 (typed)");
      expect(models).toContain("xhigh (typed)");

      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "codex", models: { codex: "gpt-5.5" }, efforts: { codex: "xhigh" } }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a not-installed agent stays selectable behind an explicit warning", async () => {
    const confirmations: StartupSelection[] = [];
    const view = await testRender(<StartupApp {...startupProps(claudeOnly, confirmations)} />, renderOptions);
    try {
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      await interact(view, () => view.mockInput.pressArrow("down"));
      const frame = await view.waitForFrame((value) => value.includes("Codex is not installed on this computer."));
      expect(frame).toContain("farrier can still write its harness files");
      expect(frame).toContain("cannot run it here.");
      expect(frame).toContain("not installed");

      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("Codex model:"));
      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "codex", models: {}, efforts: {} }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("zero detection says so plainly and offers continuing without a backend", async () => {
    const confirmations: StartupSelection[] = [];
    const view = await testRender(<StartupApp {...startupProps(neitherInstalled, confirmations)} />, renderOptions);
    try {
      const frame = await view.waitForFrame((value) => value.includes("Neither Claude Code nor Codex is installed on this computer."));
      expect(frame).toContain("Continue without a backend");
      expect(frame).toContain("Create harness, Learn, and Doctor still work");

      for (let index = 0; index < 3; index += 1) await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "none", models: {}, efforts: {} }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("model line cycles configured suggestions and accepts a typed name", async () => {
    const confirmations: StartupSelection[] = [];
    const models: ModelsConfig = { claude: { advise: "opus-x" } };
    const view = await testRender(
      <StartupApp {...startupProps(bothInstalled, confirmations, { models })} />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("▸ Continue"));

      // Continue -> effort line -> model line.
      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      const suggested = await view.waitForFrame((value) => value.includes("‹ opus-x ›"));
      expect(suggested).toContain("‹ opus-x ›");

      await interact(view, () => view.mockInput.typeText("my-model"));
      const typed = await view.waitForFrame((value) => value.includes("my-model (typed)"));
      expect(typed).toContain("Could not list models from Claude Code; type a model name.");
      expect(typed).toContain("Suggestions come from your farrier config.");
      expect(typed).not.toContain("no reliable way");

      await interact(view, () => view.mockInput.pressEnter());
      await interact(view, () => view.mockInput.pressEnter());
      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "claude", models: { claude: "my-model" }, efforts: {} }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("CLI listings are fetched lazily on phase 2, once per backend, and reused on re-entry", async () => {
    const confirmations: StartupSelection[] = [];
    const calls: string[] = [];
    const view = await testRender(
      <StartupApp
        {...startupProps(bothInstalled, confirmations, {
          listCli: async (backend) => {
            calls.push(backend);
            return emptyListing;
          }
        })}
      />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      expect(calls).toEqual([]);

      // "Both" fetches for both backends.
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("Codex model:"));
      expect(calls.sort()).toEqual(["claude", "codex"]);

      // Leaving and re-entering phase 2 does not re-probe. A bare Escape sits
      // in the parser's ambiguity buffer; the sleep lets it resolve as a key.
      await interact(view, async () => {
        view.mockInput.pressEscape();
        await Bun.sleep(500);
      });
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("Codex model:"));
      expect(calls).toHaveLength(2);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("Enter confirms the config defaults while the CLI listing is still loading", async () => {
    const confirmations: StartupSelection[] = [];
    const pending = deferred<CliBackendListing>();
    const view = await testRender(
      <StartupApp {...startupProps(bothInstalled, confirmations, { listCli: () => pending.promise })} />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      await interact(view, () => view.mockInput.pressEnter());
      const loading = await view.waitForFrame((value) => value.includes("Listing models and effort levels from Claude Code..."));
      expect(loading).toContain("Enter still confirms the config defaults.");

      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "claude", models: {}, efforts: {} }]);
      // Settle the pending probe inside act so teardown stays warning-free.
      await interact(view, async () => {
        pending.resolve(emptyListing);
        await pending.promise;
      });
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("CLI-listed models become cyclable suggestions with an honest source line", async () => {
    const confirmations: StartupSelection[] = [];
    const view = await testRender(
      <StartupApp
        {...startupProps(bothInstalled, confirmations, {
          listCli: async () => ({ models: [{ id: "fable", displayName: "Fable" }, { id: "opus" }], efforts: [] })
        })}
      />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      await interact(view, () => view.mockInput.pressEnter());
      const listed = await view.waitForFrame((value) =>
        value.includes("Suggestions come from your farrier config and what the installed CLI reports.")
      );
      expect(listed).not.toContain("Could not list models");

      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((value) => value.includes("‹ fable ›"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((value) => value.includes("‹ opus ›"));

      await interact(view, () => view.mockInput.pressEnter());
      await interact(view, () => view.mockInput.pressEnter());
      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "claude", models: { claude: "opus" }, efforts: {} }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("claude effort levels come from the --effort help block and cycle on the effort line", async () => {
    const confirmations: StartupSelection[] = [];
    const view = await testRender(
      <StartupApp
        {...startupProps(bothInstalled, confirmations, {
          listCli: async () => ({ models: [{ id: "fable" }], efforts: ["low", "medium", "high", "xhigh", "max"] })
        })}
      />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("Claude Code effort:"));

      // Continue -> effort line; Left from config default wraps to the last level.
      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((value) => value.includes("‹ low ›"));
      await interact(view, () => view.mockInput.pressArrow("left"));
      await interact(view, () => view.mockInput.pressArrow("left"));
      await view.waitForFrame((value) => value.includes("‹ max ›"));

      await interact(view, () => view.mockInput.pressEnter());
      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "claude", models: {}, efforts: { claude: "max" } }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("codex effort options follow the selected model and mark its default", async () => {
    const confirmations: StartupSelection[] = [];
    const listing: CliBackendListing = {
      models: [
        { id: "gpt-a", supportedReasoningEfforts: ["low", "medium"], defaultReasoningEffort: "medium" },
        { id: "gpt-b", supportedReasoningEfforts: ["high"], defaultReasoningEffort: "high" }
      ]
    };
    const view = await testRender(
      <StartupApp {...startupProps(bothInstalled, confirmations, { listCli: async () => listing })} />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("Codex effort:"));

      // Model line: pick gpt-a.
      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((value) => value.includes("‹ gpt-a ›"));

      // Effort line follows gpt-a: low, then medium marked as its default.
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((value) => value.includes("‹ low ›"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((value) => value.includes("‹ medium (model default) ›"));

      // Changing the model resets the effort line; gpt-b offers only high.
      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((value) => value.includes("‹ gpt-b ›"));
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((value) => value.includes("‹ high (model default) ›"));

      await interact(view, () => view.mockInput.pressEnter());
      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "codex", models: { codex: "gpt-b" }, efforts: { codex: "high" } }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a free-typed codex model falls back to the union of listed effort levels", async () => {
    const confirmations: StartupSelection[] = [];
    const listing: CliBackendListing = {
      models: [
        { id: "gpt-a", supportedReasoningEfforts: ["low", "medium"], defaultReasoningEffort: "medium" },
        { id: "gpt-b", supportedReasoningEfforts: ["high"], defaultReasoningEffort: "high" }
      ]
    };
    const view = await testRender(
      <StartupApp {...startupProps(bothInstalled, confirmations, { listCli: async () => listing })} />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressEnter());
      await view.waitForFrame((value) => value.includes("Codex effort:"));

      // Type a model the CLI did not list.
      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.typeText("gpt-elsewhere"));
      await view.waitForFrame((value) => value.includes("gpt-elsewhere (typed)"));

      // The union across gpt-a and gpt-b, no default marking.
      await interact(view, () => view.mockInput.pressArrow("down"));
      await interact(view, () => view.mockInput.pressArrow("left"));
      const frame = await view.waitForFrame((value) => value.includes("‹ high ›"));
      expect(frame).not.toContain("(model default)");

      await interact(view, () => view.mockInput.pressEnter());
      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "codex", models: { codex: "gpt-elsewhere" }, efforts: { codex: "high" } }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("an effort probe failure says so honestly and accepts typed free text", async () => {
    const confirmations: StartupSelection[] = [];
    const view = await testRender(<StartupApp {...startupProps(bothInstalled, confirmations)} />, renderOptions);
    try {
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      await interact(view, () => view.mockInput.pressEnter());
      const frame = await view.waitForFrame((value) => value.includes("Could not list effort levels from Claude Code"));
      expect(frame).toContain("Could not list effort levels from Claude Code; type an effort level.");

      // Cycling has nothing to offer; typed text still works on the effort line.
      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      await view.waitForFrame((value) => value.includes("‹ config default ›"));
      await interact(view, () => view.mockInput.typeText("high"));
      await view.waitForFrame((value) => value.includes("high (typed)"));

      await interact(view, () => view.mockInput.pressEnter());
      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "claude", models: {}, efforts: { claude: "high" } }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a short terminal keeps the question, rows, and hints intact", async () => {
    const confirmations: StartupSelection[] = [];
    const view = await testRender(<StartupApp {...startupProps(neitherInstalled, confirmations)} />, { width: 100, height: 16 });
    try {
      await view.waitForFrame((value) => value.includes("Which agent do you work with?"));
      await view.waitForVisualIdle();
      const frame = view.captureCharFrame();
      expect(frame).toContain("Which agent do you work with?");
      expect(frame).toContain("○ Claude Code");
      expect(frame).toContain("enter choose");
      // Wrapped warn text must not bleed into neighboring rows mid-word.
      expect(frame).not.toMatch(/installed\S+Claude Code\s+not installed/);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });
});

describe("the confirmed pick reaches the workflows", () => {
  test("advise seeds its backend control from the startup pick", async () => {
    const view = await testRender(
      <AdviceApp
        sessionCounts={{ "7d": [], "14d": [], all: [] }}
        sessionInventory={{ entries: [], notes: [], limits: [], projectRootDigest: "digest" }}
        availability={{ claude: true, codex: true }}
        initialBackend="codex"
        onBack={() => undefined}
        onCancel={() => undefined}
        onRun={async () => {
          throw new Error("not run");
        }}
        onPlan={async () => {
          throw new Error("not used");
        }}
        onPlanBatch={async () => {
          throw new Error("not used");
        }}
        onApply={async () => ({ written: [], unchanged: [], writtenFiles: [], unchangedFiles: [], backupDir: null })}
        onCreateSkill={() => undefined}
        onDone={() => undefined}
      />,
      renderOptions
    );
    try {
      const frame = await view.waitForFrame((value) => value.includes("Analyze with: Claude Code / ‹ Codex ›"));
      expect(frame).toContain("Analyze with: Claude Code / ‹ Codex ›");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("the wizard's Agent step default and the advise machine both honor the pick", () => {
    const wizard = createInitialWizardState({ availablePackIds: ["python-uv"], defaultAgents: ["codex"] });
    expect(wizard.agents).toEqual(["codex"]);

    expect(createInitialAdviceTuiState(0, { claude: true, codex: true }, "codex").backend).toBe("codex");
    // The pick never overrides availability.
    expect(createInitialAdviceTuiState(0, { claude: true, codex: false }, "codex").backend).toBe("claude");
  });

  test("session context maps the choice to harness agents, a runnable backend, and the picked settings", () => {
    const both = sessionAgentContext({ choice: "both", models: {}, detection: bothInstalled });
    expect(both.agents).toEqual(["claude", "codex"]);
    expect(both.backend).toBe("claude");
    expect(both.efforts).toEqual({});

    const codexPick = sessionAgentContext({
      choice: "codex",
      models: { codex: "gpt-5.5" },
      efforts: { codex: "xhigh" },
      detection: bothInstalled
    });
    expect(codexPick.backend).toBe("codex");
    expect(codexPick.models.codex).toBe("gpt-5.5");
    expect(codexPick.efforts.codex).toBe("xhigh");

    // A chosen-but-missing agent yields no backend rather than substituting the other.
    const missing = sessionAgentContext({ choice: "codex", models: {}, detection: claudeOnly });
    expect(missing.agents).toEqual(["codex"]);
    expect(missing.backend).toBeUndefined();

    const none = sessionAgentContext({ choice: "none", models: {}, detection: neitherInstalled });
    expect(none.agents).toEqual([]);
    expect(none.backend).toBeUndefined();
  });

  test("the launcher context marks LLM-dependent rows only when no CLI is installed", async () => {
    const zero = launcherSessionView(sessionAgentContext({ choice: "none", models: {}, detection: neitherInstalled }));
    expect(zero.statusLine).toBe("No working agent selected. Create harness, skill search, Improve's local pass, and Doctor run without one.");
    expect(zero.rowNotes?.improve).toBe("local counting works; LLM analysis needs Claude Code or Codex");
    expect(zero.rowNotes?.skills).toBe("search works; suggestions and authoring need Claude Code or Codex");

    const working = launcherSessionView(
      sessionAgentContext({ choice: "claude", models: { claude: "sonnet" }, efforts: { claude: "max" }, detection: bothInstalled })
    );
    expect(working.statusLine).toBe("Working with Claude Code · claude model sonnet · claude effort max");
    expect(working.rowNotes).toEqual({});

    const missing = launcherSessionView(sessionAgentContext({ choice: "codex", models: {}, detection: claudeOnly }));
    expect(missing.statusLine).toBe("Working with Codex (Codex not installed here)");

    const view = await testRender(
      <LauncherApp onChoice={() => undefined} context={{ statusLine: zero.statusLine, rowNotes: zero.rowNotes }} />,
      renderOptions
    );
    try {
      const frame = await view.waitForFrame((value) => value.includes("LLM analysis needs Claude Code or Codex"));
      expect(frame).toContain("No working agent selected.");
      expect(frame).toContain("Improve");
      // The note replaces the detail column on the marked rows only.
      expect(frame).not.toContain("count session failures locally");
      expect(frame).toContain("export finished sessions as a portable playbook");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("detection labels stay honest", () => {
    expect(agentDetectionLabel(notInstalled)).toBe("not installed");
    expect(agentDetectionLabel({ installed: true, auth: "unknown" })).toBe("installed · sign-in unknown");
    expect(agentDetectionLabel({ installed: true, version: "1.0.0", auth: "not-signed-in" })).toBe("v1.0.0 · not signed in");
  });
});

import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";
import { act } from "react";
import type { ModelsConfig } from "../src/config/farrier-config";
import type { AgentDetection, AgentDetectionInventory } from "../src/engine/agent-detection";
import { AdviceApp } from "../src/tui/advise-app";
import { createInitialAdviceTuiState } from "../src/tui/advise-machine";
import { LauncherApp } from "../src/tui/launcher";
import { createInitialWizardState } from "../src/tui/machine";
import { launcherSessionView, sessionAgentContext } from "../src/tui/session-context";
import { agentDetectionLabel, modelSuggestions, StartupApp, type StartupSelection } from "../src/tui/startup";

const renderOptions = { width: 120, height: 40 };

const notInstalled: AgentDetection = { installed: false, auth: "unknown" };
const signedIn = (version: string): AgentDetection => ({ installed: true, version, auth: "signed-in" });

const bothInstalled: AgentDetectionInventory = { claude: signedIn("2.1.217"), codex: signedIn("0.145.0") };
const claudeOnly: AgentDetectionInventory = { claude: signedIn("2.1.217"), codex: notInstalled };
const neitherInstalled: AgentDetectionInventory = { claude: notInstalled, codex: notInstalled };

function startupProps(
  detection: AgentDetectionInventory,
  confirmations: StartupSelection[],
  extras: Partial<Parameters<typeof StartupApp>[0]> = {}
): Parameters<typeof StartupApp>[0] {
  return {
    detection,
    models: {},
    onConfirm: (selection) => confirmations.push(selection),
    onCancel: () => undefined,
    ...extras
  };
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
      const models = await view.waitForFrame((value) => value.includes("Model for this session"));
      expect(models).toContain("Claude Code model:");
      expect(models).toContain("‹ config default ›");
      expect(models).toContain("▸ Continue");
      expect(confirmations).toHaveLength(0);

      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "claude", models: {} }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a remembered pick preselects the row and its model but still requires Enter", async () => {
    const confirmations: StartupSelection[] = [];
    const view = await testRender(
      <StartupApp
        {...startupProps(bothInstalled, confirmations, {
          remembered: { agent: "codex", models: { codex: "gpt-5.5" } }
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
      const models = await view.waitForFrame((value) => value.includes("Codex model:"));
      expect(models).toContain("‹ gpt-5.5 ›");

      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "codex", models: { codex: "gpt-5.5" } }]);
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
      expect(confirmations).toEqual([{ agent: "codex", models: {} }]);
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
      expect(confirmations).toEqual([{ agent: "none", models: {} }]);
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

      await interact(view, () => view.mockInput.pressArrow("up"));
      await interact(view, () => view.mockInput.pressArrow("right"));
      const suggested = await view.waitForFrame((value) => value.includes("‹ opus-x ›"));
      expect(suggested).toContain("‹ opus-x ›");

      await interact(view, () => view.mockInput.typeText("my-model"));
      const typed = await view.waitForFrame((value) => value.includes("my-model (typed)"));
      expect(typed).toContain("no reliable way to list your account's");

      await interact(view, () => view.mockInput.pressEnter());
      await interact(view, () => view.mockInput.pressEnter());
      expect(confirmations).toEqual([{ agent: "claude", models: { claude: "my-model" } }]);
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

  test("session context maps the choice to harness agents and a runnable backend", () => {
    const both = sessionAgentContext({ choice: "both", models: {}, detection: bothInstalled });
    expect(both.agents).toEqual(["claude", "codex"]);
    expect(both.backend).toBe("claude");

    const codexPick = sessionAgentContext({ choice: "codex", models: { codex: "gpt-5.5" }, detection: bothInstalled });
    expect(codexPick.backend).toBe("codex");
    expect(codexPick.models.codex).toBe("gpt-5.5");

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
    expect(zero.statusLine).toBe("No working agent selected. Create harness, Learn, and Doctor run without one.");
    expect(zero.rowNotes?.advise).toBe("needs Claude Code or Codex installed");
    expect(zero.rowNotes?.create).toBe("authoring needs Claude Code or Codex installed");

    const working = launcherSessionView(sessionAgentContext({ choice: "claude", models: { claude: "sonnet" }, detection: bothInstalled }));
    expect(working.statusLine).toBe("Working with Claude Code · claude model sonnet");
    expect(working.rowNotes).toEqual({});

    const missing = launcherSessionView(sessionAgentContext({ choice: "codex", models: {}, detection: claudeOnly }));
    expect(missing.statusLine).toBe("Working with Codex (Codex not installed here)");

    const view = await testRender(
      <LauncherApp onChoice={() => undefined} context={{ statusLine: zero.statusLine, rowNotes: zero.rowNotes }} />,
      renderOptions
    );
    try {
      const frame = await view.waitForFrame((value) => value.includes("needs Claude Code or Codex installed"));
      expect(frame).toContain("No working agent selected.");
      expect(frame).toContain("Advise");
      expect(frame).not.toContain("analyze repo + recent sessions");
      expect(frame).toContain("count repeated session failures");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("detection labels and model suggestions stay honest and deduplicated", () => {
    expect(agentDetectionLabel(notInstalled)).toBe("not installed");
    expect(agentDetectionLabel({ installed: true, auth: "unknown" })).toBe("installed · sign-in unknown");
    expect(agentDetectionLabel({ installed: true, version: "1.0.0", auth: "not-signed-in" })).toBe("v1.0.0 · not signed in");

    expect(modelSuggestions("claude", { claude: { default: "sonnet", advise: "opus-x" } })).toEqual(["sonnet", "opus-x", "haiku"]);
    expect(modelSuggestions("codex", {})).toEqual(["gpt-5.5"]);
  });
});

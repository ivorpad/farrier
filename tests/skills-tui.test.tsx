import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";
import { act } from "react";
import type { SkillRecommendation } from "../src/engine/advise";
import type { InstallSkillResult, SkillSearchResult } from "../src/engine/skills";
import type { SkillRef } from "../src/packs/types";
import { SkillsApp, skillsRowsFor } from "../src/tui/skills-app";
import { SkillsPickerApp, skillsPickerReducer, skillsPickerRows } from "../src/tui/skills-picker";

// kittyKeyboard makes a lone Escape unambiguous, so tests can press it directly.
const renderOptions = { width: 120, height: 40, kittyKeyboard: true };

const deployResult: SkillSearchResult = { skillId: "deploy-checklist", name: "deploy-checklist", installs: 420, source: "acme/skills" };
const railsResult: SkillSearchResult = { skillId: "rails-conventions", name: "rails-conventions", installs: 88, source: "acme/skills" };

const walletRecommendation: SkillRecommendation = {
  ref: "acme/skills@wallet-ledger",
  name: "wallet-ledger",
  installs: 12,
  reason: "The brief describes double-entry bookkeeping."
};

function installOk(ref: SkillRef): InstallSkillResult {
  return { ref, ok: true, stdout: "", stderr: "", exitCode: 0 };
}

function skillsAppProps(overrides: Partial<Parameters<typeof SkillsApp>[0]> = {}): Parameters<typeof SkillsApp>[0] {
  return {
    onSearch: async () => [deployResult, railsResult],
    onInstall: async (refs) => refs.map(installOk),
    installTargetsLabel: "Claude Code",
    onExit: () => undefined,
    ...overrides
  };
}

async function interact(view: TestRendererSetup, action: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await action();
    await view.flush();
  });
}

describe("skills rows", () => {
  test("merges search results and suggestions by ref, suggestion wins", () => {
    const overlapping: SkillRecommendation = { ref: "acme/skills@deploy-checklist", name: "deploy-checklist", installs: 420, reason: "matches the deploy failures" };
    const rows = skillsRowsFor([deployResult, railsResult], [overlapping, walletRecommendation]);

    expect(rows).toHaveLength(3);
    const deploy = rows.find((row) => row.ref === "acme/skills@deploy-checklist");
    expect(deploy?.recommended).toBe(true);
    expect(deploy?.reason).toBe("matches the deploy failures");
    expect(rows.find((row) => row.ref === "acme/skills@wallet-ledger")?.recommended).toBe(true);
    expect(rows.find((row) => row.ref === "acme/skills@rails-conventions")?.recommended).toBe(false);
  });
});

describe("skills surface", () => {
  test("enter searches with the typed query and lists results", async () => {
    const queries: string[] = [];
    const view = await testRender(
      <SkillsApp {...skillsAppProps({ onSearch: async (query) => { queries.push(query); return [deployResult]; } })} />,
      renderOptions
    );
    try {
      await interact(view, () => view.mockInput.typeText("deploy"));
      await interact(view, () => view.mockInput.pressEnter());
      const frame = await view.waitForFrame((value) => value.includes("1 result(s)"));
      expect(queries).toEqual(["deploy"]);
      expect(frame).toContain("deploy-checklist");
      expect(frame).toContain("420");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("an initial query (the Improve jump) searches on mount", async () => {
    const queries: string[] = [];
    const view = await testRender(
      <SkillsApp {...skillsAppProps({ initialQuery: "npm deploy", onSearch: async (query) => { queries.push(query); return [deployResult]; } })} />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("1 result(s)"));
      expect(queries).toEqual(["npm deploy"]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a pasted multi-line PRD searches with its first line only", async () => {
    const queries: string[] = [];
    const view = await testRender(
      <SkillsApp
        {...skillsAppProps({
          initialQuery: "Wallet ledger service\nWe need double-entry bookkeeping.",
          onSearch: async (query) => { queries.push(query); return []; }
        })}
      />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("0 result(s)"));
      expect(queries).toEqual(["Wallet ledger service"]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("the suggest row runs the backend and marks its recommendations", async () => {
    let suggestRuns = 0;
    const view = await testRender(
      <SkillsApp
        {...skillsAppProps({
          suggest: {
            backendLabel: "claude (haiku)",
            run: async () => {
              suggestRuns += 1;
              return { backend: "claude", queries: ["wallet ledger"], recommendations: [walletRecommendation], notes: [] };
            }
          }
        })}
      />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("Suggest skills from this text"));
      // Zones cycle input → suggest → list; one tab reaches the suggest row.
      await interact(view, () => view.mockInput.pressTab());
      await interact(view, () => view.mockInput.pressEnter());
      const frame = await view.waitForFrame((value) => value.includes("1 suggestion(s)"));
      expect(suggestRuns).toBe(1);
      expect(frame).toContain("★ wallet-ledger");
      expect(frame).toContain("searched as: wallet ledger");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("without a backend the suggest row is absent and search still works", async () => {
    const view = await testRender(<SkillsApp {...skillsAppProps()} />, renderOptions);
    try {
      const frame = await view.waitForFrame((value) => value.includes("Suggestions and authoring need Claude Code or Codex"));
      expect(frame).not.toContain("Suggest skills from this text");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("space selects and i installs the selection", async () => {
    const installed: SkillRef[][] = [];
    const view = await testRender(
      <SkillsApp
        {...skillsAppProps({
          initialQuery: "deploy",
          onInstall: async (refs) => {
            installed.push(refs);
            return refs.map(installOk);
          }
        })}
      />,
      renderOptions
    );
    try {
      await view.waitForFrame((value) => value.includes("2 result(s)"));
      await interact(view, () => view.mockInput.pressEscape());
      await interact(view, () => view.mockInput.typeText(" "));
      await view.waitForFrame((value) => value.includes("1 selected"));
      await interact(view, () => view.mockInput.typeText("i"));
      const frame = await view.waitForFrame((value) => value.includes("Installed 1 skill(s)"));
      expect(installed).toEqual([["acme/skills@deploy-checklist"]]);
      expect(frame).toContain("✓ installed");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("a hands the typed brief to the author flow", async () => {
    const briefs: string[] = [];
    const view = await testRender(
      <SkillsApp {...skillsAppProps({ onAuthor: (description) => briefs.push(description) })} />,
      renderOptions
    );
    try {
      await interact(view, () => view.mockInput.typeText("a release-notes writer for this repo"));
      await interact(view, () => view.mockInput.pressEscape());
      await interact(view, () => view.mockInput.typeText("a"));
      expect(briefs).toEqual(["a release-notes writer for this repo"]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });
});

describe("skills picker", () => {
  test("chooses find or create through the visible rows", () => {
    expect(skillsPickerRows.map((row) => row.choice)).toEqual(["find", "create"]);
    expect(skillsPickerReducer({ index: 0 }, { type: "choose" }).choice).toBe("find");
    const create = skillsPickerReducer({ index: 0 }, { type: "down" }).state;
    expect(skillsPickerReducer(create, { type: "choose" }).choice).toBe("create");
    expect(skillsPickerReducer({ index: 0 }, { type: "back" }).choice).toBe("back");
    expect(skillsPickerReducer({ index: 0 }, { type: "quit" }).choice).toBe("quit");
  });

  test("clamps navigation and keeps labels ASCII for column alignment", () => {
    expect(skillsPickerReducer({ index: 0 }, { type: "up" }).state.index).toBe(0);
    const last = skillsPickerReducer({ index: skillsPickerRows.length - 1 }, { type: "down" }).state;
    expect(last.index).toBe(skillsPickerRows.length - 1);
    for (const row of skillsPickerRows) {
      expect(row.label).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  test("enter picks the focused row and esc walks back to the launcher", async () => {
    const choices: string[] = [];
    const view = await testRender(<SkillsPickerApp onChoice={(choice) => choices.push(choice)} />, renderOptions);
    try {
      const frame = await view.waitForFrame((value) => value.includes("Find skills"));
      expect(frame).toContain("Create a skill");
      await interact(view, () => view.mockInput.pressKey("\x1B[B"));
      await interact(view, () => view.mockInput.pressEnter());
      await interact(view, () => view.mockInput.pressEscape());
      expect(choices).toEqual(["create", "back"]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });
});

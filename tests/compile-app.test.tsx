import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { TestRendererSetup } from "@opentui/core/testing";
import { act } from "react";
import { CompilePreferencesApp, type CompileDeps, type CompileLoad } from "../src/tui/compile-app";
import type { KbCompileTarget } from "../src/engine/kb-compile";
import type { PreferenceKb } from "../src/engine/preference-kb";

const renderOptions = { width: 120, height: 44, kittyKeyboard: true };

async function interact(view: TestRendererSetup, action: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await action();
    await view.flush();
  });
}

function flattenFrame(frame: string): string {
  return frame.replace(/[│┌┐└┘─█▸]/g, " ").replace(/\s+/g, " ").trim();
}

function kbWith(rule: PreferenceKb["rules"][number]): PreferenceKb {
  return { version: 1, rules: [rule] };
}

const declarativeRule = { id: "short", rule: "Keep functions short.", tier: "declarative" as const, evidence: ["steer 1"], addedAt: "2026-07-27" };

function baseDeps(load: CompileLoad, sink: { applied: KbCompileTarget[][] }): CompileDeps {
  return {
    onLoad: async () => load,
    onApply: async (targets) => {
      sink.applied.push(targets);
      return { written: ["AGENTS.md"], unchanged: [] };
    },
    onInstallHook: async () => ({ written: [] })
  };
}

describe("CompilePreferencesApp", () => {
  test("lists targets and applies the selected ones", async () => {
    const sink = { applied: [] as KbCompileTarget[][] };
    const load: CompileLoad = {
      kb: kbWith(declarativeRule),
      plan: { targets: [{ kind: "agents-md-rule", ruleId: "short", line: "Keep functions short." }], skipped: [] },
      hookInstalled: false,
      harnessPresent: true
    };
    const view = await testRender(<CompilePreferencesApp deps={baseDeps(load, sink)} onExit={() => {}} />, renderOptions);
    try {
      const plan = await view.waitForFrame((value) => value.includes("AGENTS.md Hard Rule"));
      expect(flattenFrame(plan)).toContain("Compile preferences");

      await interact(view, () => view.mockInput.pressEnter());
      const applied = await view.waitForFrame((value) => value.includes("Compiled preferences"));
      expect(applied).toContain("Wrote 1 file");
      expect(sink.applied).toHaveLength(1);
      expect(sink.applied[0]).toEqual([{ kind: "agents-md-rule", ruleId: "short", line: "Keep functions short." }]);
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("shows an empty state when the KB has no rules", async () => {
    const view = await testRender(
      <CompilePreferencesApp
        deps={baseDeps({ kb: { version: 1, rules: [] }, plan: { targets: [], skipped: [] }, hookInstalled: false, harnessPresent: true }, { applied: [] })}
        onExit={() => {}}
      />,
      renderOptions
    );
    try {
      const frame = await view.waitForFrame((value) => value.includes("No reviewed preferences yet"));
      expect(flattenFrame(frame)).toContain("No reviewed preferences yet");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });

  test("the author-patterns consent screen names exactly what is sent", async () => {
    const sink = { applied: [] as KbCompileTarget[][] };
    const load: CompileLoad = {
      kb: kbWith({ id: "no-except", rule: "No broad except.", tier: "lintable", evidence: ["cluster 1"], addedAt: "2026-07-27" }),
      plan: { targets: [], skipped: [{ ruleId: "no-except", reason: "no reviewed patterns yet — author patterns first" }] },
      hookInstalled: false,
      harnessPresent: true
    };
    const deps: CompileDeps = {
      ...baseDeps(load, sink),
      authoring: {
        backendLabel: "claude (sonnet)",
        onAuthor: async () => ({ patterns: [], dropped: [] }),
        onInstallPatterns: async () => ({ written: [] })
      }
    };
    const view = await testRender(<CompilePreferencesApp deps={deps} onExit={() => {}} />, renderOptions);
    try {
      await view.waitForFrame((value) => value.includes("author them with review"));
      await interact(view, () => view.mockInput.typeText("p"));
      const consent = flattenFrame(await view.waitForFrame((value) => value.includes("Sends to the model")));
      expect(consent).toContain("reviewed rule sentence");
      expect(consent).toContain("evidence citations");
      expect(consent).toContain("no-except: No broad except.");
    } finally {
      await interact(view, () => view.renderer.destroy());
    }
  });
});

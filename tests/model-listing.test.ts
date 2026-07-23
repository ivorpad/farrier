import { afterEach, describe, expect, test } from "bun:test";
import type { BackendCommandRunner, BackendCommandRunnerInput } from "../src/engine/backend";
import type { CodexAppServerClient } from "../src/engine/codex-app-server";
import {
  cliModelSuggestions,
  listClaudeModels,
  listCodexModels,
  parseClaudeModelHelp,
  resetCliModelSuggestionsCache
} from "../src/engine/model-listing";

/**
 * Captured verbatim from `claude --help` (claude 2.1.x, 2026-07-23),
 * including the neighboring options: the --agents decoy proves quoted
 * tokens outside the --model block are ignored, and the possessive in
 * "a model's full name" proves prose apostrophes do not derail pairing.
 */
const realClaudeHelp = `Usage: claude [options] [command] [prompt]

Options:
  --agents <json>                       JSON object defining custom agents (e.g.
                                        '{"reviewer": {"description": "Reviews
                                        code", "prompt": "You are a code
                                        reviewer"}}')
  --mcp-config <configs...>             Load MCP servers from JSON files or
                                        strings (space-separated)
  --model <model>                       Model for the current session. Provide
                                        an alias for the latest model (e.g.
                                        'fable', 'opus', or 'sonnet') or a
                                        model's full name (e.g.
                                        'claude-fable-5').
  -n, --name <name>                     Set a display name for this session
                                        (shown in the prompt box, /resume
                                        picker, and terminal title)
`;

/** A plausible future binary: renamed aliases, full-name example first. */
const futureClaudeHelp = `Options:
  --model <model>                       Model override. Provide a model's full
                                        name (e.g. 'claude-nova-7-20270101') or
                                        an alias for the newest models (e.g.
                                        'nova', 'quartz', or 'haiku-lite').
  -n, --name <name>                     Set a display name for this session
`;

/** Shape from codex app-server v2/ModelListResponse.json, trimmed to the fields farrier reads plus schema-required ones. */
const codexModelListFixture = {
  data: [
    {
      id: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      displayName: "GPT-5.6-Sol",
      description: "Latest frontier agentic coding model.",
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast responses with lighter reasoning" }]
    },
    {
      id: "gpt-5.6-terra",
      model: "gpt-5.6-terra",
      displayName: "GPT-5.6-Terra",
      description: "Balanced agentic coding model for everyday work.",
      hidden: false,
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balances speed and reasoning depth" }]
    },
    {
      id: "gpt-5.3-internal",
      model: "gpt-5.3-internal",
      displayName: "GPT-5.3-Internal",
      description: "Hidden from the default picker list.",
      hidden: true,
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: []
    }
  ],
  nextCursor: null
};

function fakeClient(
  respond: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  closes: { count: number }
): CodexAppServerClient {
  return {
    request: (method, params) => respond(method, params),
    close: async () => {
      closes.count += 1;
    }
  };
}

describe("parseClaudeModelHelp", () => {
  test("extracts aliases then the full-name example from the real help text", () => {
    expect(parseClaudeModelHelp(realClaudeHelp)).toEqual([
      { id: "fable" },
      { id: "opus" },
      { id: "sonnet" },
      { id: "claude-fable-5" }
    ]);
  });

  test("survives renamed aliases and a reordered sentence: aliases still come first", () => {
    expect(parseClaudeModelHelp(futureClaudeHelp)).toEqual([
      { id: "nova" },
      { id: "quartz" },
      { id: "haiku-lite" },
      { id: "claude-nova-7-20270101" }
    ]);
  });

  test("help without a --model section, or with none of the expected quoting, parses to empty", () => {
    expect(parseClaudeModelHelp("Usage: claude [options]\n  --verbose  More output\n")).toEqual([]);
    expect(parseClaudeModelHelp("  --model <model>  Model for the current session.\n")).toEqual([]);
    expect(parseClaudeModelHelp("")).toEqual([]);
  });
});

describe("listClaudeModels", () => {
  test("runs `claude --help` through the injected runner and parses the --model block", async () => {
    const calls: string[][] = [];
    const runner: BackendCommandRunner = async (input: BackendCommandRunnerInput) => {
      calls.push(input.cmd);
      return { exitCode: 0, stdout: realClaudeHelp, stderr: "" };
    };

    const models = await listClaudeModels(runner);
    expect(calls).toEqual([["claude", "--help"]]);
    expect(models.map((entry) => entry.id)).toEqual(["fable", "opus", "sonnet", "claude-fable-5"]);
  });

  test("failure, hang, and unparseable output all degrade to an empty list", async () => {
    const failing: BackendCommandRunner = async () => {
      throw new Error("spawn ENOENT");
    };
    expect(await listClaudeModels(failing)).toEqual([]);

    const hanging: BackendCommandRunner = () => new Promise(() => undefined);
    expect(await listClaudeModels(hanging, 20)).toEqual([]);

    const unparseable: BackendCommandRunner = async () => ({ exitCode: 0, stdout: "no options here", stderr: "" });
    expect(await listClaudeModels(unparseable)).toEqual([]);
  });
});

describe("listCodexModels", () => {
  test("calls model/list and returns visible ids with display names, first page only", async () => {
    const closes = { count: 0 };
    const methods: string[] = [];
    const models = await listCodexModels(async () =>
      fakeClient(async (method) => {
        methods.push(method);
        return codexModelListFixture;
      }, closes)
    );

    expect(methods).toEqual(["model/list"]);
    expect(models).toEqual([
      { id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol" },
      { id: "gpt-5.6-terra", displayName: "GPT-5.6-Terra" }
    ]);
    expect(closes.count).toBe(1);
  });

  test("a hung request hits the hard timeout, returns empty, and still closes the client", async () => {
    const closes = { count: 0 };
    const models = await listCodexModels(
      async () => fakeClient(() => new Promise(() => undefined), closes),
      20
    );
    expect(models).toEqual([]);
    expect(closes.count).toBe(1);
  });

  test("a failing spawn or request degrades to an empty list", async () => {
    expect(
      await listCodexModels(async () => {
        throw new Error("codex not runnable");
      })
    ).toEqual([]);

    const closes = { count: 0 };
    expect(
      await listCodexModels(async () =>
        fakeClient(async () => {
          throw new Error("Codex App Server model/list failed");
        }, closes)
      )
    ).toEqual([]);
    expect(closes.count).toBe(1);
  });

  test("malformed responses parse to empty instead of throwing", async () => {
    for (const malformed of [null, "text", {}, { data: "not-an-array" }, { data: [{ displayName: "no id" }, 7] }]) {
      const closes = { count: 0 };
      expect(await listCodexModels(async () => fakeClient(async () => malformed, closes))).toEqual([]);
    }
  });

  test("duplicate ids are deduplicated and a missing displayName is omitted", async () => {
    const closes = { count: 0 };
    const models = await listCodexModels(async () =>
      fakeClient(
        async () => ({ data: [{ id: "gpt-x" }, { id: "gpt-x", displayName: "GPT-X" }], nextCursor: null }),
        closes
      )
    );
    expect(models).toEqual([{ id: "gpt-x" }]);
  });
});

describe("cliModelSuggestions cache", () => {
  afterEach(() => resetCliModelSuggestionsCache());

  test("probes once per backend per process and again after a reset", async () => {
    const counts = { claude: 0, codex: 0 };
    const probes = {
      claude: async () => {
        counts.claude += 1;
        return [{ id: "fable" }];
      },
      codex: async () => {
        counts.codex += 1;
        return [{ id: "gpt-5.6-sol" }];
      }
    };

    expect(await cliModelSuggestions("claude", probes)).toEqual([{ id: "fable" }]);
    expect(await cliModelSuggestions("claude", probes)).toEqual([{ id: "fable" }]);
    expect(await cliModelSuggestions("codex", probes)).toEqual([{ id: "gpt-5.6-sol" }]);
    expect(counts).toEqual({ claude: 1, codex: 1 });

    resetCliModelSuggestionsCache();
    expect(await cliModelSuggestions("claude", probes)).toEqual([{ id: "fable" }]);
    expect(counts.claude).toBe(2);
  });

  test("a rejecting probe caches an honest empty list rather than an error", async () => {
    const probes = {
      claude: async () => {
        throw new Error("probe exploded");
      },
      codex: async () => []
    };
    expect(await cliModelSuggestions("claude", probes)).toEqual([]);
  });
});

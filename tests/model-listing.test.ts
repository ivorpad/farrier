import { afterEach, describe, expect, test } from "bun:test";
import type { BackendCommandRunner, BackendCommandRunnerInput } from "../src/engine/backend";
import type { CodexAppServerClient } from "../src/engine/codex-app-server";
import {
  cliBackendListing,
  listClaudeCli,
  listCodexCli,
  parseClaudeEffortHelp,
  parseClaudeModelHelp,
  resetCliBackendListingCache
} from "../src/engine/model-listing";

/**
 * Captured verbatim from `claude --help` (claude 2.1.x, 2026-07-23),
 * including the neighboring options: the --agents decoy proves quoted
 * tokens outside the --model block are ignored, the possessive in
 * "a model's full name" proves prose apostrophes do not derail pairing,
 * and the --model block's parenthesized examples prove the effort parser
 * only accepts a bare-word level list.
 */
const realClaudeHelp = `Usage: claude [options] [command] [prompt]

Options:
  --agents <json>                       JSON object defining custom agents (e.g.
                                        '{"reviewer": {"description": "Reviews
                                        code", "prompt": "You are a code
                                        reviewer"}}')
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
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

/** A plausible future binary: renamed aliases, full-name example first, renamed effort levels with an "or". */
const futureClaudeHelp = `Options:
  --effort <effort>                     Reasoning effort (lite, standard, or ultra)
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
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast responses with lighter reasoning" },
        { reasoningEffort: "xhigh", description: "Deepest reasoning for the hardest problems" }
      ]
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

describe("parseClaudeEffortHelp", () => {
  test("extracts the enumerated levels from the real --effort block", () => {
    expect(parseClaudeEffortHelp(realClaudeHelp)).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  test("survives renamed levels, a reworded sentence, and an Oxford 'or'", () => {
    expect(parseClaudeEffortHelp(futureClaudeHelp)).toEqual(["lite", "standard", "ultra"]);
  });

  test("prose-bearing parentheses never qualify as a level list", () => {
    // Quoted examples and sentences (the --model block's style) must not parse as levels.
    const prose = "  --effort <level>   Effort for the session (e.g. 'low' or 'high'), see docs (recommended default applies)\n";
    expect(parseClaudeEffortHelp(prose)).toEqual([]);
  });

  test("help without a --effort section or without a level list parses to empty", () => {
    expect(parseClaudeEffortHelp("Usage: claude [options]\n  --verbose  More output\n")).toEqual([]);
    expect(parseClaudeEffortHelp("  --effort <level>  Effort level for the current session.\n")).toEqual([]);
    expect(parseClaudeEffortHelp("")).toEqual([]);
  });
});

describe("listClaudeCli", () => {
  test("runs `claude --help` once through the injected runner and parses models and efforts", async () => {
    const calls: string[][] = [];
    const runner: BackendCommandRunner = async (input: BackendCommandRunnerInput) => {
      calls.push(input.cmd);
      return { exitCode: 0, stdout: realClaudeHelp, stderr: "" };
    };

    const listing = await listClaudeCli(runner);
    expect(calls).toEqual([["claude", "--help"]]);
    expect(listing.models.map((entry) => entry.id)).toEqual(["fable", "opus", "sonnet", "claude-fable-5"]);
    expect(listing.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  test("failure, hang, and unparseable output all degrade to an empty listing", async () => {
    const failing: BackendCommandRunner = async () => {
      throw new Error("spawn ENOENT");
    };
    expect(await listClaudeCli(failing)).toEqual({ models: [], efforts: [] });

    const hanging: BackendCommandRunner = () => new Promise(() => undefined);
    expect(await listClaudeCli(hanging, 20)).toEqual({ models: [], efforts: [] });

    const unparseable: BackendCommandRunner = async () => ({ exitCode: 0, stdout: "no options here", stderr: "" });
    expect(await listClaudeCli(unparseable)).toEqual({ models: [], efforts: [] });
  });
});

describe("listCodexCli", () => {
  test("calls model/list and keeps per-model efforts and their defaults, first page only", async () => {
    const closes = { count: 0 };
    const methods: string[] = [];
    const listing = await listCodexCli(async () =>
      fakeClient(async (method) => {
        methods.push(method);
        return codexModelListFixture;
      }, closes)
    );

    expect(methods).toEqual(["model/list"]);
    expect(listing.efforts).toBeUndefined();
    expect(listing.models).toEqual([
      {
        id: "gpt-5.6-sol",
        displayName: "GPT-5.6-Sol",
        supportedReasoningEfforts: ["low", "xhigh"],
        defaultReasoningEffort: "low"
      },
      {
        id: "gpt-5.6-terra",
        displayName: "GPT-5.6-Terra",
        supportedReasoningEfforts: ["medium"],
        defaultReasoningEffort: "medium"
      }
    ]);
    expect(closes.count).toBe(1);
  });

  test("a hung request hits the hard timeout, returns empty, and still closes the client", async () => {
    const closes = { count: 0 };
    const listing = await listCodexCli(
      async () => fakeClient(() => new Promise(() => undefined), closes),
      20
    );
    expect(listing).toEqual({ models: [] });
    expect(closes.count).toBe(1);
  });

  test("a failing spawn or request degrades to an empty listing", async () => {
    expect(
      await listCodexCli(async () => {
        throw new Error("codex not runnable");
      })
    ).toEqual({ models: [] });

    const closes = { count: 0 };
    expect(
      await listCodexCli(async () =>
        fakeClient(async () => {
          throw new Error("Codex App Server model/list failed");
        }, closes)
      )
    ).toEqual({ models: [] });
    expect(closes.count).toBe(1);
  });

  test("malformed responses parse to empty instead of throwing", async () => {
    for (const malformed of [null, "text", {}, { data: "not-an-array" }, { data: [{ displayName: "no id" }, 7] }]) {
      const closes = { count: 0 };
      expect(await listCodexCli(async () => fakeClient(async () => malformed, closes))).toEqual({ models: [] });
    }
  });

  test("duplicate ids deduplicate; missing displayName and malformed effort fields are omitted", async () => {
    const closes = { count: 0 };
    const listing = await listCodexCli(async () =>
      fakeClient(
        async () => ({
          data: [
            { id: "gpt-x", supportedReasoningEfforts: "not-an-array", defaultReasoningEffort: 3 },
            { id: "gpt-x", displayName: "GPT-X" }
          ],
          nextCursor: null
        }),
        closes
      )
    );
    expect(listing.models).toEqual([{ id: "gpt-x" }]);
  });
});

describe("cliBackendListing cache", () => {
  afterEach(() => resetCliBackendListingCache());

  test("probes once per backend per process and again after a reset", async () => {
    const counts = { claude: 0, codex: 0 };
    const probes = {
      claude: async () => {
        counts.claude += 1;
        return { models: [{ id: "fable" }], efforts: ["low", "max"] };
      },
      codex: async () => {
        counts.codex += 1;
        return { models: [{ id: "gpt-5.6-sol" }] };
      }
    };

    expect(await cliBackendListing("claude", probes)).toEqual({ models: [{ id: "fable" }], efforts: ["low", "max"] });
    expect(await cliBackendListing("claude", probes)).toEqual({ models: [{ id: "fable" }], efforts: ["low", "max"] });
    expect(await cliBackendListing("codex", probes)).toEqual({ models: [{ id: "gpt-5.6-sol" }] });
    expect(counts).toEqual({ claude: 1, codex: 1 });

    resetCliBackendListingCache();
    expect(await cliBackendListing("claude", probes)).toEqual({ models: [{ id: "fable" }], efforts: ["low", "max"] });
    expect(counts.claude).toBe(2);
  });

  test("a rejecting probe caches an honest empty listing rather than an error", async () => {
    const probes = {
      claude: async (): Promise<never> => {
        throw new Error("probe exploded");
      },
      codex: async () => ({ models: [] })
    };
    expect(await cliBackendListing("claude", probes)).toEqual({ models: [], efforts: [] });
  });
});

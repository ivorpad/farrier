import { describe, expect, test } from "bun:test";
import { validateRegistryIndex, validateRegistryItem } from "../src/registry/schema";

const indexItem = {
  name: "demo",
  type: "pack" as const,
  version: "1.0.0"
};

function packItem(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    type: "pack",
    name: "demo",
    version: "1.0.0",
    pack: {
      detect: {
        files: ["pyproject.toml"]
      },
      skills: ["owner/repo@skill"],
      hooks: ["secret-shield"],
      verbs: {
        check: "uv run pytest",
        test: "uv run pytest",
        fmt: "uv run ruff format ."
      },
      ...overrides
    }
  };
}

describe("registry schema validation", () => {
  test("accepts a valid index and rejects namespace mismatch", () => {
    const index = validateRegistryIndex(
      {
        schemaVersion: 1,
        name: "@acme",
        description: "Acme packs",
        items: [indexItem]
      },
      "@acme"
    );

    expect(index.items).toEqual([indexItem]);

    expect(() =>
      validateRegistryIndex(
        {
          schemaVersion: 1,
          name: "@other",
          items: []
        },
        "@acme"
      )
    ).toThrow("registry.name: must equal configured namespace @acme");
  });

  test("rejects reserved registry item names", () => {
    expect(() =>
      validateRegistryIndex(
        {
          schemaVersion: 1,
          name: "@acme",
          items: [{ name: "registry", type: "pack", version: "1.0.0" }]
        },
        "@acme"
      )
    ).toThrow("registry.items.0.name: is reserved");
  });

  test("accepts pack items, derives ids externally, and requires verbs without extends", () => {
    const item = validateRegistryItem(packItem(), indexItem);

    expect(item.type).toBe("pack");
    if (item.type === "pack") {
      expect(item.pack.verbs?.check).toBe("uv run pytest");
      expect(item.pack.detect.files).toEqual(["pyproject.toml"]);
    }

    expect(() =>
      validateRegistryItem(
        packItem({
          id: "python-fastapi"
        }),
        indexItem
      )
    ).toThrow("pack.id: must not be supplied");

    expect(() =>
      validateRegistryItem(
        packItem({
          verbs: undefined
        }),
        indexItem
      )
    ).toThrow("pack.verbs: is required when pack.extends is absent");

    expect(() =>
      validateRegistryItem(
        packItem({
          extends: "python-uv",
          verbs: undefined
        }),
        indexItem
      )
    ).not.toThrow();
  });

  test("validates hook payload paths and entry file", () => {
    const hookIndexItem = {
      name: "guard",
      type: "hook" as const,
      version: "1.0.0"
    };

    const validHook = {
      schemaVersion: 1,
      type: "hook",
      name: "guard",
      version: "1.0.0",
      hook: {
        hookVersion: 2,
        events: [{ event: "PreToolUse", matcher: "Bash" }],
        entry: "guard.py",
        files: [{ path: "guard.py", content: "print('ok')\n" }]
      }
    };

    const item = validateRegistryItem(validHook, hookIndexItem);
    expect(item.type).toBe("hook");
    if (item.type === "hook") {
      expect(item.hook.runner).toBe("python3");
      expect(item.hook.hookVersion).toBe(2);
    }

    expect(() =>
      validateRegistryItem(
        {
          ...validHook,
          hook: {
            ...validHook.hook,
            files: [{ path: "../guard.py", content: "" }]
          }
        },
        hookIndexItem
      )
    ).toThrow("hook.files.0.path: must be relative and must not contain ..");

    expect(() =>
      validateRegistryItem(
        {
          ...validHook,
          hook: {
            ...validHook.hook,
            files: [{ path: "/guard.py", content: "" }]
          }
        },
        hookIndexItem
      )
    ).toThrow("hook.files.0.path: must be relative and must not contain ..");

    expect(() =>
      validateRegistryItem(
        {
          ...validHook,
          hook: {
            ...validHook.hook,
            entry: "missing.py"
          }
        },
        hookIndexItem
      )
    ).toThrow("hook.entry: must match a files[].path value");
  });

  test("accepts skill items as refs only", () => {
    const skill = validateRegistryItem(
      {
        schemaVersion: 1,
        type: "skill",
        name: "bundle",
        version: "1.0.0",
        skill: {
          refs: ["github.com/acme/skills@platform"]
        }
      },
      {
        name: "bundle",
        type: "skill"
      }
    );

    expect(skill.type).toBe("skill");
    if (skill.type === "skill") {
      expect(skill.skill.refs).toEqual(["github.com/acme/skills@platform"]);
    }
  });
});

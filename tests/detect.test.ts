import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectPacks, detectSecondary } from "../src/engine/detect";
import { resolvePack } from "../src/packs/index";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "farrier-detect-"));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("detectPacks", () => {
  test("returns no packs for unknown projects and never auto-detects generic", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "README.md"), "# unknown\n", "utf8");

    await expect(detectPacks(dir)).resolves.toEqual([]);
  });

  test("detects python-uv from pyproject.toml", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "pyproject.toml"),
      `[project]
name = "example"
dependencies = ["pytest"]
`,
      "utf8"
    );

    await expect(detectPacks(dir)).resolves.toEqual(["python-uv"]);
  });

  test("detects python-fastapi from pyproject.toml dependency", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "pyproject.toml"),
      `[project]
name = "example"
dependencies = [
  "fastapi>=0.110",
  "uvicorn",
]
`,
      "utf8"
    );

    await expect(detectPacks(dir)).resolves.toEqual(["python-fastapi", "python-uv"]);
  });

  test("detects python-fastapi dependency with extras", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "pyproject.toml"),
      `[project]
name = "example"
dependencies = [
  "fastapi[standard]>=0.110",
  "uvicorn",
]
`,
      "utf8"
    );

    await expect(detectPacks(dir)).resolves.toEqual(["python-fastapi", "python-uv"]);
  });

  test("detects python-lambda-powertools ahead of python-uv", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "pyproject.toml"),
      `[project]
name = "lambda-example"
dependencies = [
  "aws-lambda-powertools>=3",
  "boto3",
]
`,
      "utf8"
    );

    await expect(detectPacks(dir)).resolves.toEqual(["python-lambda-powertools", "python-uv"]);
  });

  test("detects ts-base from package.json and tsconfig.json", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "package.json"), {
      dependencies: {
        typescript: "^5.0.0"
      }
    });
    await writeJson(join(dir, "tsconfig.json"), {
      compilerOptions: {
        strict: true
      }
    });

    await expect(detectPacks(dir)).resolves.toEqual(["ts-base"]);
  });

  test("detects ts-react-vite with react and vite in dependencies", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "package.json"), {
      dependencies: {
        react: "^19.0.0",
        vite: "^7.0.0"
      }
    });
    await writeJson(join(dir, "tsconfig.json"), {
      compilerOptions: {
        strict: true
      }
    });

    await expect(detectPacks(dir)).resolves.toEqual(["ts-react-vite", "ts-base"]);
  });

  test("detects ts-react-vite with react and vite split across dependencies and devDependencies", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "package.json"), {
      dependencies: {
        react: "^19.0.0"
      },
      devDependencies: {
        vite: "^7.0.0"
      }
    });
    await writeJson(join(dir, "tsconfig.json"), {
      compilerOptions: {
        strict: true
      }
    });

    await expect(detectPacks(dir)).resolves.toEqual(["ts-react-vite", "ts-base"]);
  });

  test("detects ts-nextjs ahead of ts-base", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "package.json"), {
      dependencies: {
        next: "^15.0.0",
        react: "^19.0.0"
      }
    });
    await writeJson(join(dir, "tsconfig.json"), {
      compilerOptions: {
        strict: true
      }
    });

    await expect(detectPacks(dir)).resolves.toEqual(["ts-nextjs", "ts-base"]);
  });

  test("detects ts-lambda from aws-cdk-lib dependency", async () => {
    const dir = await tempDir();
    await writeJson(join(dir, "package.json"), {
      dependencies: {
        "aws-cdk-lib": "^2.0.0"
      }
    });
    await writeJson(join(dir, "tsconfig.json"), {
      compilerOptions: {
        strict: true
      }
    });

    await expect(detectPacks(dir)).resolves.toEqual(["ts-lambda", "ts-base"]);
  });

  test("detects ts-lambda from template.yaml without requiring package.json", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "template.yaml"), "AWSTemplateFormatVersion: '2010-09-09'\n", "utf8");

    await expect(detectPacks(dir)).resolves.toEqual(["ts-lambda"]);
  });

  test("detects ts-lambda from samconfig.toml without requiring package.json", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "samconfig.toml"), "version = 0.1\n", "utf8");

    await expect(detectPacks(dir)).resolves.toEqual(["ts-lambda"]);
  });

  test("detects rails from Gemfile", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "Gemfile"),
      `source "https://rubygems.org"

gem "rails", "~> 8.0"
`,
      "utf8"
    );

    await expect(detectPacks(dir)).resolves.toEqual(["rails"]);
  });

  test("malformed package.json does not throw", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "package.json"), "{not json", "utf8");

    await expect(detectPacks(dir)).resolves.toEqual([]);
  });
});

describe("detectSecondary", () => {
  test("detects Rails Hotwire from turbo-rails Gemfile entry", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "Gemfile"),
      `source "https://rubygems.org"

gem "rails"
gem "turbo-rails"
`,
      "utf8"
    );

    const findings = await detectSecondary(dir, resolvePack("rails"));

    expect(findings).toEqual([
      {
        id: "rails-hotwire",
        description: "Hotwire, Turbo, Stimulus, or Rails JavaScript app structure detected.",
        suggestSkills: [],
        suggestPackIds: [],
        notes: ["Hotwire detected; search skills.sh for Rails/Hotwire skills before adding one."]
      }
    ]);
  });

  test("detects Rails Hotwire from app/javascript structure", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "app", "javascript"), { recursive: true });
    await writeFile(join(dir, "app", "javascript", "application.js"), "import '@hotwired/turbo-rails'\n", "utf8");

    const findings = await detectSecondary(dir, resolvePack("rails"));

    expect(findings.map((finding) => finding.id)).toEqual(["rails-hotwire"]);
  });

  test("returns no secondary findings when detectors do not match", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, "Gemfile"),
      `source "https://rubygems.org"

gem "rails"
`,
      "utf8"
    );

    await expect(detectSecondary(dir, resolvePack("rails"))).resolves.toEqual([]);
  });
});

# Private registries

Farrier registries let teams publish private harness packs, hook payloads, and skill bundles under namespaced refs such as `@acme/python`. A registry is static JSON served from a private GitHub, GitLab, or Bitbucket repo, or from any HTTPS endpoint.

Registry items are fetched and validated as data. Hook files and generator commands are not executed while fetching or listing; hook files are written only when the user creates the harness.

A registry is something the team that owns it builds and hosts: they pick which packs to publish, write hook payloads, and choose the exact skills to ship in a bundle. Farrier does not search or browse across registries — items are always referenced by an exact ref (`@acme/demo`). A complete, schema-valid worked example — the same shapes shown below — is checked into this repo at [`examples/registries/acme/`](../examples/registries/acme/); farrier's own test suite serves it over a local HTTP server and drives the CLI against it in `tests/cli-e2e.test.ts`.

## Configure a registry

Farrier reads two config files and merges them:

- User config: `${XDG_CONFIG_HOME:-~/.config}/farrier/config.json`
- Project config: `<project>/farrier.config.json`

`FARRIER_CONFIG` overrides the user config path. Project config wins. Registry entries merge by namespace key, and a project-level namespace replaces the whole user-level entry for that namespace.

```json
{
  "useDefaultPacks": false,
  "registries": {
    "@acme": "github:acme/farrier-registry@main",
    "@platform": {
      "url": "https://harness.acme.dev/registry/{name}.json",
      "headers": {
        "Authorization": "Bearer ${ACME_HARNESS_TOKEN}"
      }
    }
  }
}
```

Namespace keys must match `^@[a-z0-9][a-z0-9-]*$`. `useDefaultPacks` defaults to `true`; when set to `false`, built-in packs are hidden from listing and detection, but they can still be resolved explicitly and used by remote packs via `extends`.

Header values may contain `${ENV_VAR}` placeholders. Expansion happens only at fetch time. Missing variables in explicit headers are hard errors that name the variable, not the value.

The same `farrier.config.json` / user config also holds a `models` key for per-backend, per-role model and reasoning-effort selection — see the [Model configuration](../README.md#model-configuration) section of the README.

## Hosting on private GitHub

Create a private repository with one `registry.json` index and one JSON file per item:

```text
farrier-registry/
  registry.json
  demo.json
  guard.json
  platform-skills.json
```

Example user config:

```json
{
  "registries": {
    "@acme": "github:acme/farrier-registry@main"
  }
}
```

Then export a token before running Farrier:

```bash
export GITHUB_TOKEN=github_pat_...
farrier registry list --dir .
farrier --stack @acme/demo --dry-run --dir .
farrier --stack @acme/demo --yes --dir .
```

The GitHub shorthand fetches `https://raw.githubusercontent.com/acme/farrier-registry/main/{name}.json`. Farrier adds `Authorization: Bearer ${GITHUB_TOKEN}` only when `GITHUB_TOKEN` is set and the config entry does not define explicit headers.

Provider shorthands:

| Shorthand | Item URL | Default auth header |
|---|---|---|
| `github:owner/repo[/dir][@ref]` | `https://raw.githubusercontent.com/owner/repo/<ref or HEAD>/[dir/]{name}.json` | `Authorization: Bearer ${GITHUB_TOKEN}` |
| `gitlab:group/project[//dir][@ref]` | `https://gitlab.com/api/v4/projects/<encoded project>/repository/files/<encoded path>/raw?ref=<ref or main>` | `PRIVATE-TOKEN: ${GITLAB_TOKEN}` |
| `bitbucket:workspace/repo[/dir][@ref]` | `https://api.bitbucket.org/2.0/repositories/workspace/repo/src/<ref or main>/[dir/]{name}.json` | `Authorization: Bearer ${BITBUCKET_TOKEN}` |

For self-hosted GitLab, Bitbucket, or any custom service, use a full URL template with `{name}`. URLs must be `https:` except for loopback test hosts such as `http://127.0.0.1:<port>/{name}.json`.

## Index schema

Farrier loads the index by requesting the reserved item name `registry`, so URL templates resolve it as `registry.json`. Item name `registry` is reserved and cannot be published as a pack, hook, or skill.

```json
{
  "schemaVersion": 1,
  "name": "@acme",
  "description": "Acme internal Farrier harnesses",
  "items": [
    {
      "name": "demo",
      "type": "pack",
      "description": "FastAPI service defaults",
      "version": "2026.07.03"
    }
  ]
}
```

The index `name` must equal the configured namespace. This prevents a config entry for `@acme` from silently serving another namespace.

## Pack item schema

Pack ids are derived from the namespace and item name. A pack item named `demo` in `@acme` resolves as `@acme/demo`; the JSON cannot claim a built-in id.

```json
{
  "schemaVersion": 1,
  "type": "pack",
  "name": "demo",
  "version": "2026.07.03",
  "description": "Acme FastAPI harness",
  "pack": {
    "extends": "python-fastapi",
    "skills": ["@acme/platform-skills"],
    "hooks": ["secret-shield", "@acme/guard"],
    "generator": {
      "command": "uv",
      "args": ["init", "--package", "."]
    }
  }
}
```

The `pack` object uses the same JSON-serializable fields as built-in packs: `extends`, `detect`, `generator`, `skills`, `hooks`, `toolPolicyRules`, `konsistentTemplate`, `konsistentTool`, `verbs`, `agentsRules`, and `secondaryDetectors`. `verbs` is required when the pack does not extend another pack. `konsistentTool` names the structure-linting tool (e.g. `"konpy"` for Python, defaults to `"konsistent"`); it drives the rendered config filename, justfile recipe name, and AGENTS.md label.

Remote `extends` may reference built-in packs or other registry packs, including another namespace. Farrier rejects extends cycles.

## Hook item schema

Hook items carry full file payloads. Farrier writes them under `.claude/hooks/@<namespace>/<hook-name>/`.

```json
{
  "schemaVersion": 1,
  "type": "hook",
  "name": "guard",
  "version": "2026.07.03",
  "description": "Acme repository guard",
  "hook": {
    "hookVersion": 1,
    "runner": "bash",
    "entry": "guard.sh",
    "events": [
      { "event": "PreToolUse", "matcher": "Bash" }
    ],
    "files": [
      {
        "path": "guard.sh",
        "content": "#!/usr/bin/env bash\nexit 0\n",
        "executable": true
      }
    ]
  }
}
```

`runner` defaults to `python3` and may be `python3`, `bash`, or `bun`. `entry` must match one file path. File paths must be relative and cannot contain `..`, start with `/`, or start with `\`. The entry file is always rendered executable; other files follow their `executable` flag.

The TUI Review step labels registry hook files with `registry hook — review contents before forging`. CLI `--dry-run` lists the same paths before anything is written.

## Skill item schema

Skill items are bundles of existing skill refs. They do not embed `SKILL.md` content in v1.

```json
{
  "schemaVersion": 1,
  "type": "skill",
  "name": "platform-skills",
  "version": "2026.07.03",
  "description": "Acme platform skill bundle",
  "skill": {
    "refs": [
      "github:acme/skills@deploy-runbook",
      "github:acme/skills@incident-review"
    ]
  }
}
```

When a pack includes `@acme/platform-skills` in its `skills`, Farrier expands the bundle to its `refs`. Installation still uses the existing `skills` CLI and `skills-lock.json` flow.

## Cache and pins

Farrier fetches registries network-first and writes a disk cache to:

```text
${FARRIER_CACHE_DIR:-~/.cache/farrier}/registries/<namespace>/<name>.json
```

If a registry is unreachable, cached index and item files are used when present and warnings are marked as cached. This is what lets `farrier update` work offline for projects that already rendered a private registry pack.

Rendered projects record registry item pins in `.farrier.json`:

```json
{
  "registry": {
    "items": {
      "@acme/demo": {
        "type": "pack",
        "version": "2026.07.03",
        "sha256": "..."
      },
      "@acme/guard": {
        "type": "hook",
        "version": "2026.07.03",
        "sha256": "..."
      }
    }
  }
}
```

Pins are drift detection, not an install lock. `farrier update` compares fresh registry versions and sha256 values to the recorded pins and reports drift. `farrier update --yes` repairs rendered files and updates the pins.

## Trust model

Configuring a namespace is a trust grant for that namespace. Registry JSON is inert while it is fetched and listed, but registry packs can cause executable hook files to be written at harness-creation time. Remote packs may also define a `generator` command, which Farrier surfaces explicitly in `--dry-run` output and on the TUI Review step.

Farrier enforces these boundaries:

- Registry URLs are HTTPS-only outside loopback.
- Header values are never logged or stored in manifests.
- Remote items cannot claim built-in ids.
- Hook file paths cannot escape their namespaced hook directory.
- Hook payloads are visible before writing in both CLI dry-run and TUI Review.
- Existing all-built-in `.farrier.json` manifests stay version 1 and parse unchanged.

V1 exclusions:

- Skill items cannot embed skill contents.
- Registry pins are not enforced by the skills install lock.
- Provider shorthands target public hosted GitHub, GitLab, and Bitbucket only; self-hosted services use full URL templates.

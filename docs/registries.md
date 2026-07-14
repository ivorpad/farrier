# Private registries

Farrier registries let teams publish private harness packs, hook payloads, and skill bundles under namespaced refs such as `@acme/python`. A registry is static JSON served from a private GitHub, GitLab, or Bitbucket repo, or from any HTTPS endpoint.

Registry items are fetched and validated as data. Hook files are written only through an accepted harness-creation plan. Declared generator commands are metadata: Farrier reports them during creation but does not execute them while fetching, listing, previewing, or applying a harness.

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

Header values in user configuration may contain `${ENV_VAR}` placeholders. Expansion happens only at fetch time. Missing variables are hard errors that name the variable, not the value. Project-configured registries cannot attach ambient provider credentials or credential-bearing headers; move a private registry and its headers to user configuration.

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

The dry run identifies the explicitly selected pack, shows any detected stacks and their matched evidence, explains the harness behavior contributed by the resolved registry lineage, and classifies every file action. `--yes` applies only a clean plan. Review differing existing files first and use `--yes --force` only when replacement is intended; originals are copied to `.farrier-staging/backups/<timestamp>/`. Staged atomic commits revalidate the target and parents, and rollback preserves concurrent edits rather than overwriting them. Unsafe path blockers cannot be forced. If the target already contains `.farrier.json`, use `farrier update --dir .` instead of creation.

The GitHub shorthand fetches `https://raw.githubusercontent.com/acme/farrier-registry/main/{name}.json`. Farrier adds `Authorization: Bearer ${GITHUB_TOKEN}` only when `GITHUB_TOKEN` is set and the config entry does not define explicit headers.

Provider shorthands:

| Shorthand | Item URL | Default auth header |
|---|---|---|
| `github:owner/repo[/dir][@ref]` | `https://raw.githubusercontent.com/owner/repo/<ref or HEAD>/[dir/]{name}.json` | `Authorization: Bearer ${GITHUB_TOKEN}` |
| `gitlab:group/project[//dir][@ref]` | `https://gitlab.com/api/v4/projects/<encoded project>/repository/files/<encoded path>/raw?ref=<ref or main>` | `PRIVATE-TOKEN: ${GITLAB_TOKEN}` |
| `bitbucket:workspace/repo[/dir][@ref]` | `https://api.bitbucket.org/2.0/repositories/workspace/repo/src/<ref or main>/[dir/]{name}.json` | `Authorization: Bearer ${BITBUCKET_TOKEN}` |

For self-hosted GitLab, Bitbucket, or any custom service, use a full URL template with `{name}`. URLs must be `https:` except for loopback test hosts such as `http://127.0.0.1:<port>/{name}.json`.

**Troubleshooting a private repo that "isn't found":** GitHub, GitLab, and Bitbucket all return 404, not 401/403, for unauthenticated access to a private repository or project — they don't confirm it exists. A provider shorthand only sends its default header when the matching token env var is set, so a forgotten or expired `GITHUB_TOKEN`/`GITLAB_TOKEN`/`BITBUCKET_TOKEN` looks exactly like a typo in the ref. Farrier detects this case and appends "If this is a private repository, set `<TOKEN>` and retry" to the not-found error whenever the token was never set in the first place — if you see that hint, the item name is very likely fine and the token is the problem.

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

The `pack` object uses the same JSON-serializable fields as built-in packs: `extends`, `detect`, `generator`, `skills`, `hooks`, `toolPolicyRules`, `konsistentTemplate`, `konsistentTool`, `verbs`, `agentsRules`, and `secondaryDetectors`. `verbs` is required when the pack does not extend another pack. `konsistentTool` names the structure-linting tool (e.g. `"konpy"` for Python, defaults to `"konsistent"`); it drives the rendered config filename, justfile recipe name, and AGENTS.md label. `generator` documents the native scaffolding command associated with the pack. The creation plan surfaces its command and source as `declared-not-run`; Farrier never executes it, so users and automation retain control over project-code generation.

Remote `extends` may reference built-in packs or other registry packs, including another namespace. Farrier rejects extends cycles.

## Hook item schema

Hook items carry full file payloads. Farrier writes them under `.claude/hooks/@<namespace>/<hook-name>/`.

Registry hook event declarations currently describe the Claude hook payload contract only. The registry schema has no explicit Codex event/payload compatibility metadata, so Farrier does not insert remote hooks into `.codex/hooks.json`, even when Codex is selected. Built-in hooks use the tested shared payload contract; remote Codex binding requires a future schema extension rather than inference from matching event names.

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

The TUI Review step and CLI `--dry-run` expose each executable's registry ref, version, source identity, item digest, content digest, previous bytes when they differ, and complete reviewed bytes. JSON carries the same provenance and untruncated content. Apply recomputes the reviewed plan digest and refuses changed bytes.

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

When a pack includes `@acme/platform-skills` in its `skills`, Farrier expands the bundle to its `refs`. Headless creation installs those selected refs for Claude Code and Codex by default using the existing `skills` CLI and `skills-lock.json` flow. If some installs fail after the harness files are applied, creation exits nonzero and prints an exact retry command for each failed ref. `--no-skills` is the explicit offline opt-out: refs remain recorded, but installation and lockfile changes are skipped. Both preview and apply support `--json`.

## Cache and pins

Farrier fetches registries network-first with bounded time and redirects, validates every redirect hop, and writes source-bound cache entries atomically to:

```text
${FARRIER_CACHE_DIR:-~/.cache/farrier}/registries/<namespace>/<name>.json
```

If a registry is unreachable, a cache entry is used only when its normalized source identity and payload digest validate. Corrupt or cross-source cache data is rejected. Warnings state when validated cached data was used.

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

Pins bind rendered registry items to version, digest, and source identity. Exact offline resolution uses those validated pinned bytes; catalog listing may still report a newer version as drift. Legacy source-unbound pins remain readable with an explicit migration warning and are never silently rebound.

## Trust model

Configuring a namespace is a trust grant for that namespace. Registry JSON is inert while it is fetched and listed, but registry packs can cause executable hook files to be written through an accepted harness-creation plan. Remote packs may also define a `generator` command, which Farrier surfaces explicitly in `--dry-run` output and on the TUI Review step but does not execute.

Farrier enforces these boundaries:

- Registry URLs are HTTPS-only outside loopback.
- Header values are never logged or stored in manifests.
- Remote items cannot claim built-in ids.
- Hook file paths cannot escape their namespaced hook directory.
- Hook payload paths, purposes, actions, provenance, digests, previous bytes, and complete reviewed bytes are visible before writing in human, JSON, and TUI review.
- Existing differing files require reviewed `--force` replacement and receive recoverable backups; path blockers remain unforceable.
- Existing Farrier manifests route to `farrier update` rather than being reset by creation.
- Existing all-built-in `.farrier.json` manifests stay version 1 and parse unchanged.

V1 exclusions:

- Skill items cannot embed skill contents.
- Registry pins are not enforced by the skills install lock.
- Pack generator commands are declared and reported, not executed by harness creation.
- Provider shorthands target public hosted GitHub, GitLab, and Bitbucket only; self-hosted services use full URL templates.

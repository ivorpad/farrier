# Example registry: `@acme`

A complete, schema-valid private registry — the same shapes documented in
[`docs/registries.md`](../../docs/registries.md) — checked into this repo so
there is always a concrete, runnable example instead of a doc describing a
format nobody can point at.

Farrier does not (yet) offer search or a UI for browsing registries. A
registry is something a client, enterprise, or team builds and hosts
themselves: they pick the packs, hook payloads, and — for skill bundles —
the exact skills they want to ship, then publish namespaced JSON that
farrier fetches by exact ref (`@acme/demo`, `@acme/guard`, ...). This
directory is what that looks like once built.

It exists for two reasons:

1. **A worked example for teams building their own registry.** Copy this
   directory's shape (one `registry.json` index plus one JSON file per item)
   into a private repo, adjust the namespace, ids, and payloads, and you have
   a registry farrier can consume.
2. **A fixture for farrier's own test suite.** `tests/cli-e2e.test.ts` serves
   this directory over a local HTTP server and drives the real CLI against
   it — `registry list`, `--dry-run`, a full `--yes` render, and manifest
   pinning — so the registry pipeline (config → fetch → schema validation →
   pack resolution → render) is tested against real files on disk instead of
   only inline JSON literals.

## What's in it

- `registry.json` — the index, namespace `@acme`, listing all three items
  below.
- `demo.json` — a **pack** that extends the builtin `python-fastapi` pack,
  adds the `@acme/guard` hook, and pulls in the `@acme/platform-skills`
  bundle.
- `guard.json` — a **hook**: a `PreToolUse(Bash)` guard that blocks
  `docker push` to anywhere but Acme's internal registry.
- `platform-skills.json` — a **skill** bundle: the specific skill refs Acme's
  platform team chose to ship with this pack. Nothing here is discovered —
  the team that owns the registry selects these refs up front, and any
  farrier user who references `@acme/platform-skills` gets exactly that set.

## Try it locally

```bash
bun --eval '
  const dir = "examples/registries/acme";
  Bun.serve({
    port: 4873,
    async fetch(req) {
      const name = new URL(req.url).pathname.slice(1);
      try {
        return new Response(await Bun.file(`${dir}/${name}`).text(), {
          headers: { "content-type": "application/json" }
        });
      } catch {
        return new Response("missing", { status: 404 });
      }
    }
  });
  console.log("serving examples/registries/acme on http://127.0.0.1:4873");
'
```

Then, in a scratch project:

```json
// farrier.config.json
{ "registries": { "@acme": "http://127.0.0.1:4873/{name}.json" } }
```

```bash
farrier registry list --dir .
farrier --stack @acme/demo --dry-run --dir .
```

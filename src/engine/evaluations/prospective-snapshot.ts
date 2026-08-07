import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ProspectiveSnapshotEvidence = {
  sourceCommit: string;
  sourceTree: string;
  stagedTree: string;
  stagedRootCommit: string;
  contentManifestSha256: string;
  referenceCount: number;
  remoteCount: number;
  unreachableObjectCount: number;
  sourceStateSha256: string;
  historyMode: "snapshot-root";
  noFutureObjects: true;
};

const SHA1 = /^[0-9a-f]{40}$/;
const gitEnvironment = {
  PATH: Bun.env.PATH ?? "/usr/bin:/bin",
  HOME: "/var/empty",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  GIT_AUTHOR_NAME: "Farrier Evaluation",
  GIT_AUTHOR_EMAIL: "farrier-evaluation@example.invalid",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Farrier Evaluation",
  GIT_COMMITTER_EMAIL: "farrier-evaluation@example.invalid",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

async function run(
  command: string[],
  options: { cwd: string; stdin?: ReadableStream<Uint8Array> },
): Promise<string> {
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    env: gitEnvironment,
    stdin: options.stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command[0]} ${command.slice(1).join(" ")} failed (${exitCode}): ${stderr.trim()}`);
  }
  return stdout.trim();
}

async function emptyDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const entries = await readdir(path);
  if (entries.length !== 0) throw new Error(`Snapshot destination is not empty: ${path}`);
}

async function sourceStateDigest(sourceRepository: string): Promise<string> {
  const values = await Promise.all([
    run(["git", "rev-parse", "HEAD"], { cwd: sourceRepository }),
    run(["git", "rev-parse", "HEAD^{tree}"], { cwd: sourceRepository }),
    run(["git", "status", "--porcelain=v2", "-z"], { cwd: sourceRepository }),
    run(["git", "for-each-ref", "--format=%(refname)%00%(objectname)"], { cwd: sourceRepository }),
  ]);
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

async function manifestDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!prefix && entry.name === ".git") continue;
      const path = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stats = await lstat(path);
      if (stats.isDirectory()) {
        hash.update(`directory\0${relative}\0${stats.mode & 0o777}\0`);
        await walk(path, relative);
      } else if (stats.isSymbolicLink()) {
        hash.update(`symlink\0${relative}\0${await readlink(path)}\0`);
      } else if (stats.isFile()) {
        hash.update(`file\0${relative}\0${stats.mode & 0o777}\0`);
        hash.update(await readFile(path));
        hash.update("\0");
      } else {
        throw new Error(`Snapshot contains unsupported filesystem entry: ${relative}`);
      }
    }
  };
  await walk(root, "");
  return hash.digest("hex");
}

async function archiveInto(sourceRepository: string, commit: string, destination: string): Promise<void> {
  const archive = Bun.spawn(["git", "archive", "--format=tar", commit], {
    cwd: sourceRepository,
    env: gitEnvironment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const extraction = run(["tar", "-xf", "-", "-C", destination], {
    cwd: destination,
    stdin: archive.stdout,
  });
  const [archiveError, archiveExitCode] = await Promise.all([
    new Response(archive.stderr).text(),
    archive.exited,
  ]);
  await extraction;
  if (archiveExitCode !== 0) {
    throw new Error(`git archive failed (${archiveExitCode}): ${archiveError.trim()}`);
  }
}

/**
 * Materializes one exact committed tree without copying the source repository's
 * refs, reflogs, remotes, stashes, or later objects. The staged repository gets
 * a single synthetic root commit so an agent can use normal Git diff commands.
 */
export async function stageProspectiveSnapshot(input: {
  sourceRepository: string;
  commit: string;
  expectedTree: string;
  destination: string;
}): Promise<ProspectiveSnapshotEvidence> {
  if (!SHA1.test(input.commit) || !SHA1.test(input.expectedTree)) {
    throw new Error("Prospective snapshots currently require full SHA-1 commit and tree ids.");
  }
  const sourceStateBefore = await sourceStateDigest(input.sourceRepository);
  const sourceTree = await run(["git", "rev-parse", `${input.commit}^{tree}`], {
    cwd: input.sourceRepository,
  });
  if (sourceTree !== input.expectedTree) {
    throw new Error(`Source commit tree ${sourceTree} does not match expected tree ${input.expectedTree}.`);
  }

  await emptyDirectory(input.destination);
  await archiveInto(input.sourceRepository, input.commit, input.destination);
  const emptyTemplate = await mkdtemp(join(tmpdir(), "farrier-empty-git-template-"));
  try {
    await run([
      "git", "init", "--quiet", "--initial-branch=farrier-eval", `--template=${emptyTemplate}`,
    ], { cwd: input.destination });
  } finally {
    await rm(emptyTemplate, { recursive: true, force: true });
  }
  await run(["git", "add", "--force", "--all"], { cwd: input.destination });
  const stagedTree = await run(["git", "write-tree"], { cwd: input.destination });
  if (stagedTree !== input.expectedTree) {
    throw new Error(
      `Materialized tree ${stagedTree} does not match expected tree ${input.expectedTree}. `
      + "Check export-ignore rules, submodules, filters, or unsupported file modes.",
    );
  }
  const stagedRootCommit = await run([
    "git", "commit-tree", stagedTree, "-m", "frozen task snapshot",
  ], { cwd: input.destination });
  await run(["git", "update-ref", "refs/heads/farrier-eval", stagedRootCommit], { cwd: input.destination });
  await run(["git", "symbolic-ref", "HEAD", "refs/heads/farrier-eval"], { cwd: input.destination });
  const committedTree = await run(["git", "rev-parse", "HEAD^{tree}"], { cwd: input.destination });
  if (committedTree !== input.expectedTree) {
    throw new Error(`Synthetic root commit changed the staged tree to ${committedTree}.`);
  }
  const refs = (await run(["git", "for-each-ref", "--format=%(refname)"], { cwd: input.destination }))
    .split("\n")
    .filter(Boolean);
  const remotes = (await run(["git", "remote"], { cwd: input.destination })).split("\n").filter(Boolean);
  const unreachable = (await run(["git", "fsck", "--no-reflogs", "--unreachable"], { cwd: input.destination }))
    .split("\n")
    .filter(Boolean);
  if (refs.length !== 1 || remotes.length !== 0 || unreachable.length !== 0) {
    throw new Error(
      `Snapshot isolation failed: refs=${refs.length}, remotes=${remotes.length}, unreachable=${unreachable.length}.`,
    );
  }
  const sourceStateAfter = await sourceStateDigest(input.sourceRepository);
  if (sourceStateAfter !== sourceStateBefore) {
    throw new Error("Source repository state changed while the snapshot was staged.");
  }
  return {
    sourceCommit: input.commit,
    sourceTree,
    stagedTree,
    stagedRootCommit,
    contentManifestSha256: await manifestDigest(input.destination),
    referenceCount: refs.length,
    remoteCount: remotes.length,
    unreachableObjectCount: unreachable.length,
    sourceStateSha256: sourceStateBefore,
    historyMode: "snapshot-root",
    noFutureObjects: true,
  };
}

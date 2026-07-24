import type { FailureSignal } from "./learn-signals";
import type { SessionEvidence, SteerSignal } from "./session-evidence";

/**
 * The gate catalog: the vocabulary export matches lessons against.
 *
 * Seeded from the hand-authored WalkLedger playbook (ios-prd-playbook
 * references/gates.md, ShipatonStudio workspace, 2026-07-23). Each entry
 * carries a portable statement (what would transfer to a web or Android
 * playbook), a stack binding (how it ran on iOS), the transcript symptom a
 * classifier should look for, and origin evidence so a gate can be challenged
 * later instead of ossifying.
 *
 * The signature patterns are routing hints and cheap pre-annotations, not
 * gates: they mark evidence "this looks like gate X" so a reviewer and the
 * LLM matcher start oriented. Matching is LLM-first; the model may also
 * propose NEW catalog entries, which stay review-gated (it never invents
 * gates that silently become defaults).
 */

export type GateCatalogEntry = {
  id: string;
  /** "gate" is a phase stop; "style" is an operating-style rule. */
  kind: "gate" | "style";
  /** Playbook ordering (P0-first). Style rules sort after gates. */
  order: number;
  portable: string;
  /** Stack the binding text is written for. */
  stack: string;
  binding: string;
  symptom: string;
  origin: string;
  /** Case-insensitive regex sources; hints only, matched over steers and failure samples. */
  signatures: string[];
};

export const seedGateCatalog: readonly GateCatalogEntry[] = [
  {
    id: "skeleton-before-features",
    kind: "gate",
    order: 1,
    portable: "Build a navigable skeleton of the whole UI with placeholder data and get it approved before writing feature logic.",
    stack: "ios",
    binding: "SwiftUI screens with stub data, every route reachable; DESIGN_DIRECTION.md written first; screenshots light/dark at smallest and AX5 Dynamic Type.",
    symptom: "The user rejects UI quality after features already exist; a redesign is demanded mid-build.",
    origin: '"the UI is stupidly shitty as you haven\'t used any of the skills" (day 1), "they\'re looking really awful and off", "extremely confusing" (day 2). The redesign consumed the second afternoon; complaints stopped once the screenshot review loop existed.',
    signatures: [
      "\\b(?:ui|design|screens?|looks?|looking)\\b[^.\\n]{0,60}\\b(?:shitty|awful|ugly|horrible|confusing)\\b",
      "\\bredesign\\b",
      "haven'?t used any of the skills"
    ]
  },
  {
    id: "design-direction-before-ui",
    kind: "gate",
    order: 2,
    portable: "A short written design system (navigation model, color roles, component inventory, state patterns) exists before the first screen is styled.",
    stack: "ios",
    binding: "DESIGN_DIRECTION.md from the studio template; materials/glass only after hierarchy and state behavior work.",
    symptom: "Screens drift apart in style; alignment and hierarchy complaints repeat across screens.",
    origin: "WalkLedger added DESIGN_DIRECTION.md mid-build as a reaction; its final docs mandate it before UI.",
    signatures: [
      "design[ _-]?direction",
      "\\bdesign system\\b",
      "\\b(?:alignment|hierarchy|spacing)\\b[^.\\n]{0,50}\\b(?:off|wrong|inconsistent|broken)\\b"
    ]
  },
  {
    id: "visual-review-multi",
    kind: "gate",
    order: 3,
    portable: "No UI change is complete until a reviewer who sees only the rendered screens approves them.",
    stack: "ios",
    binding: "`ux_hig_reviewer` subagent over the fresh screenshot set, in parallel with `ios_reviewer` on the code.",
    symptom: 'The user manually demands screenshots and human-style review ("take a screenshot of every page", "human-like reviewers reviewing screenshots").',
    origin: "Two verbatim steers on day 2; the user supplied this gate by hand.",
    signatures: [
      "screenshots? of every",
      "screenshots?[^.\\n]{0,40}\\b(?:page|screen)s?\\b",
      "human-?like reviewers?",
      "\\b(?:review|critique|criti\\w*)\\b[^.\\n]{0,40}screenshots?"
    ]
  },
  {
    id: "vertical-slice-before-capabilities",
    kind: "gate",
    order: 4,
    portable: "A deterministic end-to-end path exists and passes before any AI or hardware-dependent feature is added.",
    stack: "ios",
    binding: "Golden path with deterministic fallbacks; no SpeechAnalyzer/FoundationModels/Vision yet.",
    symptom: "Capability bugs and product bugs are entangled; nothing works while everything is half-integrated.",
    origin: 'Crystallized in WalkLedger\'s CODEX_GOAL milestone ordering ("reliability floor + App Review fallback").',
    signatures: ["golden path", "vertical slice", "deterministic fallback", "reliability floor"]
  },
  {
    id: "one-capability-per-change",
    kind: "gate",
    order: 5,
    portable: "Integrate one unverified external capability per change, never several.",
    stack: "ios",
    binding: "One framework (Speech, Vision, camera, RevenueCat, App Intents) per milestone; read the pitfalls reference before each integration; keep build caches inside the workspace.",
    symptom: "A large change fails and the failing framework cannot be isolated.",
    origin: 'WalkLedger IMPLEMENT.md rule "never combine multiple unverified framework integrations in one large change", written after day-1 churn (239 builds).',
    signatures: [
      "ModuleCache[^\\n]{0,80}Operation not permitted",
      "@unknown default",
      "one (?:framework|capability) (?:at a time|per)",
      "\\.dia['\"]? [^\\n]{0,40}Operation not permitted"
    ]
  },
  {
    id: "capability-degrades-not-fails",
    kind: "gate",
    order: 6,
    portable: "A missing asset, permission, or entitlement is a designed degraded state with UI, not an error path.",
    stack: "ios",
    binding: "Availability checks per capability; a missing speech asset shows a download state; camera/network never assumed available.",
    symptom: 'Crash or dead-end screen on a device the developer never tested; "worked in simulator".',
    origin: "On-device speech-asset download crashed the app; the first capability gate sent every device to the downloader.",
    signatures: [
      "worked in (?:the )?simulator",
      "asset[^.\\n]{0,40}\\b(?:download|missing)\\b",
      "crash(?:ed|es)?[^.\\n]{0,40}\\b(?:device|iphone|ipad)\\b"
    ]
  },
  {
    id: "persist-before-capability",
    kind: "gate",
    order: 7,
    portable: "User data is persisted before being handed to any fallible capability.",
    stack: "ios",
    binding: "Save the recording, then transcribe; validate model output before any persistence write.",
    symptom: "A capability failure loses user work.",
    origin: "WalkLedger decision log, written after the recording/transcription flow confused on-device testing.",
    signatures: ["save the recording", "lost (?:my |the )?(?:recording|data|work)", "then transcribe"]
  },
  {
    id: "device-verification",
    kind: "gate",
    order: 8,
    portable: "Hardware- and permission-dependent features are verified on real hardware before being marked complete.",
    stack: "ios",
    binding: "Physical-device checklist per capability feature; simulator evidence is insufficient; no device means `blocked_external`.",
    symptom: 'The user reports hardware failures the agent cannot reproduce ("start failed when I started recording after I added all the permissions").',
    origin: "Recording failure and speech-asset crash were both discoverable only on the user's iPhone; the user was the eyes.",
    signatures: [
      "start(?:ed)? failed when i",
      "after i added all the permissions",
      "\\bon (?:my|the) i?phone\\b",
      "physical device"
    ]
  },
  {
    id: "name-preflight",
    kind: "gate",
    order: 9,
    portable: "Check the distribution channel accepts your product name before the name spreads through code and docs.",
    stack: "ios",
    binding: "App Store search plus trademark scan at P0; two fallback names recorded; name provisional until the store record exists.",
    symptom: "A rename lands mid-release and touches the whole repo.",
    origin: 'ASC rejected "FieldBrief" as taken; full repo rename to WalkLedger mid-release; the folder still carries the dead name.',
    signatures: [
      "rename the app",
      "name (?:is |was |already )?taken",
      "app store[^.\\n]{0,40}\\b(?:name|rejected)\\b"
    ]
  },
  {
    id: "human-stop-gate-irreversible",
    kind: "gate",
    order: 10,
    portable: "Irreversible or money-touching actions get an explicit per-action human approval; everything before them is staged and waiting.",
    stack: "ios",
    binding: 'Store record creation, key authorization, submission ("authorize replacement key; do not submit yet" was a verbatim user gate).',
    symptom: "The user interrupts to impose a stop before a release action.",
    origin: "Day-2 release operations; the user inserted this gate manually twice.",
    signatures: [
      "do not submit",
      "don'?t submit",
      "authorize[^.\\n]{0,40}key",
      "do not (?:publish|release|pay|purchase)"
    ]
  },
  {
    id: "evidence-before-complete",
    kind: "gate",
    order: 11,
    portable: "A feature is complete only with recorded evidence (proof, command, timestamp); bulk status changes are forbidden.",
    stack: "ios",
    binding: "Evidence-ledger row per feature plus manifest status rules; signing proven by codesign output on the built artifact, never metadata.",
    symptom: '"Done" claims that unravel on inspection; archive metadata claiming signatures codesign cannot find.',
    origin: "WalkLedger's signing-proof incident and its forbidden_shortcuts list.",
    signatures: [
      "\\bcodesign\\b",
      "what should have been achieved",
      "claim(?:ed|s)?[^.\\n]{0,30}\\b(?:done|complete)\\b"
    ]
  },
  {
    id: "one-task-one-session",
    kind: "gate",
    order: 12,
    portable: "One milestone per fresh session; durable state lives in the repo docs, not in chat memory. Long mixed sessions degrade the model.",
    stack: "ios",
    binding: "One chat (or worktree chat) per milestone; before ending a session, write plan progress and the ledger row so the next session boots from files.",
    symptom: "Context compactions piling up mid-session; error rate climbing with session length; one session mixing scaffold, UI, and release work.",
    origin: "The 62MB day-1 WalkLedger session hit 17 context compactions, 239 build runs, and ~30 failed builds while mixing everything; later single-purpose sessions ran 0-3 errors each.",
    signatures: ["context compact", "one milestone per session", "fresh session", "handoff (?:doc|document)"]
  },
  {
    id: "execute-dont-interrogate",
    kind: "style",
    order: 13,
    portable: "An explicit invocation means the user is ready; act, and reserve questions for irreversible decisions.",
    stack: "ios",
    binding: "Lives in the playbook operating style, not as a phase.",
    symptom: "The user snaps at clarifying-question menus.",
    origin: '"when i invoke the skill is coz im ready. no questions asked."',
    signatures: ["no quest\\w{0,4}ns? asked", "stop asking", "\\bi'?m ready\\b", "just (?:do|execute) it"]
  }
];

export type GateHint = {
  gateId: string;
  /** The signature source that matched, for review display. */
  signature: string;
};

export type AnnotatedSteer = SteerSignal & { hints: GateHint[] };
export type AnnotatedFailureCluster = FailureSignal & { hints: GateHint[] };

export type AnnotatedSessionEvidence = {
  steers: AnnotatedSteer[];
  failureClusters: AnnotatedFailureCluster[];
};

function hintsForText(text: string, catalog: readonly GateCatalogEntry[]): GateHint[] {
  const hints: GateHint[] = [];
  for (const entry of catalog) {
    for (const signature of entry.signatures) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(signature, "i");
      } catch {
        continue;
      }
      if (pattern.test(text)) {
        hints.push({ gateId: entry.id, signature });
        break;
      }
    }
  }
  return hints;
}

/**
 * Pre-annotates evidence with catalog hints. Purely additive: every steer and
 * cluster stays in the output whether or not anything matched (annotation
 * routes attention; it never filters evidence).
 */
export function annotateSessionEvidence(
  evidence: SessionEvidence,
  catalog: readonly GateCatalogEntry[] = seedGateCatalog
): AnnotatedSessionEvidence {
  return {
    steers: evidence.steers.map((steer) => ({ ...steer, hints: hintsForText(steer.text, catalog) })),
    failureClusters: evidence.failureClusters.map((cluster) => ({
      ...cluster,
      hints: hintsForText([cluster.key, ...cluster.samples].join("\n"), catalog)
    }))
  };
}

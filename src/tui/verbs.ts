export type HarnessVerb = { gerund: string; past: string };

// A Claude-Code-spinner-style rotation for the "writing" phase: half
// smith/farrier-flavored (the harness is a shoe being fitted), half the
// playful making-something gerunds Claude Code cycles through. "Harnessing"
// leads so the tool's own verb is one of the possible picks.
// Each `past` is the plain past tense that grammatically closes the sentence
// "Harness <past>." for its gerund.
export const harnessVerbs: HarnessVerb[] = [
  // Smith / farrier flavored.
  { gerund: "Harnessing", past: "harnessed" },
  { gerund: "Tempering", past: "tempered" },
  { gerund: "Hammering", past: "hammered" },
  { gerund: "Shoeing", past: "shod" },
  { gerund: "Quenching", past: "quenched" },
  { gerund: "Annealing", past: "annealed" },
  { gerund: "Burnishing", past: "burnished" },
  { gerund: "Smelting", past: "smelted" },
  { gerund: "Casting", past: "cast" },
  { gerund: "Riveting", past: "riveted" },
  { gerund: "Welding", past: "welded" },
  { gerund: "Soldering", past: "soldered" },
  { gerund: "Grinding", past: "ground" },
  { gerund: "Filing", past: "filed" },
  { gerund: "Stoking", past: "stoked" },
  { gerund: "Fettling", past: "fettled" },
  { gerund: "Alloying", past: "alloyed" },
  { gerund: "Rasping", past: "rasped" },
  { gerund: "Nailing", past: "nailed" },
  { gerund: "Clinching", past: "clinched" },
  { gerund: "Fitting", past: "fitted" },
  { gerund: "Shaping", past: "shaped" },
  { gerund: "Honing", past: "honed" },
  { gerund: "Etching", past: "etched" },
  { gerund: "Sharpening", past: "sharpened" },
  // Playful Claude-Code-style making gerunds.
  { gerund: "Baking", past: "baked" },
  { gerund: "Brewing", past: "brewed" },
  { gerund: "Iterating", past: "iterated" },
  { gerund: "Creating", past: "created" },
  { gerund: "Weaving", past: "woven" },
  { gerund: "Sculpting", past: "sculpted" },
  { gerund: "Composing", past: "composed" },
  { gerund: "Conjuring", past: "conjured" },
  { gerund: "Assembling", past: "assembled" },
  { gerund: "Bootstrapping", past: "bootstrapped" },
  { gerund: "Kindling", past: "kindled" },
  { gerund: "Polishing", past: "polished" },
  { gerund: "Crafting", past: "crafted" },
  { gerund: "Building", past: "built" },
  { gerund: "Rendering", past: "rendered" },
  { gerund: "Summoning", past: "summoned" },
  { gerund: "Distilling", past: "distilled" },
  { gerund: "Percolating", past: "percolated" },
  { gerund: "Simmering", past: "simmered" },
  { gerund: "Fabricating", past: "fabricated" },
  { gerund: "Constructing", past: "constructed" },
  { gerund: "Molding", past: "molded" },
  { gerund: "Tinkering", past: "tinkered" },
  { gerund: "Whittling", past: "whittled" },
  { gerund: "Spinning", past: "spun" }
];

export function pickHarnessVerb(rand: () => number = Math.random): HarnessVerb {
  const index = Math.min(harnessVerbs.length - 1, Math.max(0, Math.floor(rand() * harnessVerbs.length)));
  return harnessVerbs[index];
}

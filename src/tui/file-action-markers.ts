/**
 * Word-adjacent markers for file actions on review screens. The review moment
 * is where a user decides whether farrier may write; single letters (A/=/!/R)
 * read as noise there, and "replace" is the one destructive action, so it gets
 * the most distinctive glyph. Always pair the list with `fileActionLegend`.
 */
export type FileAction = "create" | "unchanged" | "blocked" | "replace" | "update" | "merge";

export function fileActionMarker(action: FileAction): string {
  switch (action) {
    case "create":
      return "+";
    case "unchanged":
      return "=";
    case "blocked":
      return "⚠";
    case "replace":
      return "↻";
    case "update":
      return "U";
    case "merge":
      return "M";
  }
}

export const fileActionLegend = "+ new file · = no change · M merge · U permission fix · ⚠ blocked · ↻ overwrites existing";

/**
 * A readable word for each action, shown at the front of a file row so the
 * review moment needs no legend lookup. "Overwrites" is the one destructive
 * word and is coloured with the warn hue by callers.
 */
export function fileActionWord(action: FileAction): string {
  switch (action) {
    case "create":
      return "New";
    case "unchanged":
      return "No change";
    case "blocked":
      return "Blocked";
    case "replace":
      return "Overwrites";
    case "update":
      return "Permissions";
    case "merge":
      return "Appends";
  }
}

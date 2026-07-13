/**
 * pickedFile.ts — PURE (no fs/net/Node imports). The ONE place the
 * "manual file picker" import path lives in core:
 *
 *  - deriveArtifactName  — filename → artifact name (F5 / E9: strip .md.tmpl,
 *                          then a single trailing extension).
 *  - classifyPickedFile  — wrap parseClaudeFile with the no-frontmatter fallback
 *                          (F2 / E10 / E11): a bad-YAML / no-frontmatter file
 *                          still imports, but the result carries a human
 *                          `warning` so the UI can flag it (never silent).
 *  - isProbablyBinary    — NUL-byte / high-non-printable heuristic (used by the
 *                          daemon AFTER it reads a bounded prefix; lives here so
 *                          it is unit-testable without fs).
 *
 * See docs/loops/manual-file-picker-STATE.md PLAN §1 / §0.5 (F1–F5).
 */
import type { ArtifactKind, CanonicalArtifact } from "../ir/types.js";
import { parseClaudeFile } from "./scan.js";
import { parseMarker } from "../render/marker.js";

/**
 * deriveArtifactName — turn a file's basename into an artifact name (F5).
 * Rules, applied in order:
 *   1. A trailing `.tmpl` is stripped first (`ba.md.tmpl` → `ba.md`).
 *   2. A trailing `.md` is stripped (`ba.md` → `ba`).
 *   3. Otherwise, a single trailing `.<ext>` is stripped (`notes.txt` → `notes`).
 *   4. If none of the above apply, the basename is used as-is (`Makefile`).
 *
 * A leading dot is preserved as part of the name for dotfiles with no further
 * extension (e.g. `.gitignore` → `.gitignore`), matching "use the basename as-is"
 * when there is no strippable extension.
 */
export function deriveArtifactName(basename: string): string {
  let name = basename;

  // 1. strip a trailing `.tmpl` first (handles `.md.tmpl`, `.txt.tmpl`, …).
  if (name.endsWith(".tmpl")) {
    name = name.slice(0, -".tmpl".length);
  }

  // 2. strip a trailing `.md` (covers the now-unwrapped `ba.md` from `ba.md.tmpl`
  //    as well as a plain `architect.md`).
  if (name.endsWith(".md")) {
    return name.slice(0, -".md".length);
  }

  // 3. strip a single trailing extension if present — but only when the dot is
  //    not the first character (so `.gitignore` stays `.gitignore`, not "").
  const lastDot = name.lastIndexOf(".");
  if (lastDot > 0) {
    return name.slice(0, lastDot);
  }

  // 4. no strippable extension — use as-is.
  return name;
}

export interface ClassifyPickedFileResult {
  artifact: CanonicalArtifact;
  /** present ONLY when the frontmatter could not be parsed and a fallback
   *  artifact was built (F2). UI shows a ⚠ badge; artifact is still importable. */
  warning?: string;
}

const FALLBACK_WARNING =
  "Imported without frontmatter — name derived from filename, description empty.";

/**
 * classifyPickedFile — build a CanonicalArtifact from a manually-picked file's
 * raw content and a user-asserted `kind` (F4: the kind is honored verbatim, no
 * content sniffing). On success it delegates to parseClaudeFile and returns
 * `{ artifact }` with no warning. On ANY parse failure (missing/invalid
 * frontmatter — the two vpo failures) it builds a fallback artifact whose body
 * is the raw content (trimmed), description is empty, and status is "draft",
 * and returns a human `warning` (F2). This is the ONE place the no-frontmatter
 * fallback lives.
 *
 * The marker id (if the content already carries a `<!-- managed-by: symbion … -->`
 * marker) is reused for the fallback artifact's id so re-importing a
 * marker-carrying file is idempotent (E18); otherwise a fresh id is generated.
 */
export function classifyPickedFile(
  content: string,
  opts: { kind: ArtifactKind; name: string; nowIso?: string }
): ClassifyPickedFileResult {
  try {
    const artifact = parseClaudeFile(content, {
      name: opts.name,
      kind: opts.kind,
      nowIso: opts.nowIso,
    });
    return { artifact };
  } catch {
    // Fallback path (F2): frontmatter missing or invalid. Never throw — the
    // escape hatch's whole point is that this file still imports.
    const now = opts.nowIso ?? new Date().toISOString();
    const marker = parseMarker(content);
    // Strip any trailing managed marker from the body FIRST (same regex as
    // parseClaudeFile/scan.ts:33) — otherwise a marker-carrying file that hits
    // the fallback would keep the marker inside its body and get a duplicated
    // marker on the next render/publish (resolves /review non-blocking note 1).
    const body = content
      .replace(/\n*<!--\s*managed-by:[\s\S]*?-->\s*$/, "")
      .replace(/\n+$/, "")
      .replace(/^\n+/, "")
      .trim();

    const artifact: CanonicalArtifact = {
      id: marker?.id ?? cryptoRandomId(),
      kind: opts.kind,
      name: opts.name,
      description: "",
      body,
      meta: {
        // INTENTIONAL divergence from parseClaudeFile/scan.ts's marker path
        // (which sets status "published" + version = marker.version when a
        // marker is present): the fallback is reached ONLY because the file
        // failed to parse, so we do NOT trust it as a cleanly-published
        // artifact — it stays "draft"/"draft" even if a marker id was reused
        // for idempotency (E18). /review non-blocking note 2.
        version: "draft",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      },
    };

    if (opts.kind === "command") {
      artifact.usesArguments = body.includes("$ARGUMENTS");
    }

    return { artifact, warning: FALLBACK_WARNING };
  }
}

/**
 * isProbablyBinary — heuristic to reject non-text files before importing them
 * as an "agent"/"command". Pure — the daemon reads a bounded prefix off disk
 * and passes it here.
 *
 * A sample is considered binary if EITHER:
 *   - it contains a NUL byte (the classic text/binary discriminator), OR
 *   - more than 30% of its bytes are non-printable control characters
 *     (outside the usual tab/newline/carriage-return whitespace and the
 *     printable ASCII/UTF-8 continuation range).
 *
 * An empty sample is treated as text (`false`) — an empty file is a legitimate
 * (if useless) text file, not binary.
 */
export function isProbablyBinary(sample: string | Uint8Array): boolean {
  const bytes = typeof sample === "string" ? encodeToBytes(sample) : sample;
  if (bytes.length === 0) return false;

  let control = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0) return true; // NUL byte → definitely binary.
    // Count C0 control chars that are NOT tab (9), LF (10), CR (13), and DEL (127).
    if ((b < 32 && b !== 9 && b !== 10 && b !== 13) || b === 127) {
      control++;
    }
  }

  return control / bytes.length > 0.3;
}

/**
 * encodeToBytes — dependency-free UTF-8 encoder for the string overload of
 * isProbablyBinary. Kept local so core stays free of TextEncoder/Node
 * assumptions; the byte pattern only needs to expose NUL + control bytes, which
 * this reproduces faithfully for the checked ranges.
 */
function encodeToBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
      // surrogate pair
      const hi = code;
      const lo = s.charCodeAt(i + 1);
      const cp = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
      i++;
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

/** Minimal dependency-free random id generator (UUID v4-ish) — pure, no Node `crypto`.
 *  Mirrors parse/scan.ts's own generator so fallback ids are shaped identically. */
function cryptoRandomId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const tpl = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return tpl.replace(/[xy]/g, (c) => {
    if (c === "y") {
      return ((Math.floor(Math.random() * 4) + 8) % 16).toString(16);
    }
    return hex();
  });
}

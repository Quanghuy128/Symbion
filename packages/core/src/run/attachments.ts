/**
 * attachments — pure image-attachment rules for runs (run-image-paste PLAN §P.1).
 * No fs/net/Node imports (bytes are `Uint8Array`, never `Buffer`): the web UI and
 * the daemon share these limits, the magic-byte sniff, the consent digest and the
 * stdin message builder, so the two sides can never drift.
 *
 * MB here means MiB everywhere (UI copy included).
 */
import { sha256Hex } from "../util/sha256.js";

export const RUN_ATTACHMENT_LIMITS = {
  maxCount: 5,
  maxBytesEach: 5 * 1024 * 1024,
  maxBytesTotal: 20 * 1024 * 1024,
  mediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
} as const;

export type RunAttachmentMediaType = (typeof RUN_ATTACHMENT_LIMITS.mediaTypes)[number];

function startsWith(bytes: Uint8Array, at: number, sig: readonly number[]): boolean {
  if (bytes.length < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return false;
  return true;
}

/**
 * sniffImageType — magic bytes ONLY (the client-claimed MIME is never trusted).
 * Anchored at offset 0. SVG/XML text, ZIP, PDF, BMP, HEIC, empty → null.
 */
export function sniffImageType(bytes: Uint8Array): RunAttachmentMediaType | null {
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    startsWith(bytes, 0, [0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp";
  }
  return null;
}

export function extForMediaType(t: RunAttachmentMediaType): "png" | "jpg" | "gif" | "webp" {
  switch (t) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
  }
}

export type AttachmentSetResult =
  | { ok: true }
  | { ok: false; reason: "count" | "empty" | "too-large" | "total" | "type"; index?: number };

/** validateAttachmentSet — shared by the web pre-check, preflight params and startRun. */
export function validateAttachmentSet(items: { size: number; mediaType: string }[]): AttachmentSetResult {
  const L = RUN_ATTACHMENT_LIMITS;
  if (items.length > L.maxCount) return { ok: false, reason: "count" };
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (!(L.mediaTypes as readonly string[]).includes(it.mediaType)) return { ok: false, reason: "type", index: i };
    if (!Number.isInteger(it.size) || it.size <= 0) return { ok: false, reason: "empty", index: i };
    if (it.size > L.maxBytesEach) return { ok: false, reason: "too-large", index: i };
    total += it.size;
  }
  if (total > L.maxBytesTotal) return { ok: false, reason: "total" };
  return { ok: true };
}

/** attachmentsDigest — the consent-nonce binding. Order-sensitive. */
export function attachmentsDigest(items: { sha256: string; size: number; mediaType: string }[]): string {
  return sha256Hex(JSON.stringify(items.map((a) => [a.sha256, a.size, a.mediaType])));
}

/** The digest a text-only run binds to. */
export const EMPTY_ATTACHMENTS_DIGEST = attachmentsDigest([]);

/**
 * sanitizeAttachmentName — display text only, NEVER a path component. Strips
 * control chars + bidi overrides, collapses whitespace, caps at 120 chars.
 */
export function sanitizeAttachmentName(name: unknown, index: number): string {
  const fallback = `image-${index + 1}`;
  if (typeof name !== "string") return fallback;
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return fallback;
  return cleaned.slice(0, 120);
}

/**
 * buildStreamJsonUserMessage — ONE NDJSON line (`\n`-terminated) for
 * `--input-format stream-json`: image blocks first, the rendered `/command`
 * text block LAST (the CLI expands the slash command from the last text block —
 * verified by the BUILD spike). Throws on an empty image list: stdin mode is
 * only for runs with attachments.
 */
export function buildStreamJsonUserMessage(input: {
  images: { mediaType: RunAttachmentMediaType; base64: string }[];
  text: string;
}): string {
  if (input.images.length === 0) {
    throw new Error("buildStreamJsonUserMessage requires at least one image.");
  }
  const content = [
    ...input.images.map((i) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: i.mediaType, data: i.base64 },
    })),
    { type: "text" as const, text: input.text },
  ];
  return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
}

/** formatAttachmentBytes — "0 B" / "1.5 KB" / "3.4 MB" / "20 MB". */
export function formatAttachmentBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const fmt = (v: number): string => (Math.round(v * 10) / 10).toString();
  if (n < 1024 * 1024) return `${fmt(n / 1024)} KB`;
  return `${fmt(n / (1024 * 1024))} MB`;
}

const BASE64_RUN_RE = /[A-Za-z0-9+/]{512,}={0,2}/g;

/** redactBase64Runs — replace any 512+ char base64 run so image bytes can't leak to disk. */
export function redactBase64Runs(s: string): string {
  return s.replace(BASE64_RUN_RE, (m) => `[base64 omitted: ${m.length} chars]`);
}

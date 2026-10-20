/**
 * attachments (daemon) — decode/validate/store/read of run images
 * (run-image-paste PLAN §P.4). The ONLY module that handles attachment bytes.
 *
 * Trust model: the web UI's checks are UX; every rule here is re-enforced from
 * the DECODED bytes (magic sniff, size limits, sha256). Error messages name the
 * item index and NEVER echo `data`.
 */
import { createHash } from "node:crypto";
import {
  RUN_ATTACHMENT_LIMITS,
  extForMediaType,
  sanitizeAttachmentName,
  sniffImageType,
  validateAttachmentSet,
  type RunAttachmentMediaType,
  type RunAttachmentMeta,
} from "@symbion/core";
import { RpcError } from "../rpc/rpcError.js";
import { readAttachmentFile, readRunJson, removeRunDir, writeAttachmentFile } from "./runStore.js";

export interface ValidatedAttachment {
  index: number;
  name: string;
  /** the SNIFFED type (== the client claim, else rejected). */
  mediaType: RunAttachmentMediaType;
  size: number;
  sha256: string;
  bytes: Buffer;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_BASE64_LEN = 4 * Math.ceil(RUN_ATTACHMENT_LIMITS.maxBytesEach / 3);

function bad(index: number, msg: string): RpcError {
  return new RpcError("invalid-params", `attachments[${index}]: ${msg}`);
}

/**
 * decodeAndValidateAttachments — pure CPU, runs BEFORE reserve(). Returns null
 * for absent / empty (`[]` ≡ absent → text-only path).
 */
export function decodeAndValidateAttachments(raw: unknown): ValidatedAttachment[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new RpcError("invalid-params", "attachments must be an array.");
  if (raw.length === 0) return null;
  if (raw.length > RUN_ATTACHMENT_LIMITS.maxCount) {
    throw new RpcError("invalid-params", `At most ${RUN_ATTACHMENT_LIMITS.maxCount} images per run.`);
  }

  const out: ValidatedAttachment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw bad(i, "must be an object.");
    const rec = item as Record<string, unknown>;
    const { mediaType, data } = rec;
    if (typeof mediaType !== "string") throw bad(i, "mediaType must be a string.");
    if (typeof data !== "string") throw bad(i, "data must be a base64 string.");
    if (!(RUN_ATTACHMENT_LIMITS.mediaTypes as readonly string[]).includes(mediaType)) {
      throw bad(i, "unsupported image type.");
    }
    if (data.length === 0) throw bad(i, "empty image.");
    if (data.length > MAX_BASE64_LEN) throw bad(i, "image is larger than 5 MB.");
    if (data.length % 4 !== 0 || !BASE64_RE.test(data)) throw bad(i, "malformed base64.");
    const bytes = Buffer.from(data, "base64");
    // canonical round-trip rejects non-canonical padding / trailing garbage.
    if (bytes.toString("base64") !== data) throw bad(i, "malformed base64.");
    if (bytes.length === 0) throw bad(i, "empty image.");
    if (bytes.length > RUN_ATTACHMENT_LIMITS.maxBytesEach) throw bad(i, "image is larger than 5 MB.");
    const sniffed = sniffImageType(bytes);
    if (sniffed === null) throw bad(i, "unsupported image type.");
    if (sniffed !== mediaType) throw bad(i, `file content is not a ${mediaType}.`);
    out.push({
      index: i,
      name: sanitizeAttachmentName(rec["name"], i),
      mediaType: sniffed,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes,
    });
  }

  const set = validateAttachmentSet(out.map((a) => ({ size: a.size, mediaType: a.mediaType })));
  if (!set.ok) {
    throw new RpcError("invalid-params", "Images exceed the 20 MB total limit.");
  }
  return out;
}

/** The generated on-disk filename for attachment `index` (0-based). */
export function attachmentFileName(index: number, mediaType: RunAttachmentMediaType): string {
  return `${index + 1}.${extForMediaType(mediaType)}`;
}

/**
 * storeAttachments — writes each validated image under the run's confined
 * attachments dir (generated names, atomic). On ANY failure the run's own fresh
 * dir is removed and `attachment-store-failed` is thrown. Returns metadata only.
 */
export function storeAttachments(projectRoot: string, runId: string, items: ValidatedAttachment[]): RunAttachmentMeta[] {
  try {
    return items.map((a) => {
      const file = attachmentFileName(a.index, a.mediaType);
      writeAttachmentFile(projectRoot, runId, file, a.bytes);
      return { index: a.index, name: a.name, mediaType: a.mediaType, size: a.size, sha256: a.sha256, file };
    });
  } catch (err) {
    try {
      removeRunDir(projectRoot, runId);
    } catch {
      // best-effort cleanup
    }
    const detail = err instanceof Error ? err.message : "unknown error";
    throw new RpcError("attachment-store-failed", `Could not store the attached images: ${detail}`);
  }
}

/** readAttachment — index → run.json metadata → confined read → re-verify size/sha/magic. */
export function readAttachment(
  projectRoot: string,
  runId: string,
  index: number
): { mediaType: RunAttachmentMediaType; size: number; data: string } {
  const run = readRunJson(projectRoot, runId);
  if (!run) throw new RpcError("not-found", "Run not found.");
  const meta = run.attachments?.[index];
  if (!meta) throw new RpcError("not-found", "Attachment not found.");
  const bytes = readAttachmentFile(projectRoot, runId, meta.file);
  if (!bytes) throw new RpcError("not-found", "Attachment file is missing.");
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== meta.size || sha !== meta.sha256 || sniffImageType(bytes) !== meta.mediaType) {
    throw new RpcError("attachment-corrupt", "Stored attachment does not match its record.");
  }
  return { mediaType: meta.mediaType, size: bytes.length, data: bytes.toString("base64") };
}

const SHA256_RE = /^[0-9a-f]{64}$/;

/** validatePreflightAttachments — metadata-only params of runPreflight (no bytes). */
export function validatePreflightAttachments(
  raw: unknown
): { sha256: string; size: number; mediaType: string }[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new RpcError("invalid-params", "attachments must be an array.");
  if (raw.length === 0) return null;
  if (raw.length > RUN_ATTACHMENT_LIMITS.maxCount) {
    throw new RpcError("invalid-params", `At most ${RUN_ATTACHMENT_LIMITS.maxCount} images per run.`);
  }
  const out: { sha256: string; size: number; mediaType: string }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it: unknown = raw[i];
    if (typeof it !== "object" || it === null || Array.isArray(it)) throw bad(i, "must be an object.");
    const { sha256, size, mediaType } = it as Record<string, unknown>;
    if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) throw bad(i, "invalid sha256.");
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || typeof mediaType !== "string") throw bad(i, "invalid metadata.");
    out.push({ sha256, size, mediaType });
  }
  const set = validateAttachmentSet(out);
  if (!set.ok) {
    throw new RpcError(
      "invalid-params",
      set.index !== undefined ? `attachments[${set.index}]: ${set.reason}.` : `Attachments rejected: ${set.reason}.`
    );
  }
  return out;
}

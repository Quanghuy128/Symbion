/**
 * Client-side image encoding for the Run dialog (run-image-paste). Reads the file
 * ONCE, sniffs the real type by magic bytes (the browser-claimed MIME is never
 * trusted — a `.png` that is really an SVG/ZIP is rejected), hashes it and builds
 * base64 + a local preview URL. The daemon re-validates everything from the
 * decoded bytes; this is UX + consent-binding input, not the boundary.
 */
import { sha256HexBytes, sniffImageType, type RunAttachmentMediaType } from "@symbion/core";

export interface EncodedAttachment {
  name: string;
  mediaType: RunAttachmentMediaType;
  size: number;
  sha256: string;
  /** base64 (no data: prefix). Lives in component state until Execute, never persisted client-side. */
  data: string;
  /** object URL of the verified bytes (revoke when the chip goes away). */
  previewUrl: string;
}

export class NotAnImageError extends Error {
  constructor() {
    super("not-an-image");
    this.name = "NotAnImageError";
  }
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest("SHA-256", bytes as unknown as BufferSource);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      /* fall through to the pure implementation */
    }
  }
  return sha256HexBytes(bytes);
}

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : "");
    };
    reader.readAsDataURL(blob);
  });
}

/** encodeImageFile — throws NotAnImageError when the bytes are not png/jpeg/gif/webp. */
export async function encodeImageFile(file: File): Promise<EncodedAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = sniffImageType(bytes);
  if (!mediaType) throw new NotAnImageError();
  const [sha256, data] = await Promise.all([sha256Of(bytes), readAsBase64(new Blob([bytes as BlobPart]))]);
  // The preview is built only AFTER the sniff passed, from the sniffed type.
  const previewUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mediaType }));
  return { name: file.name, mediaType, size: bytes.length, sha256, data, previewUrl };
}

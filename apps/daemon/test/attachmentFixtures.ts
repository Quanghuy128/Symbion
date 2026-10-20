/**
 * Image fixtures for the run-image-paste tests — generated in-test as byte
 * arrays (no binary files committed). Only the magic bytes matter to the daemon.
 */
import { randomBytes } from "node:crypto";

/** A real, valid 1x1 PNG (67 bytes). */
export const PNG_1x1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  )
);
export const GIF_1x1 = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
export const JPEG_TINY = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
export const WEBP_TINY = Uint8Array.from(Buffer.from("RIFF\0\0\0\0WEBPVP8L\0\0\0\0", "binary"));

export const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
export const ZIP_BYTES = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

/** Magic-valid PNG padded with random bytes to `size` bytes. */
export function pngOfSize(size: number): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const out = new Uint8Array(size);
  out.set(sig, 0);
  out.set(randomBytes(size - sig.length), sig.length);
  return out;
}

export const SENTINEL = "SYMBIONSENTINEL";

/**
 * PNG signature + 1 pad byte (9 bytes = a multiple of 3, so base64 alignment is
 * preserved) + bytes whose base64 is `SYMBIONSENTINEL` x40. Grepping for
 * "SYMBIONSENTINEL" then finds ANY leak of the image base64.
 */
export const PNG_SENTINEL = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
  ...Buffer.from(SENTINEL.repeat(40), "base64"),
]);

export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

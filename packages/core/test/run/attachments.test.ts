import { describe, expect, it } from "vitest";
import {
  EMPTY_ATTACHMENTS_DIGEST,
  RUN_ATTACHMENT_LIMITS,
  attachmentsDigest,
  buildStreamJsonUserMessage,
  formatAttachmentBytes,
  parseLine,
  redactBase64Runs,
  sanitizeAttachmentName,
  sha256Hex,
  sha256HexBytes,
  sniffImageType,
  validateAttachmentSet,
} from "../../src/index.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF87 = new TextEncoder().encode("GIF87a....");
const GIF89 = new TextEncoder().encode("GIF89a....");
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8L");
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("sniffImageType (CU1-CU3)", () => {
  it("CU1 recognizes png/jpeg/gif/webp", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(GIF87)).toBe("image/gif");
    expect(sniffImageType(GIF89)).toBe("image/gif");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });
  it("CU2 rejects svg/zip/pdf/bmp/heic/wav/truncated/empty", () => {
    const nulls = [
      utf8('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8("<svg/>")]),
      Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]),
      utf8("%PDF-1.7"),
      utf8("BM......"),
      utf8("....ftypheic"),
      utf8("RIFF\0\0\0\0WAVEfmt "),
      PNG.slice(0, 7),
      new Uint8Array(),
      Uint8Array.from([1, 2, 3]),
    ];
    for (const n of nulls) expect(sniffImageType(n)).toBeNull();
  });
  it("CU3 is anchored at offset 0", () => {
    expect(sniffImageType(Uint8Array.from([0, ...PNG]))).toBeNull();
  });
});

describe("limits + set validation (CU4-CU5)", () => {
  it("CU4 pins the literal limits", () => {
    expect(RUN_ATTACHMENT_LIMITS).toEqual({
      maxCount: 5,
      maxBytesEach: 5242880,
      maxBytesTotal: 20971520,
      mediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
    });
  });
  it("CU5 validateAttachmentSet", () => {
    const item = (size: number, mediaType = "image/png") => ({ size, mediaType });
    expect(validateAttachmentSet(Array.from({ length: 5 }, () => item(1024)))).toEqual({ ok: true });
    expect(validateAttachmentSet(Array.from({ length: 6 }, () => item(1024)))).toMatchObject({
      ok: false,
      reason: "count",
    });
    expect(validateAttachmentSet([item(0)])).toEqual({ ok: false, reason: "empty", index: 0 });
    expect(validateAttachmentSet([item(5242881)])).toEqual({ ok: false, reason: "too-large", index: 0 });
    expect(
      validateAttachmentSet([item(5242880), item(5242880), item(5242880), item(5242880), item(1)])
    ).toMatchObject({ ok: false, reason: "total" });
    expect(validateAttachmentSet([item(100, "image/svg+xml")])).toEqual({ ok: false, reason: "type", index: 0 });
    expect(validateAttachmentSet(Array.from({ length: 4 }, () => item(5242880)))).toEqual({ ok: true });
  });
});

describe("digest / name / format / redaction (CU6-CU9)", () => {
  const A = { sha256: "a".repeat(64), size: 10, mediaType: "image/png" };
  const B = { sha256: "b".repeat(64), size: 20, mediaType: "image/gif" };
  it("CU6 attachmentsDigest", () => {
    expect(attachmentsDigest([A, B])).toBe(attachmentsDigest([A, B]));
    expect(attachmentsDigest([A, B])).not.toBe(attachmentsDigest([B, A]));
    expect(attachmentsDigest([A])).not.toBe(attachmentsDigest([{ ...A, sha256: "c".repeat(64) }]));
    expect(attachmentsDigest([A])).not.toBe(attachmentsDigest([{ ...A, size: 11 }]));
    expect(attachmentsDigest([A])).not.toBe(attachmentsDigest([{ ...A, mediaType: "image/jpeg" }]));
    expect(EMPTY_ATTACHMENTS_DIGEST).toBe(attachmentsDigest([]));
    expect(EMPTY_ATTACHMENTS_DIGEST).toMatch(/^[0-9a-f]{64}$/);
  });
  it("CU7 sanitizeAttachmentName", () => {
    expect(sanitizeAttachmentName("a\u0000b\nc‮d⁦e", 0)).toBe("a b c d e");
    expect(sanitizeAttachmentName("  a   b  ", 0)).toBe("a b");
    expect(sanitizeAttachmentName("x".repeat(300), 0)).toHaveLength(120);
    expect(sanitizeAttachmentName("", 2)).toBe("image-3");
    expect(sanitizeAttachmentName(42, 0)).toBe("image-1");
    // display text only: never a path (documented — the daemon uses generated <n>.<ext>).
    expect(sanitizeAttachmentName("../../etc/passwd", 0)).toBe("../../etc/passwd");
  });
  it("CU8 formatAttachmentBytes", () => {
    expect(formatAttachmentBytes(0)).toBe("0 B");
    expect(formatAttachmentBytes(1536)).toBe("1.5 KB");
    expect(formatAttachmentBytes(3565158)).toBe("3.4 MB");
    expect(formatAttachmentBytes(20971520)).toBe("20 MB");
  });
  it("CU9 redactBase64Runs", () => {
    const run = (n: number) => "A".repeat(n);
    expect(redactBase64Runs(run(600))).toBe("[base64 omitted: 600 chars]");
    expect(redactBase64Runs(run(511))).toBe(run(511));
    expect(redactBase64Runs(`x ${run(600)} y ${run(700)}==`)).toBe(
      "x [base64 omitted: 600 chars] y [base64 omitted: 702 chars]"
    );
    const plain = `hello world ${"f".repeat(64)} 123e4567-e89b-42d3-a456-426614174000`;
    expect(redactBase64Runs(plain)).toBe(plain);
    const once = redactBase64Runs(run(600));
    expect(redactBase64Runs(once)).toBe(once);
  });
});

describe("buildStreamJsonUserMessage (CU10-CU12)", () => {
  const img = (t: "image/png" | "image/gif", d: string) => ({ mediaType: t, base64: d });
  it("CU10 one NDJSON line, text block last", () => {
    const text = "/analyze fix\nthe header";
    const line = buildStreamJsonUserMessage({ images: [img("image/png", "AAAA"), img("image/gif", "BBBB")], text });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          { type: "image", source: { type: "base64", media_type: "image/gif", data: "BBBB" } },
          { type: "text", text },
        ],
      },
    });
  });
  it("CU11 hostile requirement round-trips verbatim in one object", () => {
    for (const text of ['"; rm -rf ~ #', '"}\n{"type":"user"', " "]) {
      const line = buildStreamJsonUserMessage({ images: [img("image/png", "AAAA")], text });
      expect(line.split("\n").filter(Boolean)).toHaveLength(1);
      const obj = JSON.parse(line);
      expect(obj.message.content.at(-1)).toEqual({ type: "text", text });
    }
  });
  it("CU12 throws with no images", () => {
    expect(() => buildStreamJsonUserMessage({ images: [], text: "x" })).toThrow();
  });
});

describe("sha256HexBytes + parser redaction (CU13-CU15)", () => {
  it("CU13 vectors + string equivalence", () => {
    expect(sha256HexBytes(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256HexBytes(utf8("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    let seed = 12345;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < 50; i++) {
      let s = "";
      const n = rnd() % 200;
      for (let j = 0; j < n; j++) {
        s += String.fromCodePoint(rnd() % 3 === 0 ? 0x1f600 + (rnd() % 50) : 32 + (rnd() % 1000));
      }
      expect(sha256Hex(s)).toBe(sha256HexBytes(utf8(s)));
    }
  });
  const SENTINEL = "SYMBIONSENTINEL".repeat(40);
  it("CU14 unknown + parse-error rawTruncated are redacted before the cap", () => {
    const unknown = parseLine(JSON.stringify({ type: "debug_echo", payload: SENTINEL.repeat(20) }));
    expect(unknown.kind).toBe("unknown");
    const raw = (unknown as { rawTruncated: string }).rawTruncated;
    expect(raw).toContain("[base64 omitted:");
    expect(raw).not.toContain("SYMBIONSENTINEL");
    const pe = parseLine(`not json ${SENTINEL.repeat(20)}`);
    expect(pe.kind).toBe("parse-error");
    expect((pe as { rawTruncated: string }).rawTruncated).not.toContain("SYMBIONSENTINEL");
  });
  it("CU15 a replayed [image,text] user line yields no parts and no bytes", () => {
    const ev = parseLine(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: SENTINEL } },
            { type: "text", text: "hi" },
          ],
        },
      })
    );
    expect(ev).toMatchObject({ kind: "tool-results", parts: [] });
    expect(JSON.stringify(ev)).not.toContain("SYMBIONSENTINEL");
  });
});

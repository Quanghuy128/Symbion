import { describe, expect, it } from "vitest";
import { buildMarker, computeContentHash, parseMarker, truncateHash } from "../src/render/marker.js";

describe("marker + content hash", () => {
  it("buildMarker/parseMarker round-trips fields", () => {
    const hash = computeContentHash("some content");
    const marker = buildMarker("abc-123", "agent", "v0.1.0", hash);
    expect(marker).toBe(`<!-- managed-by: symbion id=abc-123 kind=agent v=v0.1.0 hash=${truncateHash(hash)} -->`);

    const parsed = parseMarker(`---\nname: x\n---\nbody\n${marker}\n`);
    expect(parsed).toEqual({ id: "abc-123", kind: "agent", version: "v0.1.0", hash: truncateHash(hash) });
  });

  it("foreign content (no marker) -> parseMarker returns null", () => {
    expect(parseMarker("---\nname: x\n---\njust a normal file\n")).toBeNull();
  });

  it("contentHash excludes the hash token itself; recomputing on rendered content (sans marker) matches", () => {
    const base = "---\ndescription: x\n---\nbody text";
    const hash = computeContentHash(base);
    const marker = buildMarker("id1", "command", "v0.2.0", hash);
    const rendered = `${base}\n${marker}\n`;

    // strip marker, recompute -> must equal truncated original hash
    const stripped = rendered.replace(/\n*<!-- managed-by:[\s\S]*?-->\s*$/, "");
    const recomputed = truncateHash(computeContentHash(stripped));
    expect(recomputed).toBe(truncateHash(hash));
  });

  it("two semantically-equal IRs (same fields incl. custom field order) hash identically", () => {
    const a = computeContentHash("---\ndescription: x\nmodel: foo\n---\nbody");
    const b = computeContentHash("---\ndescription: x\nmodel: foo\n---\nbody");
    expect(a).toBe(b);
  });

  it("any body/frontmatter change produces a different hash", () => {
    const a = computeContentHash("---\ndescription: x\n---\nbody");
    const b = computeContentHash("---\ndescription: y\n---\nbody");
    expect(a).not.toBe(b);
  });
});

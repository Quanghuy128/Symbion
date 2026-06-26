import { describe, expect, it } from "vitest";
import { renderArtifacts } from "../src/render/render.js";
import { computeDiff } from "../src/diff/diff.js";
import type { CanonicalArtifact } from "../src/ir/types.js";

function makeArtifact(overrides: Partial<CanonicalArtifact>): CanonicalArtifact {
  return {
    id: "a1",
    kind: "agent",
    name: "ba",
    description: "BA",
    body: "You are BA.",
    meta: { version: "draft", status: "draft", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    ...overrides,
  };
}

describe("diff + conflict classification", () => {
  it("new file (no on-disk) -> status new", () => {
    const [rendered] = renderArtifacts([makeArtifact({})], "claude", { version: "v0.1.0" });
    const diff = computeDiff([rendered!], []);
    expect(diff[0]!.status).toBe("new");
  });

  it("on-disk hash == marker hash, IR changed -> status update", () => {
    const [renderedV1] = renderArtifacts([makeArtifact({})], "claude", { version: "v0.1.0" });
    const [renderedV2] = renderArtifacts([makeArtifact({ body: "You are BA, updated." })], "claude", {
      version: "v0.2.0",
    });
    const diff = computeDiff([renderedV2!], [{ relPath: renderedV1!.relPath, content: renderedV1!.content }]);
    expect(diff[0]!.status).toBe("update");
    expect(diff[0]!.conflictClass).toBe("clean");
  });

  it("on-disk hash == marker hash, IR unchanged -> status same (idempotency, AC-E2)", () => {
    const [rendered] = renderArtifacts([makeArtifact({})], "claude", { version: "v0.1.0" });
    const diff = computeDiff([rendered!], [{ relPath: rendered!.relPath, content: rendered!.content }]);
    expect(diff[0]!.status).toBe("same");
  });

  it("on-disk hash != marker hash -> status conflict (AC-E3)", () => {
    const [rendered] = renderArtifacts([makeArtifact({})], "claude", { version: "v0.1.0" });
    const handEdited = rendered!.content.replace("You are BA.", "You are BA. HAND EDITED.");
    const diff = computeDiff([rendered!], [{ relPath: rendered!.relPath, content: handEdited }]);
    expect(diff[0]!.status).toBe("conflict");
    expect(diff[0]!.conflictClass).toBe("conflict");
  });

  it("on-disk file with no marker -> classified foreign, never overwritten silently", () => {
    const [rendered] = renderArtifacts([makeArtifact({})], "claude", { version: "v0.1.0" });
    const foreignContent = "---\nname: ba\ndescription: hand written\n---\nNo marker here.";
    const diff = computeDiff([rendered!], [{ relPath: rendered!.relPath, content: foreignContent }]);
    expect(diff[0]!.conflictClass).toBe("foreign");
    expect(diff[0]!.status).toBe("conflict"); // defensively blocked, not silently overwritten
  });

  it("idempotency: render -> diff of unchanged IR against its own last-published output -> all same", () => {
    const artifacts = [makeArtifact({ id: "a1", name: "ba" }), makeArtifact({ id: "a2", name: "reviewer", body: "review" })];
    const rendered = renderArtifacts(artifacts, "claude", { version: "v0.1.0" });
    const onDisk = rendered.map((f) => ({ relPath: f.relPath, content: f.content }));
    const diff = computeDiff(rendered, onDisk);
    expect(diff.every((d) => d.status === "same")).toBe(true);
  });

  it("merged target (AGENTS.md) first publish with pre-existing foreign content -> update, not conflict", () => {
    const [rendered] = renderArtifacts([makeArtifact({})], "codex", {
      version: "v0.1.0",
      existingForeignContent: "# Hand-written notes",
    });
    // Render already spliced the foreign content in; on-disk has that same foreign
    // content but NO managed region yet (first publish for this merged target).
    const onDisk = [{ relPath: "AGENTS.md", content: "# Hand-written notes", isMergedTarget: true }];
    const diff = computeDiff([rendered!], onDisk);
    expect(diff[0]!.status).toBe("update");
    expect(diff[0]!.conflictClass).toBe("clean");
  });

  it("merged target (AGENTS.md) re-publish with byte-identical content -> same", () => {
    const [rendered] = renderArtifacts([makeArtifact({})], "codex", { version: "v0.1.0" });
    const onDisk = [{ relPath: "AGENTS.md", content: rendered!.content, isMergedTarget: true }];
    const diff = computeDiff([rendered!], onDisk);
    expect(diff[0]!.status).toBe("same");
  });

  it("non-merged target with unmarked on-disk file at the same path -> defensive conflict (not silently overwritten)", () => {
    const [rendered] = renderArtifacts([makeArtifact({})], "claude", { version: "v0.1.0" });
    const onDisk = [{ relPath: rendered!.relPath, content: "hand written, no marker, no isMergedTarget flag" }];
    const diff = computeDiff([rendered!], onDisk);
    expect(diff[0]!.conflictClass).toBe("foreign");
    expect(diff[0]!.status).toBe("conflict");
  });
});

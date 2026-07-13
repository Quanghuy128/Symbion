import { describe, expect, it } from "vitest";
import {
  classifyPickedFile,
  deriveArtifactName,
  isProbablyBinary,
} from "../src/parse/pickedFile.js";
import { buildMarker, computeContentHash } from "../src/render/marker.js";

describe("deriveArtifactName (F5 / E9)", () => {
  it("U1: strips .md.tmpl", () => {
    expect(deriveArtifactName("ba.md.tmpl")).toBe("ba");
  });
  it("U2: strips .md.tmpl with hyphen", () => {
    expect(deriveArtifactName("code-reviewer.md.tmpl")).toBe("code-reviewer");
  });
  it("U3: strips single .md", () => {
    expect(deriveArtifactName("architect.md")).toBe("architect");
  });
  it("U4: strips single unknown ext", () => {
    expect(deriveArtifactName("notes.txt")).toBe("notes");
  });
  it("U5: no ext left as-is", () => {
    expect(deriveArtifactName("Makefile")).toBe("Makefile");
  });
  it("preserves a dotfile with no further ext", () => {
    expect(deriveArtifactName(".gitignore")).toBe(".gitignore");
  });
  it("strips .tmpl then a single trailing ext on a non-.md file", () => {
    // strip .tmpl → "prompt.txt", not .md so fall through to single-ext strip → "prompt"
    expect(deriveArtifactName("prompt.txt.tmpl")).toBe("prompt");
  });
});

describe("classifyPickedFile", () => {
  it("U6: valid frontmatter agent → no warning", () => {
    const content = `---\ndescription: x\n---\nbody here`;
    const { artifact, warning } = classifyPickedFile(content, { kind: "agent", name: "ba" });
    expect(warning).toBeUndefined();
    expect(artifact.description).toBe("x");
    expect(artifact.kind).toBe("agent");
    expect(artifact.name).toBe("ba");
  });

  it("U7: bad YAML (vpo case) → fallback + warning", () => {
    // A frontmatter block whose YAML throws "Nested mappings are not allowed
    // in compact mappings" (the exact vpo failure shape).
    const content = `---\nname: {a: b: c}\n---\nthe body`;
    const { artifact, warning } = classifyPickedFile(content, { kind: "agent", name: "architect" });
    expect(warning).toBeTruthy();
    expect(warning!.length).toBeGreaterThan(0);
    expect(artifact.description).toBe("");
    expect(artifact.body).toBe(content.trim());
    expect(artifact.meta.status).toBe("draft");
  });

  it("U8: no frontmatter → fallback + warning, body is raw", () => {
    const content = `# Just markdown\n\nno frontmatter at all`;
    const { artifact, warning } = classifyPickedFile(content, { kind: "command", name: "x" });
    expect(warning).toBeTruthy();
    expect(artifact.body).toBe(content.trim());
    expect(artifact.description).toBe("");
  });

  it("U9: honors user kind verbatim (F4) — command body picked as agent", () => {
    const content = `---\ndescription: run it\n---\nUse $ARGUMENTS to do the thing`;
    const { artifact } = classifyPickedFile(content, { kind: "agent", name: "ba" });
    expect(artifact.kind).toBe("agent");
    // no usesArguments override for an agent
    expect(artifact.usesArguments).toBeUndefined();
  });

  it("U10: kind command sets usesArguments", () => {
    const content = `---\ndescription: run it\n---\nUse $ARGUMENTS here`;
    const { artifact } = classifyPickedFile(content, { kind: "command", name: "run" });
    expect(artifact.usesArguments).toBe(true);
  });

  it("U10b: fallback path also sets usesArguments for a command with $ARGUMENTS", () => {
    const content = `no frontmatter but uses $ARGUMENTS`;
    const { artifact, warning } = classifyPickedFile(content, { kind: "command", name: "run" });
    expect(warning).toBeTruthy();
    expect(artifact.usesArguments).toBe(true);
  });

  it("U14: fresh uuid-shaped id + draft status when no marker (fallback)", () => {
    const { artifact } = classifyPickedFile("plain body", { kind: "agent", name: "x" });
    expect(artifact.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(artifact.meta.status).toBe("draft");
  });

  it("U15: marker id reused when present (E18 idempotency basis)", () => {
    // A file with a marker but broken frontmatter → fallback keeps the marker id.
    const markerId = "11111111-2222-4333-8444-555555555555";
    const hash = computeContentHash("x");
    const marker = buildMarker(markerId, "agent", "1.0.0", hash);
    const content = `no frontmatter\n${marker}`;
    const { artifact } = classifyPickedFile(content, { kind: "agent", name: "x" });
    expect(artifact.id).toBe(markerId);
  });

  it("U15b: fallback strips the trailing managed marker from body (note 1)", () => {
    // marker-carrying file that hits the fallback must NOT keep the marker in
    // its body (else a duplicated marker on next render/publish).
    const markerId = "11111111-2222-4333-8444-555555555555";
    const hash = computeContentHash("x");
    const marker = buildMarker(markerId, "agent", "1.0.0", hash);
    const content = `no frontmatter body text\n\n${marker}`;
    const { artifact } = classifyPickedFile(content, { kind: "agent", name: "x" });
    expect(artifact.body).toBe("no frontmatter body text");
    expect(artifact.body).not.toContain("managed-by: symbion");
    // status/version stay draft even though a marker id was reused (note 2).
    expect(artifact.meta.status).toBe("draft");
    expect(artifact.meta.version).toBe("draft");
    expect(artifact.id).toBe(markerId);
  });
});

describe("isProbablyBinary", () => {
  it("U11: NUL byte → true (string)", () => {
    expect(isProbablyBinary("hello\x00world")).toBe(true);
  });
  it("U11b: NUL byte → true (Uint8Array)", () => {
    expect(isProbablyBinary(Uint8Array.from([104, 105, 0, 116]))).toBe(true);
  });
  it("U12: plain text markdown → false", () => {
    expect(isProbablyBinary("# Title\n\nSome normal text with tabs\tand newlines.\n")).toBe(false);
  });
  it("U13: high control-char ratio → true", () => {
    const bytes = Uint8Array.from(Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 1 : 65)));
    expect(isProbablyBinary(bytes)).toBe(true);
  });
  it("empty sample → false (empty text file is not binary)", () => {
    expect(isProbablyBinary("")).toBe(false);
    expect(isProbablyBinary(new Uint8Array())).toBe(false);
  });
  it("utf-8 multibyte text → false", () => {
    expect(isProbablyBinary("héllo wörld — 日本語 🎉")).toBe(false);
  });
});

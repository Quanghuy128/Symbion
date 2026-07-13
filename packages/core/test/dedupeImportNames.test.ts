import { describe, expect, it } from "vitest";
import { dedupeImportNames } from "../src/parse/dedupeImportNames.js";
import type { ArtifactKind, CanonicalArtifact } from "../src/ir/types.js";

/** Minimal artifact factory for the dedup tests (only id/kind/name matter). */
function art(id: string, kind: ArtifactKind, name: string): CanonicalArtifact {
  return {
    id,
    kind,
    name,
    description: "d",
    body: "b",
    meta: {
      version: "draft",
      status: "draft",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    },
  };
}

describe("dedupeImportNames (PLAN §1.1, testplan U-section)", () => {
  it("U1 empty incoming -> deduped:[], renames:[]", () => {
    const r = dedupeImportNames([], []);
    expect(r.deduped).toEqual([]);
    expect(r.renames).toEqual([]);
  });

  it("U2 single incoming, no existing -> name unchanged, renames:[]", () => {
    const r = dedupeImportNames([], [art("1", "agent", "ba")]);
    expect(r.deduped.map((a) => a.name)).toEqual(["ba"]);
    expect(r.renames).toEqual([]);
  });

  it("U3 two incoming same (kind,name) -> ba, ba-2", () => {
    const r = dedupeImportNames([], [art("1", "agent", "ba"), art("2", "agent", "ba")]);
    expect(r.deduped.map((a) => a.name)).toEqual(["ba", "ba-2"]);
    expect(r.renames).toEqual([{ id: "2", from: "ba", to: "ba-2" }]);
  });

  it("U4 three same -> ba, ba-2, ba-3", () => {
    const r = dedupeImportNames(
      [],
      [art("1", "agent", "ba"), art("2", "agent", "ba"), art("3", "agent", "ba")]
    );
    expect(r.deduped.map((a) => a.name)).toEqual(["ba", "ba-2", "ba-3"]);
  });

  it("U5 .md + .md.tmpl twins: array-first keeps bare, second -> -2", () => {
    // Both derived to name `ba`, kind agent — order is [auto .md, reclassified .md.tmpl].
    const r = dedupeImportNames(
      [],
      [art("auto", "agent", "ba"), art("tmpl", "agent", "ba")]
    );
    expect(r.deduped.map((a) => a.name)).toEqual(["ba", "ba-2"]);
    expect(r.renames).toEqual([{ id: "tmpl", from: "ba", to: "ba-2" }]);
  });

  it("U6 collision across kinds: both keep bare name (per-kind scoping)", () => {
    const r = dedupeImportNames(
      [],
      [art("1", "agent", "ba"), art("2", "command", "ba")]
    );
    expect(r.deduped.map((a) => a.name)).toEqual(["ba", "ba"]);
    expect(r.renames).toEqual([]);
  });

  it("U7 incoming collides with EXISTING store name -> incoming bumped, existing untouched", () => {
    const existing = [art("e1", "agent", "ba")];
    const r = dedupeImportNames(existing, [art("i1", "agent", "ba")]);
    expect(r.deduped.map((a) => a.name)).toEqual(["ba-2"]);
    // existing input array not mutated
    expect(existing[0]!.name).toBe("ba");
  });

  it("U8 existing has ba AND ba-2; incoming ba -> ba-3 (skips taken suffixes)", () => {
    const existing = [art("e1", "agent", "ba"), art("e2", "agent", "ba-2")];
    const r = dedupeImportNames(existing, [art("i1", "agent", "ba")]);
    expect(r.deduped.map((a) => a.name)).toEqual(["ba-3"]);
  });

  it("U9 input immutability: original incoming[i].name unchanged after call", () => {
    const incoming = [art("1", "agent", "ba"), art("2", "agent", "ba")];
    dedupeImportNames([], incoming);
    expect(incoming[0]!.name).toBe("ba");
    expect(incoming[1]!.name).toBe("ba"); // the renamed one is a clone; original stays "ba"
  });

  it("U10 id preservation: every deduped[i].id === incoming[i].id", () => {
    const incoming = [art("a", "agent", "ba"), art("b", "agent", "ba"), art("c", "command", "ba")];
    const r = dedupeImportNames([], incoming);
    expect(r.deduped.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("U11 re-import self: existing EXCLUDES the incoming id -> name NOT bumped (E19)", () => {
    // Caller seeds `existing` with store MINUS the selected ids. So a re-imported
    // artifact's own stored name is NOT in the claimed set -> keeps bare name.
    const existingOthers: CanonicalArtifact[] = []; // the only stored artifact IS the one being re-imported
    const r = dedupeImportNames(existingOthers, [art("same-id", "agent", "ba")]);
    expect(r.deduped.map((a) => a.name)).toEqual(["ba"]);
    expect(r.renames).toEqual([]);
  });

  it("U12 renames audit shape: {id,from,to}; only renamed artifacts appear", () => {
    const r = dedupeImportNames(
      [],
      [art("1", "agent", "ba"), art("2", "agent", "ba"), art("3", "agent", "cso")]
    );
    expect(r.renames).toEqual([{ id: "2", from: "ba", to: "ba-2" }]);
  });

  it("U13 suffix format matches applyTemplate: `${base}-${n}` from n=2", () => {
    const r = dedupeImportNames(
      [],
      [art("1", "agent", "x"), art("2", "agent", "x"), art("3", "agent", "x")]
    );
    expect(r.deduped.map((a) => a.name)).toEqual(["x", "x-2", "x-3"]);
  });

  it("U14 name with existing hyphen collides -> code-reviewer-2 (suffix appended, not parsed)", () => {
    const existing = [art("e1", "agent", "code-reviewer")];
    const r = dedupeImportNames(existing, [art("i1", "agent", "code-reviewer")]);
    expect(r.deduped.map((a) => a.name)).toEqual(["code-reviewer-2"]);
  });
});

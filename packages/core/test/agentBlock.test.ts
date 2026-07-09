import { describe, expect, it } from "vitest";
import {
  parseAgentBlock,
  hasAgentBlock,
  upsertAgentRef,
  removeAgentRef,
  renderAgentBlock,
  setAgentBlock,
  type AgentRef,
} from "../src/ir/agentBlock.js";
import { extractAgentMentions } from "../src/ir/refs.js";

const TIMES = "×"; // ×
const EM_DASH = "—"; // —

/** Build a canonical body with a block from prose + refs, matching the placement rule. */
function bodyWith(prose: string, refs: AgentRef[]): string {
  return setAgentBlock(prose, refs);
}

describe("agentBlock — parse", () => {
  it("U1 (GATE) round-trip identity: setAgentBlock(body, parseAgentBlock(body)) === body", () => {
    const bodies: string[] = [
      // no block
      "Just some prose, no block at all.",
      // empty body
      "",
      // block with 1 ref
      bodyWith("Prose here.", [{ name: "qa" }]),
      // block with count
      bodyWith("Prose.", [{ name: "feature-builder", count: 2 }]),
      // block with goal
      bodyWith("Prose.", [{ name: "code-reviewer", goal: "Review the diff" }]),
      // block with count + goal
      bodyWith("Prose.", [{ name: "x", count: 3, goal: "Do the thing" }]),
      // block with 3 refs mixed
      bodyWith("Prose.", [
        { name: "feature-builder", count: 2, goal: "Implement the feature per the plan" },
        { name: "code-reviewer", goal: "Independent review of the diff" },
        { name: "qa" },
      ]),
      // block preceded by prose (multi-line prose)
      bodyWith("Line one.\nLine two.\n\nA paragraph.", [{ name: "a" }, { name: "b", count: 4 }]),
      // block only (empty prose)
      bodyWith("", [{ name: "solo" }]),
    ];
    for (const body of bodies) {
      expect(setAgentBlock(body, parseAgentBlock(body))).toBe(body);
    }
  });

  it("U1b (GATE) round-trip identity when block is NOT the last element (mid-body / trailing prose)", () => {
    const block = renderAgentBlock([
      { name: "feature-builder", count: 2, goal: "Implement" },
      { name: "qa" },
    ]);
    const bodies: string[] = [
      // prose before + prose after
      `before\n\n${block}\n\nafter prose`,
      // block immediately followed by a trailing line (no blank separator)
      `${block}\ntrailing`,
      // block mid multi-paragraph body
      `Para one.\n\nPara two.\n\n${block}\n\nPara three.\n\nPara four.`,
      // block followed by a bare trailing newline
      `lead\n\n${block}\n`,
      // block at very start followed by prose (no leading blank line)
      `${block}\n\nfollow up`,
    ];
    for (const body of bodies) {
      expect(setAgentBlock(body, parseAgentBlock(body))).toBe(body);
    }
  });

  it("U1c (GATE) non-integer / ≤0 / negative count collapses to plain and round-trips", () => {
    // These refs render WITHOUT ×N (non-integer 2.7, zero, negative), so parse recovers a plain ref.
    const bodies: string[] = [
      bodyWith("Prose.", [{ name: "frac", count: 2.7 }]),
      bodyWith("Prose.", [{ name: "zero", count: 0 }]),
      bodyWith("Prose.", [{ name: "neg", count: -3 }]),
    ];
    for (const body of bodies) {
      // no × marker was written
      expect(body).not.toContain(TIMES);
      // round-trip identity holds
      expect(setAgentBlock(body, parseAgentBlock(body))).toBe(body);
      // count collapsed to undefined on parse
      expect(parseAgentBlock(body)[0]!.count).toBeUndefined();
    }
  });

  it("U2 empty body / no delimiters -> []", () => {
    expect(parseAgentBlock("")).toEqual([]);
    expect(parseAgentBlock("no block here")).toEqual([]);
  });

  it("U3 parse plain name -> count/goal undefined", () => {
    const body = setAgentBlock("", [{ name: "feature-builder" }]);
    const refs = parseAgentBlock(body);
    expect(refs).toEqual([{ name: "feature-builder" }]);
    expect(refs[0]!.count).toBeUndefined();
    expect(refs[0]!.goal).toBeUndefined();
  });

  it("U4 parse count", () => {
    const body = setAgentBlock("", [{ name: "qa", count: 2 }]);
    expect(parseAgentBlock(body)).toEqual([{ name: "qa", count: 2 }]);
  });

  it("U5 parse goal only", () => {
    const body = setAgentBlock("", [{ name: "cr", goal: "Review the diff" }]);
    expect(parseAgentBlock(body)).toEqual([{ name: "cr", goal: "Review the diff" }]);
  });

  it("U6 parse count + goal", () => {
    const body = setAgentBlock("", [{ name: "x", count: 3, goal: "Do the thing" }]);
    expect(parseAgentBlock(body)).toEqual([{ name: "x", count: 3, goal: "Do the thing" }]);
  });

  it("U7 preserves first-appearance order across 3 refs", () => {
    const body = setAgentBlock("", [{ name: "c" }, { name: "a" }, { name: "b" }]);
    expect(parseAgentBlock(body).map((r) => r.name)).toEqual(["c", "a", "b"]);
  });

  it("U8 goal containing × and — captured whole (only first — splits)", () => {
    const goal = `mix ${TIMES}2 and ${EM_DASH} inside`;
    const body = setAgentBlock("", [{ name: "x", count: 5, goal }]);
    const refs = parseAgentBlock(body);
    expect(refs[0]!.goal).toBe(goal);
    expect(refs[0]!.count).toBe(5);
  });

  it("U9 exact codepoints: ASCII x2 / hyphen goal are NOT parsed", () => {
    const asciiTimes = "<!-- symbion:agents -->\n## Agents\n\n- @x x2\n<!-- /symbion:agents -->";
    // "x2" is not a count marker (needs U+00D7); the trailing " x2" is not valid grammar -> line dropped.
    expect(parseAgentBlock(asciiTimes)).toEqual([]);
    const hyphenGoal = "<!-- symbion:agents -->\n## Agents\n\n- @x - goal\n<!-- /symbion:agents -->";
    expect(parseAgentBlock(hyphenGoal)).toEqual([]);
  });
});

describe("agentBlock — render", () => {
  it("U10 renderAgentBlock([{name}]) omits ×count and — goal", () => {
    const out = renderAgentBlock([{ name: "a" }]);
    expect(out).toContain("- @a");
    expect(out).not.toContain(TIMES);
    expect(out).not.toContain(EM_DASH);
  });

  it("U11 count 1/undefined -> no ×1; count>1 -> ×N", () => {
    expect(renderAgentBlock([{ name: "a", count: 1 }])).not.toContain(`${TIMES}1`);
    expect(renderAgentBlock([{ name: "a" }])).not.toContain(TIMES);
    expect(renderAgentBlock([{ name: "a", count: 3 }])).toContain(`${TIMES}3`);
  });

  it("U12 empty/whitespace goal -> no — segment", () => {
    expect(renderAgentBlock([{ name: "a", goal: "" }])).not.toContain(EM_DASH);
    expect(renderAgentBlock([{ name: "a", goal: "   " }])).not.toContain(EM_DASH);
  });

  it("U13 delimiters + heading present, no trailing spaces", () => {
    const out = renderAgentBlock([{ name: "a", count: 2, goal: "g" }, { name: "b" }]);
    expect(out.startsWith("<!-- symbion:agents -->")).toBe(true);
    expect(out.endsWith("<!-- /symbion:agents -->")).toBe(true);
    expect(out).toContain("## Agents");
    for (const line of out.split("\n")) {
      expect(line).toBe(line.replace(/\s+$/, ""));
    }
  });
});

describe("agentBlock — upsert / remove / setAgentBlock", () => {
  it("U14 upsert on no-block body creates block with one blank line before opening delimiter", () => {
    const out = upsertAgentRef("Some prose.", { name: "a" });
    expect(out).toBe("Some prose.\n\n<!-- symbion:agents -->\n## Agents\n\n- @a\n<!-- /symbion:agents -->");
  });

  it("U15 upsert replaces matching @name in place, order preserved", () => {
    const body = setAgentBlock("", [{ name: "a" }, { name: "b" }, { name: "c" }]);
    const out = upsertAgentRef(body, { name: "b", count: 2 });
    const refs = parseAgentBlock(out);
    expect(refs.map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(refs[1]).toEqual({ name: "b", count: 2 });
  });

  it("U16 upsert adding a new name appends at end", () => {
    const body = setAgentBlock("", [{ name: "a" }]);
    const out = upsertAgentRef(body, { name: "z" });
    expect(parseAgentBlock(out).map((r) => r.name)).toEqual(["a", "z"]);
  });

  it("U17 remove drops one line; removing last restores pre-block bytes", () => {
    const prose = "Prose paragraph.";
    const body = setAgentBlock(prose, [{ name: "a" }, { name: "b" }]);
    const afterOne = removeAgentRef(body, "a");
    expect(parseAgentBlock(afterOne).map((r) => r.name)).toEqual(["b"]);
    const afterLast = removeAgentRef(afterOne, "b");
    expect(afterLast).toBe(prose);
  });

  it("U18 setAgentBlock(body, []) strips block, restores original bytes", () => {
    const prose = "Original prose.";
    const body = setAgentBlock(prose, [{ name: "a" }, { name: "b" }]);
    expect(setAgentBlock(body, [])).toBe(prose);
  });

  it("U19 upsert idempotent: same ref twice === once", () => {
    const once = upsertAgentRef("p", { name: "a", count: 2, goal: "g" });
    const twice = upsertAgentRef(once, { name: "a", count: 2, goal: "g" });
    expect(twice).toBe(once);
  });

  it("U19b upsert on a body with prose AFTER the block keeps trailing prose in place", () => {
    const block = renderAgentBlock([{ name: "a" }]);
    const body = `intro paragraph\n\n${block}\n\nclosing prose that must not move`;
    const out = upsertAgentRef(body, { name: "newone" });
    // Trailing prose remains after the block, byte-for-byte.
    expect(out.endsWith("\n\nclosing prose that must not move")).toBe(true);
    // Intro prose still precedes the block.
    expect(out.startsWith("intro paragraph\n\n<!-- symbion:agents -->")).toBe(true);
    // Block content changed (new ref appended), prose untouched.
    expect(parseAgentBlock(out).map((r) => r.name)).toEqual(["a", "newone"]);
    // The block did NOT get relocated to end-of-body.
    expect(out.indexOf("<!-- /symbion:agents -->")).toBeLessThan(out.indexOf("closing prose"));
  });

  it("U20 hasAgentBlock true only when both delimiters present", () => {
    const body = setAgentBlock("", [{ name: "a" }]);
    expect(hasAgentBlock(body)).toBe(true);
    expect(hasAgentBlock("<!-- symbion:agents -->\n## Agents\n\n- @a")).toBe(false);
    expect(hasAgentBlock("## Agents\n\n- @a\n<!-- /symbion:agents -->")).toBe(false);
    expect(hasAgentBlock("")).toBe(false);
  });
});

describe("agentBlock — tolerance", () => {
  it("U21 malformed `- @` line dropped on canonical re-render but NOT on plain parse", () => {
    // Body has a valid ref and a malformed `- @` line inside the block.
    const body =
      "<!-- symbion:agents -->\n## Agents\n\n- @good\n- @bad ×notanumber\n<!-- /symbion:agents -->";
    // Plain parse: only well-formed lines become refs, but the body is UNCHANGED (no mutation).
    expect(parseAgentBlock(body).map((r) => r.name)).toEqual(["good"]);
    // Mutation (upsert) re-renders canonically -> malformed line is dropped from the body.
    const mutated = upsertAgentRef(body, { name: "good", count: 2 });
    expect(mutated).not.toContain("notanumber");
    expect(parseAgentBlock(mutated).map((r) => r.name)).toEqual(["good"]);
  });

  it("U22 a stray non-ref line inside the block does not throw", () => {
    const body =
      "<!-- symbion:agents -->\n## Agents\n\nsome stray note\n- @a\n<!-- /symbion:agents -->";
    expect(() => parseAgentBlock(body)).not.toThrow();
    expect(parseAgentBlock(body).map((r) => r.name)).toEqual(["a"]);
  });
});

describe("agentBlock — interop with extractAgentMentions", () => {
  it("U23 extractAgentMentions still returns the block's @names", () => {
    const body = setAgentBlock("Do work then hand off.", [
      { name: "feature-builder", count: 2 },
      { name: "code-reviewer", goal: "Review" },
    ]);
    expect(extractAgentMentions(body)).toEqual(["feature-builder", "code-reviewer"]);
  });
});

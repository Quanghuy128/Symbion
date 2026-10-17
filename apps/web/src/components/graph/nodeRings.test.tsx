import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { agentRing, commandRing, RING } from "./nodeRings";
import { CommandNode } from "./CommandNode";
import { AgentNode } from "./AgentNode";

describe("node status rings", () => {
  it("rings are built from CSS variables only (no hex)", () => {
    for (const v of Object.values(RING)) {
      expect(v).toContain("var(--");
      expect(v).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it("command priority: run status beats justAdded beats highlighted", () => {
    const base = { active: false, done: false, error: false, cancelled: false };
    expect(commandRing({ ...base, active: true, justAdded: true })).toBe(RING.running);
    expect(commandRing({ ...base, done: true, highlighted: true })).toBe(RING.done);
    expect(commandRing({ ...base, justAdded: true, highlighted: true })).toBe(RING.justAdded);
    expect(commandRing({ ...base, highlighted: true })).toBe(RING.highlighted);
    expect(commandRing(base)).toBeUndefined();
  });

  it("agent mapping", () => {
    const base = { working: false, settled: false, error: false };
    expect(agentRing({ ...base, working: true })).toBe(RING.running);
    expect(agentRing({ ...base, error: true })).toBe(RING.error);
    expect(agentRing(base)).toBeUndefined();
  });

  it("nodes apply the ring inline, keep `.group` and the inline opacity", () => {
    const { container } = render(
      <CommandNode data={{ label: "/ship", runStatus: "active", dimmed: true }} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains("group")).toBe(true);
    expect(root.style.boxShadow).toContain("var(--running)");
    expect(root.style.opacity).toBe("0.35");
    expect(root.className).toContain("animate-glowPulse");

    const a = render(<AgentNode data={{ label: "reviewer", runStatus: "error" }} />);
    const aroot = a.container.firstElementChild as HTMLElement;
    expect(aroot.style.boxShadow).toContain("var(--danger)");
  });
});

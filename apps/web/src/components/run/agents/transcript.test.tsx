import { createRef } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { TranscriptRow } from "@symbion/core";
import { TranscriptRowView } from "./TranscriptRowView";
import { StepPreview } from "./StepPreview";
import { TranscriptList, type TranscriptListHandle } from "./TranscriptList";
import { A, syntheticView } from "./agentsTestUtil";

function row(i: number, extra?: Partial<TranscriptRow>): TranscriptRow {
  return {
    id: `${i + 1}:0`,
    seq: i + 1,
    ts: 1_000 + i,
    atMs: i * 1000,
    agentId: "root",
    kind: "tool",
    status: "ok",
    label: `Read f${i}.ts`,
    resultLabel: "3 lines",
    tool: "Read",
    preview: { input: `{"file_path":"f${i}.ts"}`, output: "a\nb\nc", truncated: false, isError: false },
    ...extra,
  };
}

const noop = () => {};

describe("TranscriptRowView (W-5 / W-6)", () => {
  const { view } = syntheticView("running");
  const rootRows = view.rowsByAgent.get("root")!;
  const aRows = view.rowsByAgent.get(A)!;

  it("thinking is faint; tool shows label · resultLabel; unknown is a neutral ? row", () => {
    const thinking = rootRows.find((r) => r.kind === "thinking")!;
    const { container, unmount } = render(
      <TranscriptRowView row={thinking} expanded={false} focused={false} isNew={false} live onToggle={noop} onOpenAgent={noop} />
    );
    expect(container.textContent).toContain("Thinking");
    expect(screen.getByText("Thinking").className).toContain("text-ink-faint");
    unmount();

    const read = aRows.find((r) => r.tool === "Read")!;
    render(<TranscriptRowView row={read} expanded={false} focused={false} isNew={false} live onToggle={noop} onOpenAgent={noop} />);
    expect(screen.getByText(/Read STATE\.md \(40–189\)/)).toBeTruthy();
    expect(screen.getByText(/· 150 lines/)).toBeTruthy();

    const unknown = rootRows.find((r) => r.kind === "unknown")!;
    render(<TranscriptRowView row={unknown} expanded={false} focused={false} isNew={false} live onToggle={noop} onOpenAgent={noop} />);
    expect(screen.getAllByRole("img", { name: "unrecognized" }).length).toBeGreaterThan(0);
  });

  it("spawn row shows › and calls onOpenAgent(childId) on click and Enter", () => {
    const spawn = rootRows.find((r) => r.kind === "spawn" && r.childAgentId === A)!;
    const onOpenAgent = vi.fn();
    render(<TranscriptRowView row={spawn} expanded={false} focused={false} isNew={false} live onToggle={noop} onOpenAgent={onOpenAgent} />);
    const btn = screen.getByRole("button", { name: /Open Agent ba "Requirements angle"/ });
    expect(btn.textContent).toContain("›");
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(onOpenAgent.mock.calls).toEqual([[A], [A]]);
  });

  it("W-6: error row — only the glyph is danger; OUTPUT header reads '· error'", () => {
    const bash = aRows.find((r) => r.tool === "Bash")!;
    const { container } = render(
      <TranscriptRowView row={bash} expanded focused={false} isNew={false} live onToggle={noop} onOpenAgent={noop} />
    );
    const glyph = screen.getByRole("img", { name: "error" });
    expect(glyph.className).toContain("text-danger");
    const label = container.querySelector("[title^='Bash npm test']") as HTMLElement;
    expect(label.className).not.toContain("text-danger");
    expect(label.className).toContain("text-ink");
    expect(within(screen.getByTestId("step-preview")).getByText("· error").className).toContain("text-danger");
  });

  it("plain-text rendering: markup in CLI output is shown literally, never parsed", () => {
    const hostile = row(0, { label: "<img src=x onerror=alert(1)>", preview: { output: "<b>bold</b>", truncated: false, isError: false } });
    const { container } = render(<TranscriptRowView row={hostile} expanded focused={false} isNew={false} live onToggle={noop} onOpenAgent={noop} />);
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>bold</b>");
  });
});

describe("StepPreview (W-7)", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
  });

  it("truncated output shows the explicit marker; Copy copies the stored preview exactly", () => {
    const stored = `${"x".repeat(50)}…[truncated 120 chars]`;
    render(<StepPreview kind="tool" preview={{ input: '{"a":1}', output: stored, truncated: true, isError: false }} pending={false} interrupted={false} />);
    expect(screen.getByText("⋯ truncated — preview capped at 2,000 chars")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy output" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(stored);
  });

  it("pending live -> waiting; pending terminal -> interrupted copy", () => {
    const { rerender } = render(<StepPreview kind="tool" preview={{ input: "{}", truncated: false, isError: false }} pending interrupted={false} />);
    expect(screen.getByText("waiting for result…")).toBeTruthy();
    rerender(<StepPreview kind="tool" preview={{ input: "{}", truncated: false, isError: false }} pending={false} interrupted />);
    expect(screen.getByText("◼ interrupted — no result recorded")).toBeTruthy();
    expect(screen.queryByText("waiting for result…")).toBeNull();
  });

  it("step tokens + legacy note", () => {
    render(
      <StepPreview
        kind="tool"
        preview={{ input: "{}", truncated: false, isError: false, stepTokens: { input: 1204, output: 88 } }}
        pending={false}
        interrupted={false}
        legacyTruncated
      />
    );
    expect(screen.getByText(/in 1,204 · out 88/)).toBeTruthy();
    expect(screen.getByText("result not recoverable (pre-upgrade run)")).toBeTruthy();
  });
});

function scrollEl(): HTMLElement {
  return screen.getByTestId("transcript-scroll");
}

describe("TranscriptList follow (W-8, AC-5)", () => {
  it("pins to the bottom, pauses on scroll-up, counts new rows, pill and jump resume; expanding pauses", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i));
    const ref = createRef<TranscriptListHandle>();
    const { rerender } = render(<TranscriptList ref={ref} rows={rows} live readOnly={false} animate={false} onOpenAgent={noop} />);
    const el = scrollEl();
    // total 600, viewport (fallback) 400
    expect(el.scrollTop).toBe(200);
    expect(screen.getByText("▼ following")).toBeTruthy();

    act(() => {
      el.scrollTop = 170;
      fireEvent.scroll(el);
    });
    expect(screen.queryByText("▼ following")).toBeNull();
    expect(screen.queryByText(/Jump to latest/)).toBeNull(); // hidden until a new row arrives

    const more = Array.from({ length: 37 }, (_, i) => row(i));
    rerender(<TranscriptList ref={ref} rows={more} live readOnly={false} animate={false} onOpenAgent={noop} />);
    expect(el.scrollTop).toBe(170); // never moved while paused
    const pill = screen.getByRole("button", { name: "↓ 7 new · Jump to latest" });
    fireEvent.click(pill);
    expect(el.scrollTop).toBe(37 * 20 - 400);
    expect(screen.getByText("▼ following")).toBeTruthy();

    // pause again, then the End-equivalent handle resumes
    act(() => {
      el.scrollTop = 100;
      fireEvent.scroll(el);
    });
    expect(screen.queryByText("▼ following")).toBeNull();
    act(() => ref.current!.jumpToLatest());
    expect(screen.getByText("▼ following")).toBeTruthy();

    // expanding a row pauses follow
    fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]!);
    expect(screen.queryByText("▼ following")).toBeNull();
    // Esc step 1: collapseAll reports it collapsed something
    let collapsed = false;
    act(() => {
      collapsed = ref.current!.collapseAll();
    });
    expect(collapsed).toBe(true);
    expect(ref.current!.collapseAll()).toBe(false);
  });

  it("readOnly: no pill and no following footer", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i));
    render(<TranscriptList rows={rows} live readOnly animate={false} onOpenAgent={noop} />);
    const el = scrollEl();
    act(() => {
      el.scrollTop = 0;
      fireEvent.scroll(el);
    });
    expect(screen.queryByText("▼ following")).toBeNull();
    expect(screen.queryByText(/Jump to latest/)).toBeNull();
  });
});

describe("TranscriptList virtualization (W-9, AC-10)", () => {
  it("2,500 rows in a 400px viewport render ≤ 60 elements; middle scroll renders ~1,250; spacer = 2,500 × 20", () => {
    const rows = Array.from({ length: 2_500 }, (_, i) => row(i));
    const { container } = render(<TranscriptList rows={rows} live={false} readOnly animate={false} onOpenAgent={noop} />);
    expect(container.querySelectorAll("[data-row-id]").length).toBeLessThanOrEqual(60);
    expect(screen.getByTestId("transcript-spacer").style.height).toBe("50000px");
    const el = scrollEl();
    act(() => {
      el.scrollTop = 1_250 * 20;
      fireEvent.scroll(el);
    });
    const idx = [...container.querySelectorAll("[data-index]")].map((e) => Number(e.getAttribute("data-index")));
    expect(idx.length).toBeLessThanOrEqual(60);
    expect(idx).toContain(1_250);
    expect(Math.min(...idx)).toBeGreaterThan(1_200);
  });

  it("an expanded row adds its (estimated) height delta to the spacer", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i));
    render(<TranscriptList rows={rows} live={false} readOnly animate={false} onOpenAgent={noop} />);
    fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]!);
    const h = parseInt(screen.getByTestId("transcript-spacer").style.height);
    expect(h).toBeGreaterThan(10 * 20);
  });
});

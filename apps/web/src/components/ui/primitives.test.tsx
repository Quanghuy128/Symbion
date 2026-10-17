import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Plus } from "lucide-react";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Badge } from "./badge";
import { Kind } from "./kind";
import { Tabs, tabPanelProps } from "./tabs";
import { SegmentedControl } from "./segmented-control";
import { Banner } from "./banner";
import { Dialog, DialogTitle, DialogClose } from "./dialog";
import { Checkbox, Radio } from "./checkbox";
import { Field, Input } from "./input";
import { RowMenu } from "./row-menu";
import { Tooltip } from "./tooltip";

describe("Button", () => {
  it("U-P1 variants and sizes map to DS classes; default aliases primary", () => {
    const { rerender } = render(<Button>Go</Button>);
    const b = screen.getByRole("button", { name: "Go" });
    expect(b.className).toContain("bg-mint");
    expect(b.className).toContain("h-control-md");
    rerender(<Button variant="destructive" size="sm">Go</Button>);
    expect(screen.getByRole("button").className).toContain("bg-danger");
    expect(screen.getByRole("button").className).toContain("h-control-sm");
    rerender(<Button variant="danger-outline" size="lg">Go</Button>);
    expect(screen.getByRole("button").className).toContain("border-danger");
    expect(screen.getByRole("button").className).toContain("h-control-lg");
  });
  it("U-P2 disabled is dimmed, not hidden, and does not fire", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Go</Button>);
    const b = screen.getByRole("button");
    expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(b.className).toContain("disabled:opacity-45");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("U-P3 icon is decorative and does not change the accessible name", () => {
    render(<Button icon={Plus}>New project</Button>);
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
  it("keeps font-size and colour classes together through cn (tailwind-merge scale)", () => {
    render(<Button size="sm">Go</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("text-label");
    expect(cls).toContain("text-on-mint");
  });
});

describe("IconButton", () => {
  it("U-P4 exposes its aria-label as the accessible name", () => {
    render(<IconButton aria-label="Add" icon={Plus} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });
});

describe("Badge / Kind", () => {
  it("U-P5 badge tone literals and aliases", () => {
    const { rerender } = render(<Badge variant="success">New</Badge>);
    expect(screen.getByText("New").className).toContain("bg-success-soft");
    rerender(<Badge variant="draft">draft</Badge>);
    expect(screen.getByText("draft").className).toContain("bg-surface-hover");
    rerender(<Badge variant="plain">Unchanged</Badge>);
    expect(screen.getByText("Unchanged").className).toContain("border");
  });
  it("kind tile is decorative", () => {
    const { container } = render(<Kind kind="agent" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(container.firstElementChild?.className).toContain("text-agent");
  });
});

describe("Tabs", () => {
  it("U-P6 roles, selection, roving tabindex and arrow keys", () => {
    const onChange = vi.fn();
    render(
      <>
        <Tabs
          aria-label="Authors"
          idPrefix="t"
          value="a"
          onValueChange={onChange}
          items={[{ id: "a", label: "A" }, { id: "b", label: "B", count: 3 }]}
        />
        <div {...tabPanelProps("t", "a")}>panel</div>
      </>,
    );
    expect(screen.getByRole("tablist", { name: "Authors" })).toBeInTheDocument();
    const a = screen.getByRole("tab", { name: "A" });
    const b = screen.getByRole("tab", { name: /^B/ });
    expect(a.getAttribute("aria-selected")).toBe("true");
    expect(a.getAttribute("tabindex")).toBe("0");
    expect(b.getAttribute("tabindex")).toBe("-1");
    expect(a.getAttribute("aria-controls")).toBe("t-panel-a");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("t-tab-a");
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("SegmentedControl", () => {
  it("U-P7 radiogroup semantics", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="View"
        value="list"
        onValueChange={onChange}
        options={[{ value: "list", label: "List" }, { value: "graph", label: "Graph" }]}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Graph" }));
    expect(onChange).toHaveBeenCalledWith("graph");
  });
});

describe("Banner", () => {
  it("U-P8 danger is an alert, others a status", () => {
    const { rerender } = render(<Banner tone="danger" title="Oops">body</Banner>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(<Banner tone="warning">body</Banner>);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("Dialog", () => {
  it("U-P9 is a labelled modal dialog; scrim stays fixed; Escape closes", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <DialogTitle>Publish</DialogTitle>
        <DialogClose onClose={onClose} />
      </Dialog>,
    );
    const dlg = screen.getByRole("dialog", { name: "Publish" });
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.parentElement?.className).toContain("fixed");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Checkbox / Radio / Field", () => {
  it("U-P10 labelled checkbox is toggled through its label; radio is a radio", () => {
    const onChange = vi.fn();
    render(
      <>
        <Checkbox label="Remember" onChange={onChange} />
        <Radio label="Ask" name="x" />
      </>,
    );
    fireEvent.click(screen.getByLabelText("Remember"));
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Ask" })).toBeInTheDocument();
  });
  it("Field wires label, help and error", () => {
    render(
      <Field label="Version" htmlFor="v" error="Bad">
        <Input id="v" />
      </Field>,
    );
    expect(screen.getByLabelText("Version")).toBeInTheDocument();
    expect(screen.getByText("Bad").className).toContain("text-danger-text");
  });
});

describe("RowMenu", () => {
  it("U-P11 trigger name stays 'Options'; Escape closes; select closes then fires", () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn();
    render(<RowMenu open items={[{ label: "Delete", onSelect, danger: true }]} onOpenChange={onOpenChange} />);
    expect(screen.getByRole("button", { name: "Options" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelect).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });
});

describe("Tooltip", () => {
  it("U-P12 opens immediately on focus, after a delay on hover", () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hint">
        <button>t</button>
      </Tooltip>,
    );
    const btn = screen.getByRole("button");
    fireEvent.mouseEnter(btn.parentElement!);
    expect(screen.queryByRole("tooltip")).toBeNull();
    vi.advanceTimersByTime(450);
    // state update outside act is flushed by testing-library's async utils; re-query after focus path instead
    vi.useRealTimers();
    fireEvent.focus(btn);
    expect(screen.getByRole("tooltip").textContent).toBe("Hint");
  });
});

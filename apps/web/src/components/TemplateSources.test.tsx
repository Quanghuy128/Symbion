import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TemplateListItem } from "@symbion/core";
import { assessTemplateTools } from "@symbion/core";
import { AuthorTabs } from "./AuthorTabs";
import { TemplateCard } from "./TemplateCard";
import { ToolRiskPanel } from "./ToolRiskPanel";
import { TemplateSourceMappingForm } from "./TemplateSourceMappingForm";
import { AddTemplateSourceDialog } from "./AddTemplateSourceDialog";
import { TemplatePreviewModal } from "./TemplatePreviewModal";
import { DaemonRpcError } from "@/lib/rpc/client";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./TemplateMarkdownViewer", () => ({ TemplateMarkdownViewer: () => <div data-testid="md-viewer" /> }));

const item = (over: Partial<TemplateListItem> = {}): TemplateListItem => ({
  id: "ecc:agents/a.md",
  kind: "agent",
  name: "an-agent",
  description: "desc",
  raw: "---\nname: an-agent\ndescription: desc\n---\nbody",
  authorId: "ecc",
  authorDisplayName: "ECC",
  authorRepoLabel: "affaan-m/ecc",
  ...over,
});

describe("W1 AuthorTabs", () => {
  it("renders the Unverified badge inside the tab label, with no nested button", () => {
    render(
      <AuthorTabs
        authors={[
          { id: "symbion", label: "Symbion" },
          { id: "u-0123456789", label: "My src", unverified: true },
        ]}
        selectedId="symbion"
        onSelect={() => {}}
      />
    );
    const tabs = screen.getAllByRole("tab");
    expect(within(tabs[1]!).getByText("Unverified")).toBeInTheDocument();
    expect(within(tabs[0]!).queryByText("Unverified")).toBeNull();
    for (const t of tabs) expect(t.querySelector("button")).toBeNull();
  });
});

describe("W2 TemplateCard", () => {
  it("carries no Unverified badge of its own (the tab, preview and license step flag the source)", () => {
    const { rerender } = render(<TemplateCard item={item({ authorId: "u-0123456789", authorOrigin: "user" })} onClick={() => {}} />);
    expect(screen.queryByText("Unverified")).toBeNull();
    rerender(<TemplateCard item={item({ authorId: "u-0123456789" })} onClick={() => {}} />);
    expect(screen.queryByText("Unverified")).toBeNull();
    rerender(<TemplateCard item={item()} onClick={() => {}} />);
    expect(screen.queryByText("Unverified")).toBeNull();
  });
});

describe("W3 ToolRiskPanel", () => {
  it("highlights high-risk tools, implicit all-tools, declared allowed-tools, inline shell; renders hostile text literally", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const { container, rerender } = render(
      <ToolRiskPanel kind="agent" assessment={assessTemplateTools({ kind: "agent", tools: ["Read", "Bash(git:*)", evil], raw: "" })} />
    );
    expect(screen.getByText("Bash(git:*)")).toBeInTheDocument();
    expect(screen.getByText("runs shell commands")).toBeInTheDocument();
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();

    rerender(<ToolRiskPanel kind="agent" assessment={assessTemplateTools({ kind: "agent", raw: "" })} />);
    expect(screen.getByText(/inherits ALL tools/)).toBeInTheDocument();

    rerender(
      <ToolRiskPanel
        kind="command"
        assessment={assessTemplateTools({ kind: "command", raw: "---\ndescription: d\nallowed-tools: Bash(git add:*), Read\n---\nrun !`ls`" })}
      />
    );
    expect(screen.getByText("Bash(git add:*)")).toBeInTheDocument();
    expect(screen.getByText(/not applied by/)).toBeInTheDocument();
    expect(screen.getByText(/inline shell commands/)).toBeInTheDocument();
    expect(screen.getByText(/Unverified source/)).toBeInTheDocument();
  });
});

describe("W4 TemplatePreviewModal", () => {
  beforeEach(() => {
    useArtifactStore.setState({ projects: [{ id: "p", name: "P", path: "/p" }], daemonConnected: true });
  });

  it("user item: Unverified badge + risk panel; ECC item: neither", () => {
    const { unmount } = render(<TemplatePreviewModal template={item({ authorId: "u-0123456789", authorOrigin: "user" })} onClose={() => {}} />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByTestId("tool-risk-panel")).toBeInTheDocument();
    unmount();
    render(<TemplatePreviewModal template={item()} onClose={() => {}} />);
    expect(screen.queryByText("Unverified")).toBeNull();
    expect(screen.queryByTestId("tool-risk-panel")).toBeNull();
  });

  it("license step carries the unverified copy only for user items", () => {
    render(<TemplatePreviewModal template={item({ authorId: "u-0123456789", authorOrigin: "user", tools: ["Read"] })} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByText(/unverified — Symbion has not reviewed it/)).toBeInTheDocument();
  });
});

describe("W6 TemplateSourceMappingForm", () => {
  it("offers (this folder) + dirs with counts and emits only non-none rows", () => {
    const onChange = vi.fn();
    render(
      <TemplateSourceMappingForm
        rootDirs={[
          { path: ".", mdFiles: 4, skillFiles: 0 },
          { path: "docs", mdFiles: 2, skillFiles: 1 },
        ]}
        detected={[]}
        value={[]}
        onChange={onChange}
      />
    );
    const agents = screen.getByLabelText("Agents");
    expect(within(agents).getByText("(this folder) (4 .md)")).toBeInTheDocument();
    expect(within(agents).getByText("docs (2 .md)")).toBeInTheDocument();
    fireEvent.change(agents, { target: { value: "." } });
    expect(onChange).toHaveBeenLastCalledWith([{ bucket: "agent", path: "." }]);
    fireEvent.change(screen.getByLabelText("Skills"), { target: { value: "docs" } });
    expect(onChange).toHaveBeenLastCalledWith([{ bucket: "skill", path: "docs" }]);
  });
});

describe("W5 AddTemplateSourceDialog", () => {
  const success = {
    status: "success" as const,
    inspectToken: "a".repeat(32),
    owner: "acme",
    repo: "tools",
    ref: null,
    refLabel: "default branch",
    rootPath: "",
    commitSha: "c".repeat(40),
    truncated: false,
    detected: [{ bucket: "agent" as const, path: "agents", count: 2 }],
    rootDirs: [{ path: ".", mdFiles: 0, skillFiles: 0 }, { path: "agents", mdFiles: 2, skillFiles: 0 }],
    suggestedDisplayName: "acme/tools",
  };
  const source = { id: "u-0123456789", displayName: "acme/tools", owner: "acme", repo: "tools", ref: null, refLabel: "default branch", rootPath: "", folders: [{ bucket: "agent" as const, path: "agents" }], addedAt: "2026-10-19T10:00:00.000Z" };

  function setup(over: Record<string, unknown> = {}) {
    const inspect = vi.fn().mockResolvedValue({ outcome: success });
    const add = vi.fn().mockResolvedValue({ source });
    useArtifactStore.setState({ inspectTemplateSourceUrl: inspect, addTemplateSource: add, ...over } as never);
    const onAdded = vi.fn();
    const onOpenExisting = vi.fn();
    render(<AddTemplateSourceDialog daemonConnected onClose={() => {}} onAdded={onAdded} onOpenExisting={onOpenExisting} />);
    return { inspect, add, onAdded, onOpenExisting };
  }
  const typeUrl = (v: string) => fireEvent.change(screen.getByLabelText("GitHub link"), { target: { value: v } });

  it("Check disabled when empty; invalid-url error shown inline", async () => {
    const inspect = vi.fn().mockRejectedValue(new DaemonRpcError({ code: "invalid-url", message: "Use https:// (http is not allowed)." }));
    setup({ inspectTemplateSourceUrl: inspect });
    expect(screen.getByRole("button", { name: "Check" })).toBeDisabled();
    typeUrl("http://github.com/a/b");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Use https:// (http is not allowed).")).toBeInTheDocument();
  });

  it("success pre-fills name + mapping; Add disabled with no mapping; add calls the token-only RPC", async () => {
    const { add, onAdded } = setup();
    typeUrl("https://github.com/acme/tools");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByLabelText("Display name")).toHaveValue("acme/tools");
    expect(screen.getByLabelText("Agents")).toHaveValue("agents");
    fireEvent.change(screen.getByLabelText("Agents"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Add source" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Agents"), { target: { value: "agents" } });
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(source));
    expect(add).toHaveBeenCalledWith({ inspectToken: "a".repeat(32), displayName: "acme/tools", folders: [{ bucket: "agent", path: "agents" }] });
  });

  it("duplicateOf shows Already added + Open tab", async () => {
    const inspect = vi.fn().mockResolvedValue({ outcome: { ...success, duplicateOf: { id: "ecc", displayName: "ECC" } } });
    const { onOpenExisting } = setup({ inspectTemplateSourceUrl: inspect });
    typeUrl("https://github.com/affaan-m/ecc");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText(/Already added as "ECC"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open tab" }));
    expect(onOpenExisting).toHaveBeenCalledWith("ecc");
  });

  it("inspect-expired on add re-inspects exactly once and retries with the fresh token", async () => {
    const inspect = vi
      .fn()
      .mockResolvedValueOnce({ outcome: success })
      .mockResolvedValueOnce({ outcome: { ...success, inspectToken: "b".repeat(32) } });
    const add = vi
      .fn()
      .mockRejectedValueOnce(new DaemonRpcError({ code: "inspect-expired", message: "expired" }))
      .mockResolvedValueOnce({ source });
    const { onAdded } = setup({ inspectTemplateSourceUrl: inspect, addTemplateSource: add });
    typeUrl("https://github.com/acme/tools");
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByLabelText("Display name");
    fireEvent.click(screen.getByRole("button", { name: "Add source" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenLastCalledWith(expect.objectContaining({ inspectToken: "b".repeat(32) }));
  });
});

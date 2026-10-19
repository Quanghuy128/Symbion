import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TemplatesView } from "./TemplatesView";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./shell/Sidebar", () => ({ Sidebar: () => <div /> }));
vi.mock("./TemplateMarkdownViewer", () => ({ TemplateMarkdownViewer: () => <div /> }));
vi.mock("@/lib/rpc/client", async (orig) => ({ ...(await orig<typeof import("@/lib/rpc/client")>()), initDaemonSession: vi.fn() }));

const src = (id: string, name: string) => ({
  id,
  displayName: name,
  owner: "acme",
  repo: "tools",
  ref: null,
  refLabel: "default branch",
  rootPath: "",
  folders: [{ bucket: "agent" as const, path: "agents" }],
  addedAt: "2026-10-19T10:00:00.000Z",
});
const SHA = "c".repeat(40);

function setStore(over: Record<string, unknown>) {
  useArtifactStore.setState({
    daemonConnected: true,
    projects: [],
    loadProjects: vi.fn().mockResolvedValue(undefined),
    startHeartbeat: vi.fn(() => () => {}),
    ...over,
  } as never);
}

describe("W7 TemplatesView with user sources", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/templates");
  });

  it("lists user sources as extra Unverified tabs; built-in tabs render", async () => {
    setStore({
      listTemplateSources: vi.fn().mockResolvedValue({ sources: [src("u-0123456789", "Mine")], invalidCount: 1, maxSources: 20 }),
      fetchAuthorTemplates: vi.fn(),
    });
    render(<TemplatesView />);
    expect(await screen.findByRole("tab", { name: /Mine/ })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(within(screen.getByRole("tab", { name: /Mine/ })).getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText(/1 saved source could not be read/)).toBeInTheDocument();
  });

  it("removing the selected source falls back to Symbion and clears it", async () => {
    const remove = vi.fn().mockResolvedValue({ removed: true });
    const fetchTemplates = vi.fn().mockResolvedValue({ outcome: { status: "success", items: [], skipped: [], commitSha: SHA, refLabel: "default branch", truncated: false } });
    setStore({
      listTemplateSources: vi.fn().mockResolvedValue({ sources: [src("u-0123456789", "Mine")], invalidCount: 0, maxSources: 20 }),
      removeTemplateSource: remove,
      fetchAuthorTemplates: fetchTemplates,
      showToast: vi.fn(),
    });
    render(<TemplatesView />);
    fireEvent.click(await screen.findByRole("tab", { name: /Mine/ }));
    expect(await screen.findByTestId("source-header")).toBeInTheDocument();
    expect(await screen.findByText(/No files matched/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: "u-0123456789" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Mine/ })).toBeNull());
    expect(screen.getByRole("tab", { name: "Symbion" })).toHaveAttribute("aria-selected", "true");
  });

  it("daemon offline: Add disabled, built-in tabs still render", () => {
    setStore({ daemonConnected: false, listTemplateSources: vi.fn(), fetchAuthorTemplates: vi.fn() });
    render(<TemplatesView />);
    expect(screen.getByRole("button", { name: "+ Add source" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Symbion" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ECC" })).toBeInTheDocument();
  });

  it("a late fetch result for a removed source does not re-create state or tab", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const pending = new Promise((r) => (resolveFetch = r));
    const list = vi
      .fn()
      .mockResolvedValueOnce({ sources: [src("u-0123456789", "Mine")], invalidCount: 0, maxSources: 20 })
      .mockResolvedValue({ sources: [], invalidCount: 0, maxSources: 20 });
    setStore({
      listTemplateSources: list,
      removeTemplateSource: vi.fn().mockResolvedValue({ removed: true }),
      fetchAuthorTemplates: vi.fn(() => pending),
      showToast: vi.fn(),
    });
    render(<TemplatesView />);
    fireEvent.click(await screen.findByRole("tab", { name: /Mine/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /Mine/ })).toBeNull());
    await act(async () => {
      resolveFetch({ outcome: { status: "success", items: [], skipped: [] } });
    });
    expect(screen.queryByRole("tab", { name: /Mine/ })).toBeNull();
    expect(screen.queryByTestId("source-header")).toBeNull();
  });
});

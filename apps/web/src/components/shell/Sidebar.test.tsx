import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useArtifactStore } from "@/lib/store/useArtifactStore";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { Sidebar, RAIL_COLLAPSED_STORAGE_KEY } from "./Sidebar";

function mockWide(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

const projects = [
  { id: "p1", name: "alpha", path: "/tmp/alpha" },
  { id: "p2", name: "beta", path: "/tmp/beta" },
] as never;

// jsdom's localStorage is unreliable under newer Node (experimental global
// localStorage), so tests install a plain in-memory stand-in.
let store: Map<string, string>;
function installStorage(getItem?: (k: string) => string | null) {
  store = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: getItem ?? ((k: string) => store.get(k) ?? null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

beforeEach(() => {
  pathname = "/";
  installStorage();
  mockWide(true);
  useArtifactStore.setState({ projects, currentProject: null, daemonReachable: true } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("Sidebar", () => {
  it("U-S1 renders primary nav, project list (only existing data) and daemon status", () => {
    render(<Sidebar onCreateProject={() => {}} onSelectProject={() => {}} />);
    expect(screen.getByRole("link", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Templates" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText(/daemon · connected/)).toBeInTheDocument();
    expect(screen.queryByText(/pinned|recent/i)).toBeNull();
  });

  it("U-S2 selecting a project and the new-project button call back; remove keeps the confirm", () => {
    const onSelect = vi.fn();
    const onCreate = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);
    useArtifactStore.setState({ removeProject: remove } as never);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Sidebar onCreateProject={onCreate} onSelectProject={onSelect} />);
    fireEvent.click(screen.getByText("alpha"));
    expect(onSelect).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(onCreate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove alpha" }));
    expect(confirm).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("U-S3 the toggle collapses to a 56px icon rail and persists the choice", () => {
    render(<Sidebar onCreateProject={() => {}} onSelectProject={() => {}} />);
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    const aside = document.querySelector("aside")!;
    expect(aside.getAttribute("data-collapsed")).toBe("true");
    expect(aside.className).toContain("w-rail");
    expect(window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY)).toBe("1");
    // icon rail keeps every destination reachable by accessible name
    expect(screen.getByRole("link", { name: "Templates" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "alpha" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false");
    expect(window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY)).toBe("0");
  });

  it("U-S4 narrow viewports force the icon rail (no toggle)", () => {
    mockWide(false);
    render(<Sidebar onCreateProject={() => {}} onSelectProject={() => {}} />);
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true");
    expect(screen.queryByRole("button", { name: /sidebar/ })).toBeNull();
  });

  it("restores a persisted collapsed state and survives unavailable storage", () => {
    window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, "1");
    const { unmount } = render(<Sidebar onCreateProject={() => {}} onSelectProject={() => {}} />);
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("true");
    unmount();
    installStorage(() => {
      throw new Error("denied");
    });
    render(<Sidebar onCreateProject={() => {}} onSelectProject={() => {}} />);
    expect(document.querySelector("aside")?.getAttribute("data-collapsed")).toBe("false");
  });
});

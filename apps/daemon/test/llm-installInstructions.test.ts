import { afterEach, describe, expect, it, vi } from "vitest";

const originalPlatform = process.platform;
let mockedRelease = "5.15.0-91-generic";

// `os.release()` cannot be reliably reassigned via `vi.spyOn` on the real `node:os`
// module object (its exports are non-configurable in Node's ESM interop layer), so this
// mocks the whole module instead — `installInstructions.ts` imports `release` from
// "node:os" via a named import, which vitest's `vi.mock` intercepts at the module-resolution
// level regardless of how the mocked implementation is internally re-assigned per test.
vi.mock("node:os", () => ({
  release: () => mockedRelease,
}));

function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", { value });
}

function mockRelease(value: string): void {
  mockedRelease = value;
}

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  mockedRelease = "5.15.0-91-generic";
});

describe("detectHostEnvironment", () => {
  it("TC-1: darwin -> macos, confident", async () => {
    const { detectHostEnvironment } = await import("../src/llm/installInstructions.js");
    setPlatform("darwin");
    expect(detectHostEnvironment()).toEqual({ kind: "macos", label: "macOS" });
  });

  it("TC-2: win32 -> windows, confident", async () => {
    const { detectHostEnvironment } = await import("../src/llm/installInstructions.js");
    setPlatform("win32");
    expect(detectHostEnvironment()).toEqual({ kind: "windows", label: "Windows" });
  });

  it("TC-3: linux + microsoft/WSL2 kernel release (this session's own string) -> wsl", async () => {
    const { detectHostEnvironment } = await import("../src/llm/installInstructions.js");
    setPlatform("linux");
    mockRelease("6.6.87.2-microsoft-standard-WSL2");
    expect(detectHostEnvironment()).toEqual({ kind: "wsl", label: "WSL2 (Ubuntu on Windows)" });
  });

  it("TC-4: linux + native Ubuntu kernel release (no microsoft/wsl substring) -> linux", async () => {
    const { detectHostEnvironment } = await import("../src/llm/installInstructions.js");
    setPlatform("linux");
    mockRelease("5.15.0-91-generic");
    expect(detectHostEnvironment()).toEqual({ kind: "linux", label: "Linux" });
  });

  it("TC-5: linux + uppercase MICROSOFT in release string -> wsl (case-insensitive match)", async () => {
    const { detectHostEnvironment } = await import("../src/llm/installInstructions.js");
    setPlatform("linux");
    mockRelease("4.19.0-MICROSOFT");
    expect(detectHostEnvironment().kind).toBe("wsl");
  });

  it("TC-6: freebsd (outside the 4 known platforms) -> unknown, not confident", async () => {
    const { detectHostEnvironment, getOllamaInstallInstructions } = await import("../src/llm/installInstructions.js");
    setPlatform("freebsd");
    const env = detectHostEnvironment();
    expect(env).toEqual({ kind: "unknown", label: "Unknown" });
    expect(getOllamaInstallInstructions(env).confident).toBe(false);
  });

  it("TC-10: never throws for any NodeJS.Platform value Node's type defs allow", async () => {
    const { detectHostEnvironment } = await import("../src/llm/installInstructions.js");
    const platforms = [
      "aix",
      "android",
      "darwin",
      "freebsd",
      "haiku",
      "linux",
      "openbsd",
      "sunos",
      "win32",
      "cygwin",
      "netbsd",
    ];
    mockRelease("5.15.0-91-generic");
    for (const p of platforms) {
      setPlatform(p);
      expect(() => detectHostEnvironment()).not.toThrow();
      const env = detectHostEnvironment();
      expect(typeof env.kind).toBe("string");
      expect(typeof env.label).toBe("string");
      expect(env.label.length).toBeGreaterThan(0);
    }
  });
});

describe("getOllamaInstallInstructions", () => {
  it("TC-7: confident case -> variants has length 1, matching the OS's single command", async () => {
    const { detectHostEnvironment, getOllamaInstallInstructions } = await import("../src/llm/installInstructions.js");
    setPlatform("darwin");
    const env = detectHostEnvironment();
    const install = getOllamaInstallInstructions(env);
    expect(install.confident).toBe(true);
    expect(install.variants).toHaveLength(1);
    expect(install.variants[0]!.command).toContain("brew install ollama");
  });

  it("TC-8: unconfident case -> variants has length 4, all known OS variants with non-empty label/command", async () => {
    const { detectHostEnvironment, getOllamaInstallInstructions } = await import("../src/llm/installInstructions.js");
    setPlatform("freebsd");
    const env = detectHostEnvironment();
    const install = getOllamaInstallInstructions(env);
    expect(install.confident).toBe(false);
    expect(install.variants).toHaveLength(4);
    for (const v of install.variants) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.command.length).toBeGreaterThan(0);
    }
  });

  it("TC-9: wsl and linux resolve to the same install command string, only the label differs", async () => {
    const { detectHostEnvironment, getOllamaInstallInstructions } = await import("../src/llm/installInstructions.js");
    setPlatform("linux");
    mockRelease("6.6.87.2-microsoft-standard-WSL2");
    const wslInstall = getOllamaInstallInstructions(detectHostEnvironment());

    mockRelease("5.15.0-91-generic");
    const linuxInstall = getOllamaInstallInstructions(detectHostEnvironment());

    expect(wslInstall.variants[0]!.command).toBe(linuxInstall.variants[0]!.command);
    expect(wslInstall.variants[0]!.command).toBe("curl -fsSL https://ollama.com/install.sh | sh && ollama serve");
    expect(wslInstall.env.label).not.toBe(linuxInstall.env.label);
  });
});

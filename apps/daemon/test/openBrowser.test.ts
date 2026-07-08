import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execMock = vi.fn();

vi.mock("node:child_process", () => ({
  exec: (...args: unknown[]) => execMock(...args),
}));

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

describe("openInBrowser", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM);
  });

  it("TC-OPEN-1: on win32, invokes exec with `start \"\" \"<url>\"` (empty title before the URL)", async () => {
    setPlatform("win32");
    const { openInBrowser } = await import("../src/boot/openBrowser.js");
    execMock.mockImplementation((_cmd: string, cb: (err: Error | null) => void) => cb(null));

    openInBrowser("http://127.0.0.1:20132/?t=abc", () => undefined);

    expect(execMock).toHaveBeenCalledTimes(1);
    const [cmd] = execMock.mock.calls[0]!;
    expect(cmd).toBe('start "" "http://127.0.0.1:20132/?t=abc"');
    expect(cmd).not.toMatch(/^start "http/);
  });

  it("TC-OPEN-2: on darwin, uses `open`; on linux, uses `xdg-open`", async () => {
    const { openInBrowser } = await import("../src/boot/openBrowser.js");
    execMock.mockImplementation((_cmd: string, cb: (err: Error | null) => void) => cb(null));

    setPlatform("darwin");
    openInBrowser("http://127.0.0.1:20132/?t=abc", () => undefined);
    expect(execMock.mock.calls[0]![0]).toBe('open "http://127.0.0.1:20132/?t=abc"');

    execMock.mockClear();
    setPlatform("linux");
    openInBrowser("http://127.0.0.1:20132/?t=abc", () => undefined);
    expect(execMock.mock.calls[0]![0]).toBe('xdg-open "http://127.0.0.1:20132/?t=abc"');
  });

  it("TC-OPEN-3: calls onFailure exactly once on error, never on success", async () => {
    const { openInBrowser } = await import("../src/boot/openBrowser.js");

    setPlatform("win32");
    execMock.mockImplementation((_cmd: string, cb: (err: Error | null) => void) => cb(new Error("boom")));
    const onFailureErr = vi.fn();
    openInBrowser("http://127.0.0.1:20132/?t=abc", onFailureErr);
    expect(onFailureErr).toHaveBeenCalledTimes(1);
    expect(onFailureErr.mock.calls[0]![0]).toMatch(/thủ công|manually|url/i);

    execMock.mockImplementation((_cmd: string, cb: (err: Error | null) => void) => cb(null));
    const onFailureOk = vi.fn();
    openInBrowser("http://127.0.0.1:20132/?t=abc", onFailureOk);
    expect(onFailureOk).not.toHaveBeenCalled();
  });

  it("TC-OPEN-4: never throws synchronously even if exec calls back immediately with an error", async () => {
    const { openInBrowser } = await import("../src/boot/openBrowser.js");
    setPlatform("win32");
    execMock.mockImplementation((_cmd: string, cb: (err: Error | null) => void) => cb(new Error("boom")));
    expect(() => openInBrowser("http://127.0.0.1:20132/?t=abc", () => undefined)).not.toThrow();
  });
});

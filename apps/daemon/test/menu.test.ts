import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { showBootMenu } from "../src/boot/menu.js";

/**
 * showBootMenu reads from process.stdin via readline.createInterface. To test
 * it headlessly (per connect-providers-STATE.md §12.2's stdin-feed precedent,
 * adapted here for Vitest since there is no stream-injection parameter on
 * showBootMenu's signature), we stub process.stdin as a minimal Readable-like
 * EventEmitter and feed it lines, while spying on console.log to assert what
 * gets printed.
 */
function makeFakeStdin() {
  const emitter = new EventEmitter() as EventEmitter & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
    resume?: () => void;
    pause?: () => void;
    setEncoding?: (enc: string) => void;
  };
  emitter.isTTY = false;
  emitter.setRawMode = () => undefined;
  emitter.resume = () => emitter;
  emitter.pause = () => emitter;
  emitter.setEncoding = () => emitter;
  return emitter;
}

describe("showBootMenu", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let fakeStdin: ReturnType<typeof makeFakeStdin>;
  let originalStdin: NodeJS.ReadStream;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    fakeStdin = makeFakeStdin();
    originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true });
  });

  afterEach(() => {
    logSpy.mockRestore();
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
  });

  function feed(line: string) {
    fakeStdin.emit("data", `${line}\n`);
  }

  it("TC-MENU-1: feeding '1' resolves to 'web'", async () => {
    const promise = showBootMenu("http://127.0.0.1:12802/?t=abc");
    feed("1");
    await expect(promise).resolves.toBe("web");
  });

  it("TC-MENU-2: feeding '2' resolves to 'tray' (changed mapping)", async () => {
    const promise = showBootMenu("http://127.0.0.1:12802/?t=abc");
    feed("2");
    await expect(promise).resolves.toBe("tray");
  });

  it("TC-MENU-3: feeding '3' resolves to 'exit' (changed mapping)", async () => {
    const promise = showBootMenu("http://127.0.0.1:12802/?t=abc");
    feed("3");
    await expect(promise).resolves.toBe("exit");
  });

  it("TC-MENU-4: feeding '4' is invalid, retries, then a valid digit resolves", async () => {
    const promise = showBootMenu("http://127.0.0.1:12802/?t=abc");
    feed("4");
    // allow the invalid-input branch's console.log + re-ask to run before feeding again
    await new Promise((r) => setTimeout(r, 0));
    feed("1");
    await expect(promise).resolves.toBe("web");
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("Invalid choice"))).toBe(true);
  });

  it("TC-MENU-5: prints only the menu line, no banner border / version / Server line", async () => {
    const promise = showBootMenu("http://127.0.0.1:12802/?t=abc");
    feed("1");
    await promise;
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => /={3,}/.test(l))).toBe(false);
    expect(lines.some((l) => /^\s*Symbion — Choose Interface/.test(l))).toBe(false);
    expect(lines.some((l) => /^\s*Server:/.test(l))).toBe(false);
    expect(lines.some((l) => l.includes("1) Web UI") && l.includes("2) Hide to Tray") && l.includes("3) Exit"))).toBe(
      true
    );
  });

  it("TC-MENU-6: invalid-input retry reprints only the menu line, not a full banner", async () => {
    const promise = showBootMenu("http://127.0.0.1:12802/?t=abc");
    feed("9");
    await new Promise((r) => setTimeout(r, 0));
    feed("3");
    await promise;
    const menuLineCalls = logSpy.mock.calls.filter(
      (c) => String(c[0]).includes("1) Web UI") && String(c[0]).includes("2) Hide to Tray")
    );
    // printed once for the first (invalid) prompt, once for the retry prompt — never a banner block.
    expect(menuLineCalls.length).toBe(2);
  });

  it("TC-MENU-7 (type-level): BootChoice still includes 'terminal' in its TS union", () => {
    // Compile-time check: this assignment only type-checks if "terminal" is
    // still a member of BootChoice. No runtime assertion needed beyond the
    // fact that this file compiles under `tsc --noEmit`.
    type BootChoiceImport = Parameters<typeof showBootMenu>[0] extends string
      ? Awaited<ReturnType<typeof showBootMenu>>
      : never;
    const x: BootChoiceImport = "terminal";
    expect(x).toBe("terminal");
  });
});

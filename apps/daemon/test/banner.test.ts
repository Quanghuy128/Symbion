import { describe, expect, it } from "vitest";
import { buildBootBanner, supportsEmoji } from "../src/boot/banner.js";

const SAMPLE_URL = "http://127.0.0.1:20132/?t=abc";

describe("buildBootBanner", () => {
  it("TC-BAN-1: non-TTY returns the exact plain two-line form (byte-identical to today)", () => {
    const lines = buildBootBanner({ version: "0.1.0", url: SAMPLE_URL, useEmoji: false, isTty: false });
    expect(lines).toEqual(["Symbion v0.1.0", "Symbion daemon đang chạy: http://127.0.0.1:20132/?t=abc"]);
  });

  it("TC-BAN-2: TTY, no terminalColumns -> 4 lines with equal-length = borders", () => {
    const lines = buildBootBanner({ version: "0.1.0", url: SAMPLE_URL, useEmoji: false, isTty: true });
    expect(lines).toHaveLength(4);
    const [top, versionLine, serverLine, bottom] = lines;
    expect(top).toMatch(/^=+$/);
    expect(bottom).toMatch(/^=+$/);
    expect(top).toBe(bottom);
    const longest = Math.max(versionLine!.length, serverLine!.length);
    expect(top!.length).toBe(longest);
  });

  it("TC-BAN-3: useEmoji adds a prefix to the version line only; server line stays byte-identical", () => {
    const lines = buildBootBanner({ version: "0.1.0", url: SAMPLE_URL, useEmoji: true, isTty: false });
    expect(lines[0]).not.toBe("Symbion v0.1.0");
    expect(lines[0]!.endsWith("Symbion v0.1.0")).toBe(true);
    expect(lines[1]).toBe("Symbion daemon đang chạy: http://127.0.0.1:20132/?t=abc");
  });

  it("TC-BAN-4: server line always matches the e2e fixture's URL_RE-relevant shape", () => {
    const urlRe = /^Symbion daemon đang chạy: http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+$/;
    const realisticUrl = `http://127.0.0.1:20132/?t=${"a".repeat(64)}`;
    for (const isTty of [true, false]) {
      for (const useEmoji of [true, false]) {
        const lines = buildBootBanner({ version: "0.1.0", url: realisticUrl, useEmoji, isTty });
        const serverLine = lines.find((l) => l.startsWith("Symbion daemon đang chạy:"));
        expect(serverLine).toBeDefined();
        expect(serverLine).toMatch(urlRe);
      }
    }
  });

  it("TC-BAN-5 (EC-B.1, narrow terminal): falls back to plain 2-line form, no border", () => {
    const lines = buildBootBanner({
      version: "0.1.0",
      url: SAMPLE_URL,
      useEmoji: false,
      isTty: true,
      terminalColumns: 10,
    });
    expect(lines).toHaveLength(2);
  });

  it("TC-BAN-6: terminalColumns 0 or negative treated as unknown (falls back to 100-column cap)", () => {
    const zeroCols = buildBootBanner({
      version: "0.1.0",
      url: SAMPLE_URL,
      useEmoji: false,
      isTty: true,
      terminalColumns: 0,
    });
    const negativeCols = buildBootBanner({
      version: "0.1.0",
      url: SAMPLE_URL,
      useEmoji: false,
      isTty: true,
      terminalColumns: -5,
    });
    const undefinedCols = buildBootBanner({ version: "0.1.0", url: SAMPLE_URL, useEmoji: false, isTty: true });
    expect(zeroCols).toEqual(undefinedCols);
    expect(negativeCols).toEqual(undefinedCols);
    expect(zeroCols).toHaveLength(4);
  });

  it("TC-BAN-8: no returned line ever contains a raw ANSI escape sequence", () => {
    const combos = [
      { isTty: false, useEmoji: false },
      { isTty: false, useEmoji: true },
      { isTty: true, useEmoji: false },
      { isTty: true, useEmoji: true },
    ];
    for (const combo of combos) {
      const lines = buildBootBanner({ version: "0.1.0", url: SAMPLE_URL, ...combo });
      for (const line of lines) {
        expect(line).not.toMatch(/\x1b\[/);
      }
    }
  });
});

describe("supportsEmoji", () => {
  it("TC-BAN-7: win32 with no WT_SESSION/TERM_PROGRAM -> false", () => {
    expect(supportsEmoji({}, "win32")).toBe(false);
  });

  it("TC-BAN-7: win32 with WT_SESSION -> true", () => {
    expect(supportsEmoji({ WT_SESSION: "1" }, "win32")).toBe(true);
  });

  it("TC-BAN-7: darwin with empty env -> true", () => {
    expect(supportsEmoji({}, "darwin")).toBe(true);
  });

  it("TC-BAN-7: SYMBION_FORCE_ASCII forces false regardless of platform", () => {
    expect(supportsEmoji({ SYMBION_FORCE_ASCII: "1", WT_SESSION: "1" }, "win32")).toBe(false);
    expect(supportsEmoji({ SYMBION_FORCE_ASCII: "1" }, "darwin")).toBe(false);
  });

  it("TC-BAN-7: SYMBION_FORCE_EMOJI forces true regardless of platform", () => {
    expect(supportsEmoji({ SYMBION_FORCE_EMOJI: "1" }, "win32")).toBe(true);
  });
});

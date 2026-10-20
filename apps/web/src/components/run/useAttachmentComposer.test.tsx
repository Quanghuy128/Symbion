import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256HexBytes } from "@symbion/core";
import { WSL_CLIPBOARD_HINT, useAttachmentComposer } from "./useAttachmentComposer";
import { installObjectUrlStubs, pngFile, svgFileNamedPng } from "./attachmentTestUtil";

let urls: ReturnType<typeof installObjectUrlStubs>;
beforeEach(() => {
  urls = installObjectUrlStubs();
});

const MiB = 1024 * 1024;
const setup = (supported = true) => renderHook(() => useAttachmentComposer({ supported, unsupportedReason: "old CLI" }));

describe("useAttachmentComposer (WU1)", () => {
  it("adds a PNG: encoding -> ready with the right sha256 + base64", async () => {
    const { result } = setup();
    const file = pngFile("a.png", 64);
    let p!: Promise<void>;
    act(() => {
      p = result.current.addFiles([file]);
    });
    expect(result.current.chips[0]?.status).toBe("encoding");
    expect(result.current.encoding).toBe(true);
    await act(async () => {
      await p;
    });
    const chip = result.current.chips[0]!;
    expect(chip.status).toBe("ready");
    expect(chip.mediaType).toBe("image/png");
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(chip.sha256).toBe(sha256HexBytes(bytes));
    expect(chip.data).toBe(Buffer.from(bytes).toString("base64"));
    expect(result.current.signature).toBe(`${chip.sha256}:64:image/png`);
  });

  it("rejects an SVG named .png, a 0-byte file, a 6th file, >5 MiB and >20 MiB total — visibly", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.addFiles([svgFileNamedPng()]);
    });
    expect(result.current.chips).toHaveLength(0);
    expect(result.current.errors[0]).toMatch(/not a supported image/);

    await act(async () => {
      await result.current.addFiles([new File([], "empty.png", { type: "image/png" })]);
    });
    expect(result.current.errors[0]).toMatch(/empty file/);

    await act(async () => {
      await result.current.addFiles(Array.from({ length: 6 }, (_, i) => pngFile(`f${i}.png`)));
    });
    expect(result.current.chips).toHaveLength(5);
    expect(result.current.errors).toContain("Only 5 images per run");

    const fresh = setup();
    await act(async () => {
      await fresh.result.current.addFiles([pngFile("big.png", 5 * MiB + 1)]);
    });
    expect(fresh.result.current.chips).toHaveLength(0);
    expect(fresh.result.current.errors[0]).toMatch(/limit is 5 MB per image/);

    const total = setup();
    await act(async () => {
      await total.result.current.addFiles(Array.from({ length: 5 }, (_, i) => pngFile(`t${i}.png`, 4.5 * MiB)));
    });
    expect(total.result.current.chips).toHaveLength(4);
    expect(total.result.current.errors.join()).toMatch(/exceed 20 MB total/);
  });
});

describe("paste handler (WU2)", () => {
  const fakeEvent = (cd: unknown) => ({ clipboardData: cd, preventDefault: vi.fn() }) as never;

  it("files present -> preventDefault + chip", async () => {
    const { result } = setup();
    const f = pngFile();
    const e = fakeEvent({ files: [f], items: [{ kind: "file", type: "image/png", getAsFile: () => f }] });
    act(() => result.current.onPaste(e));
    expect((e as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).toHaveBeenCalled();
    await waitFor(() => expect(result.current.chips[0]?.status).toBe("ready"));
    expect(result.current.chips).toHaveLength(1);
  });

  it("mixed text + image (Excel/Word) -> default text paste kept, nothing attached", () => {
    const { result } = setup();
    const f = pngFile();
    const e = fakeEvent({
      files: [f],
      items: [
        { kind: "string", type: "text/plain", getAsFile: () => null },
        { kind: "file", type: "image/png", getAsFile: () => f },
      ],
    });
    act(() => result.current.onPaste(e));
    expect((e as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).not.toHaveBeenCalled();
    expect(result.current.chips).toHaveLength(0);
  });

  it("image type with no file (WSL) -> hint, preventDefault, no chip", () => {
    const { result } = setup();
    const e = fakeEvent({ files: [], items: [{ kind: "string", type: "image/png", getAsFile: () => null }] });
    act(() => result.current.onPaste(e));
    expect((e as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).toHaveBeenCalled();
    expect(result.current.hint).toBe(WSL_CLIPBOARD_HINT);
    expect(result.current.chips).toHaveLength(0);
  });

  it("text-only clipboard falls through untouched", () => {
    const { result } = setup();
    const e = fakeEvent({ files: [], items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] });
    act(() => result.current.onPaste(e));
    expect((e as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).not.toHaveBeenCalled();
    expect(result.current.hint).toBeNull();
  });
});

describe("remove + unsupported CLI (WU4/WU5)", () => {
  it("remove revokes the object URL and drops the chip", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.addFiles([pngFile()]);
    });
    const chip = result.current.chips[0]!;
    act(() => result.current.remove(chip.id));
    expect(result.current.chips).toHaveLength(0);
    expect(urls.revoked).toContain(chip.previewUrl);
    expect(result.current.signature).toBe("");
  });

  it("unsupported -> files are ignored with the reason", async () => {
    const { result } = setup(false);
    await act(async () => {
      await result.current.addFiles([pngFile()]);
    });
    expect(result.current.chips).toHaveLength(0);
    expect(result.current.hint).toBe("old CLI");
  });
});

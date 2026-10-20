import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunAttachmentMeta } from "@symbion/core";
import { DaemonRpcError } from "@/lib/rpc/client";
import { clearAttachmentCache } from "@/lib/run/attachmentCache";
import { installObjectUrlStubs } from "../attachmentTestUtil";

const readRunAttachment = vi.fn();
vi.mock("@/lib/run/useRunStore", () => ({
  useRunStore: (sel: (s: unknown) => unknown) => sel({ readRunAttachment }),
}));

import { PromptBubble } from "./TranscriptBlocks";
import { Markdown } from "./Markdown";

const metas: RunAttachmentMeta[] = [0, 1].map((i) => ({
  index: i,
  name: `shot${i}.png`,
  mediaType: "image/png",
  size: 10,
  sha256: "a".repeat(64),
  file: `${i + 1}.png`,
}));

beforeEach(() => {
  installObjectUrlStubs();
  clearAttachmentCache();
  readRunAttachment.mockReset();
});

describe("PromptAttachments (WU7)", () => {
  it("root prompt bubble shows one tile per attachment, fetched through readRunAttachment (blob: URLs)", async () => {
    readRunAttachment.mockResolvedValue({ mediaType: "image/png", size: 4, data: "iVBORw==" });
    render(<PromptBubble text="hi" truncated={false} attachments={{ projectId: "p", runId: "r1", items: metas }} />);
    await waitFor(() => expect(screen.getAllByTestId("prompt-attachment")).toHaveLength(2));
    expect(readRunAttachment).toHaveBeenCalledWith({ projectId: "p", runId: "r1", index: 0 });
    expect(readRunAttachment).toHaveBeenCalledWith({ projectId: "p", runId: "r1", index: 1 });
    for (const img of screen.getAllByRole("img")) expect(img.getAttribute("src")).toMatch(/^blob:/);
  });

  it("click opens the lightbox; Escape closes it", async () => {
    readRunAttachment.mockResolvedValue({ mediaType: "image/png", size: 4, data: "iVBORw==" });
    render(<PromptBubble text="hi" truncated={false} attachments={{ projectId: "p", runId: "r2", items: [metas[0]!] }} />);
    const tile = await screen.findByTestId("prompt-attachment");
    fireEvent.click(tile);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("not-found -> 'Image no longer available'; other errors -> 'Couldn't load image'", async () => {
    readRunAttachment
      .mockRejectedValueOnce(new DaemonRpcError({ code: "not-found", message: "gone" }))
      .mockRejectedValueOnce(new DaemonRpcError({ code: "attachment-corrupt", message: "bad" }));
    render(<PromptBubble text="hi" truncated={false} attachments={{ projectId: "p", runId: "r3", items: metas }} />);
    await waitFor(() => expect(screen.getByText("Image no longer available")).toBeInTheDocument());
    expect(screen.getByText("Couldn't load image")).toBeInTheDocument();
  });

  it("a prompt bubble without attachments renders no tiles", () => {
    render(<PromptBubble text="hi" truncated={false} />);
    expect(screen.queryAllByTestId("prompt-attachment")).toHaveLength(0);
    expect(readRunAttachment).not.toHaveBeenCalled();
  });
});

describe("WU8 — CLI image-failure text is plain text", () => {
  it("renders '[Image could not be processed: …]' literally, with no link or image element", () => {
    const { container } = render(<Markdown source="[Image could not be processed: unsupported]" />);
    expect(container.textContent).toContain("[Image could not be processed: unsupported]");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireAttachmentUrl,
  clearAttachmentCache,
  getCachedAttachmentUrl,
  putCachedAttachmentUrl,
  releaseAttachmentUrl,
} from "./attachmentCache";

describe("attachmentCache refcount", () => {
  const revoke = vi.fn();
  beforeEach(() => {
    clearAttachmentCache();
    revoke.mockReset();
    URL.revokeObjectURL = revoke;
  });

  it("does not revoke a held URL at 20-entry eviction; revokes after release", () => {
    putCachedAttachmentUrl("held", "blob:held");
    acquireAttachmentUrl("held");
    for (let i = 0; i < 25; i++) putCachedAttachmentUrl(`k${i}`, `blob:k${i}`);
    expect(revoke).not.toHaveBeenCalledWith("blob:held");
    expect(getCachedAttachmentUrl("held")).toBe("blob:held");
    // unheld oldest entries were revoked
    expect(revoke).toHaveBeenCalledWith("blob:k0");
    releaseAttachmentUrl("held");
    for (let i = 25; i < 50; i++) putCachedAttachmentUrl(`k${i}`, `blob:k${i}`);
    expect(revoke).toHaveBeenCalledWith("blob:held");
  });
});

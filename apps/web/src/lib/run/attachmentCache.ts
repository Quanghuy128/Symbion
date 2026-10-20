/**
 * attachmentCache — a tiny LRU of object URLs for stored run attachments fetched
 * through `readRunAttachment`. Keyed `${runId}:${index}`.
 *
 * A URL is revoked only when NO mounted consumer holds it: tiles `acquire` on
 * mount and `release` on unmount; LRU eviction (over MAX_ENTRIES) skips held
 * entries and runs again on release, so a visible thumbnail/lightbox never
 * loses its blob URL.
 */
const MAX_ENTRIES = 20;
interface Entry {
  url: string;
  refs: number;
}
const entries = new Map<string, Entry>();

/** Peek (refresh recency) without taking a hold. */
export function getCachedAttachmentUrl(key: string): string | undefined {
  const hit = entries.get(key);
  if (hit === undefined) return undefined;
  entries.delete(key);
  entries.set(key, hit);
  return hit.url;
}

/** Take a hold so the URL is not revoked while a consumer is mounted. No-op if absent. */
export function acquireAttachmentUrl(key: string): void {
  const e = entries.get(key);
  if (e) e.refs++;
}

/** Drop a hold; an over-limit cache then evicts unheld entries. */
export function releaseAttachmentUrl(key: string): void {
  const e = entries.get(key);
  if (e && e.refs > 0) e.refs--;
  evict();
}

function evict(skipKey?: string): void {
  if (entries.size <= MAX_ENTRIES) return;
  for (const [k, e] of entries) {
    if (entries.size <= MAX_ENTRIES) break;
    if (e.refs > 0 || k === skipKey) continue;
    entries.delete(k);
    URL.revokeObjectURL(e.url);
  }
}

export function putCachedAttachmentUrl(key: string, url: string): void {
  const prev = entries.get(key);
  if (prev !== undefined && prev.url !== url) {
    // A mounted consumer may still show the old URL: only revoke when unheld.
    if (prev.refs === 0) URL.revokeObjectURL(prev.url);
  }
  entries.delete(key);
  entries.set(key, { url, refs: prev?.refs ?? 0 });
  evict(key);
}

/** test helper */
export function clearAttachmentCache(): void {
  for (const e of entries.values()) URL.revokeObjectURL(e.url);
  entries.clear();
}

/**
 * nonces — daemon-minted single-use consent nonces (PLAN §8.5.3, Flaw F1's
 * resolution). In-memory only (per-boot, never persisted). Minted by
 * runPreflight (iff no blocker), consumed by startRun. Buys: a blind one-shot
 * forged POST cannot start a run (the caller must READ the preflight response),
 * server-enforced preflight-before-spawn ordering, and consent tied to the
 * exact config the user saw (configHash).
 *
 * Honest /cso limit: this does NOT stop a local process that can read HTTP
 * responses — nothing can, within the tokenless model (§6.4 accepted this).
 */
import { randomBytes } from "node:crypto";
import { EMPTY_ATTACHMENTS_DIGEST } from "@symbion/core";

export interface NonceBinding {
  projectId: string;
  artifactId: string;
  /** sha256 over {permissionMode, allowedTools, ceilings} — config drift invalidates. */
  configHash: string;
  /** core.attachmentsDigest of the images the user consented to (EMPTY digest for text-only). */
  attachmentsDigest?: string;
}

interface NonceEntry extends Required<NonceBinding> {
  expiresAt: number;
}

const DEFAULT_TTL_MS = 120_000;

/**
 * NonceStore — a testable instance (the tests inject a shorter TTL + a fake
 * `now()` for the expiry case, §3.3 #5). A module-level singleton backs the
 * real daemon.
 */
export class NonceStore {
  private entries = new Map<string, NonceEntry>();
  private ttlMs: number;
  private now: () => number;

  constructor(opts?: { ttlMs?: number; now?: () => number }) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts?.now ?? Date.now;
  }

  /** Mint a fresh 64-hex nonce bound to {projectId, artifactId, configHash, attachmentsDigest}. */
  mint(binding: NonceBinding): string {
    const nonce = randomBytes(32).toString("hex");
    this.entries.set(nonce, {
      ...binding,
      attachmentsDigest: binding.attachmentsDigest ?? EMPTY_ATTACHMENTS_DIGEST,
      expiresAt: this.now() + this.ttlMs,
    });
    return nonce;
  }

  /**
   * consume — single-use: deletes the entry on any lookup (success OR mismatch,
   * so a wrong-binding guess also burns it). Returns true iff the nonce existed,
   * was unexpired, AND matched the binding exactly.
   */
  consume(nonce: string, binding: NonceBinding): boolean {
    if (typeof nonce !== "string" || nonce.length === 0) return false;
    const entry = this.entries.get(nonce);
    if (!entry) return false;
    this.entries.delete(nonce); // single-use — always burn on lookup.
    if (this.now() > entry.expiresAt) return false;
    return (
      entry.projectId === binding.projectId &&
      entry.artifactId === binding.artifactId &&
      entry.configHash === binding.configHash &&
      entry.attachmentsDigest === (binding.attachmentsDigest ?? EMPTY_ATTACHMENTS_DIGEST)
    );
  }

  /** Test/GC helper — drop expired entries. */
  sweep(): void {
    const t = this.now();
    for (const [nonce, entry] of this.entries) {
      if (t > entry.expiresAt) this.entries.delete(nonce);
    }
  }
}

/** The daemon-wide singleton nonce store. */
export const nonceStore = new NonceStore();

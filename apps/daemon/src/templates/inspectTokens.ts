/**
 * inspectTokens — daemon-minted, single-use, in-memory tokens linking an
 * `inspectTemplateSourceUrl` result to the later `addTemplateSource` call
 * (docs/loops/templates-repo-url-STATE.md PLAN §8.1/§8.3). Same shape as
 * run/nonces.ts. Memory only, so a daemon restart invalidates every token.
 *
 * The token carries everything `addTemplateSource` needs (owner/repo/ref/root
 * + what the daemon itself observed), so add never accepts those from the
 * client and never touches the network.
 */
import { randomBytes } from "node:crypto";
import type { SourceFolder } from "@symbion/core";

export interface InspectBinding {
  owner: string;
  repo: string;
  ref: string | null;
  rootPath: string;
  commitSha: string;
  /** root-relative paths the daemon observed ("." + top-level dirs). */
  rootDirPaths: string[];
  /** folders the daemon auto-detected. */
  detected: SourceFolder[];
}

interface Entry {
  binding: InspectBinding;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_LIVE = 32;

export class InspectTokenStore {
  private entries = new Map<string, Entry>();
  private ttlMs: number;
  private now: () => number;

  constructor(opts?: { ttlMs?: number; now?: () => number }) {
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.now = opts?.now ?? Date.now;
  }

  /** 32-hex token. Evicts expired entries, then the oldest beyond MAX_LIVE. */
  mint(binding: InspectBinding): string {
    this.sweep();
    while (this.entries.size >= MAX_LIVE) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const token = randomBytes(16).toString("hex");
    this.entries.set(token, { binding, expiresAt: this.now() + this.ttlMs });
    return token;
  }

  /** Non-consuming lookup (a failed add must not burn the token). */
  peek(token: unknown): InspectBinding | null {
    if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) return null;
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (this.now() > entry.expiresAt) {
      this.entries.delete(token);
      return null;
    }
    return entry.binding;
  }

  /** Single-use: removes the token. Returns true iff it was live. */
  consume(token: unknown): boolean {
    if (this.peek(token) === null) return false;
    this.entries.delete(token as string);
    return true;
  }

  sweep(): void {
    const t = this.now();
    for (const [k, e] of this.entries) if (t > e.expiresAt) this.entries.delete(k);
  }

  get size(): number {
    return this.entries.size;
  }
}

/** The daemon-wide singleton. */
export const inspectTokens = new InspectTokenStore();

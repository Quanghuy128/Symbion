/**
 * userSources.ts — config IO + the SSRF-critical server-side resolver for
 * user-added template sources (docs/loops/templates-repo-url-STATE.md PLAN
 * §8.1/§8.3).
 *
 * Every function that mutates is SYNCHRONOUS between loadGlobalConfig() and
 * saveGlobalConfig(): no await between them, so there is no interleaving
 * inside the single-threaded daemon. Writes go ONLY through saveGlobalConfig
 * (atomicWriteJson temp->rename). Invalid stored entries are never deleted or
 * rewritten (add pushes onto / remove filters the RAW array) and are never
 * used to build a URL.
 */
import { randomBytes } from "node:crypto";
import {
  AUTHOR_REGISTRY,
  MAX_USER_TEMPLATE_SOURCES,
  USER_SOURCE_ID_RE,
  parseStoredTemplateSources,
  userSourceToAuthorSource,
  validateUserTemplateSource,
  type GithubAuthorSource,
  type UserTemplateSource,
} from "@symbion/core";
import { loadGlobalConfig, saveGlobalConfig } from "../store/store.js";
import { RpcError } from "../rpc/rpcError.js";

export function listUserSources(): { sources: UserTemplateSource[]; invalidCount: number } {
  const config = loadGlobalConfig();
  const { valid, invalidCount } = parseStoredTemplateSources(config.templateSources);
  return { sources: valid, invalidCount };
}

function mintId(existing: Set<string>): string {
  for (;;) {
    const id = `u-${randomBytes(5).toString("hex")}`;
    if (!existing.has(id)) return id;
  }
}

/**
 * addUserSource — `build` receives the fresh, validated list + a freshly minted
 * id and returns the record (or throws RpcError, e.g. duplicate). Cap and the
 * non-array refusal are enforced here against the RAW stored array.
 */
export function addUserSource(
  build: (ctx: { id: string; existing: UserTemplateSource[] }) => Omit<UserTemplateSource, "id">
): UserTemplateSource {
  const config = loadGlobalConfig();
  const rawField = config.templateSources;
  if (rawField !== undefined && !Array.isArray(rawField)) {
    throw new RpcError("invalid-config", "Saved template sources in config.json are unreadable; refusing to overwrite them.");
  }
  const rawList: unknown[] = Array.isArray(rawField) ? rawField : [];
  if (rawList.length >= MAX_USER_TEMPLATE_SOURCES) {
    throw new RpcError("source-limit", `You can save at most ${MAX_USER_TEMPLATE_SOURCES} sources. Remove one first.`);
  }
  const existing = parseStoredTemplateSources(rawList).valid;
  const usedIds = new Set<string>(
    rawList.map((e) => (typeof e === "object" && e !== null ? String((e as { id?: unknown }).id) : ""))
  );
  const id = mintId(usedIds);
  const record = { id, ...build({ id, existing }) };
  const checked = validateUserTemplateSource(record);
  if (!checked.ok) throw new RpcError("invalid-config", `Refusing to save an invalid source: ${checked.reason}`);
  config.templateSources = [...rawList, checked.source];
  saveGlobalConfig(config);
  return checked.source;
}

/** Remove by id from the RAW array (invalid entries untouched). Returns whether something was removed. */
export function removeUserSource(id: string): boolean {
  const config = loadGlobalConfig();
  const rawField = config.templateSources;
  if (!Array.isArray(rawField)) return false;
  const next = rawField.filter((e) => !(typeof e === "object" && e !== null && (e as { id?: unknown }).id === id));
  if (next.length === rawField.length) return false;
  config.templateSources = next;
  saveGlobalConfig(config);
  return true;
}

/**
 * resolveGithubSourceById — THE SSRF-critical resolver. `id` is the only
 * client-supplied value; owner/repo/ref/rootPath/folders always come from the
 * reviewed AUTHOR_REGISTRY or from the stored config entry, re-validated.
 */
export function resolveGithubSourceById(id: unknown): GithubAuthorSource {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new RpcError("invalid-author", "Missing authorId.");
  }
  const builtin = AUTHOR_REGISTRY.find((a) => a.id === id);
  if (builtin) {
    if (builtin.kind !== "github") {
      throw new RpcError("invalid-author", `Invalid authorId or not a GitHub source: "${id}".`);
    }
    return builtin;
  }
  if (!USER_SOURCE_ID_RE.test(id)) {
    throw new RpcError("invalid-author", `Invalid authorId or not a GitHub source: "${id}".`);
  }
  const config = loadGlobalConfig();
  const rawField = config.templateSources;
  const entry = Array.isArray(rawField)
    ? rawField.find((e) => typeof e === "object" && e !== null && (e as { id?: unknown }).id === id)
    : undefined;
  if (entry === undefined) {
    throw new RpcError("invalid-author", "Source not found — it may have been removed.");
  }
  const checked = validateUserTemplateSource(entry);
  if (!checked.ok) {
    throw new RpcError("invalid-author", "Saved source is invalid — remove and add it again.");
  }
  return userSourceToAuthorSource(checked.source);
}

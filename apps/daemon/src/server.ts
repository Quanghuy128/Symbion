import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { handlers, RpcError } from "./rpc/handlers.js";
import type { RpcMethod } from "./rpc/contract.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/**
 * serveStaticFile — serves the built `apps/web` static export (STATE §1.3: "daemon
 * ... serves the built apps/web static export"). Path-confined to `webRoot`; only
 * ever reads, never writes. Falls back to index.html for SPA-style routes.
 */
function serveStaticFile(webRoot: string, urlPath: string, res: ServerResponse): boolean {
  const cleanPath = urlPath.split("?")[0] ?? "/";
  const relPath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\//, "");
  const root = resolve(webRoot);
  let absPath = normalize(join(root, relPath));

  if (!absPath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  if (!existsSync(absPath) || statSync(absPath).isDirectory()) {
    // Next.js static export emits one .html file per route (e.g. `templates.html`,
    // `settings.html`) rather than nested `index.html` per directory. For an
    // extensionless request whose literal path doesn't exist, try `<path>.html`
    // first so each route resolves to its own page bundle; only fall back to the
    // app shell's index.html (SPA-style) if that also doesn't exist.
    const htmlPath = join(root, `${relPath}.html`);
    absPath = existsSync(htmlPath) ? htmlPath : join(root, "index.html");
  }
  if (!existsSync(absPath)) return false;

  const ext = extname(absPath);
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
  res.end(readFileSync(absPath));
  return true;
}

const READ_ONLY_METHODS = new Set<RpcMethod>([
  "ping",
  "browseFolder",
  "validatePath",
  "listDir",
  "listProjects",
  "loadProject",
  "scanClaudeDir",
  "render",
  "computeDiff",
  "gitStatus",
  "renderRunCommand",
  // listModels does not write to the project's managed files (no fs mutation). For the 3
  // cloud providers it is still a synchronous, instant, zero-network-call lookup of a
  // hardcoded list; for Ollama it now performs a real, timeout-bounded `GET /api/tags`
  // network call against the local Ollama instance (docs/loops/ollama-dynamic-models-STATE.md
  // §6.5) — "read-only" here means "no fs mutation," not "free"/"local-only"/"synchronous,"
  // same conceptual category checkProviderStatus/generateBody already occupy below.
  "listModels",
  // generateBody is deliberately NOT in this set: it performs an outbound network call
  // (real-world side effect with cost), even though it does not touch the filesystem.
  // This only affects which methods are conceptually labeled "read-only" for future use,
  // not auth — every non-ping method already requires the token regardless of this set's
  // membership (see the `method !== "ping"` check below). STATE §10.1.
  // checkProviderStatus also performs an outbound network call (a liveness ping to
  // Ollama's loopback port, or an authenticated cheap call to a cloud provider), same
  // rationale as generateBody — labeled here as conceptually read-only (no fs mutation)
  // even though it's not "free" like listModels.
  "checkProviderStatus",
  // listProviders reads providers.json but performs no mutation — same rationale as
  // listModels's membership here (docs/loops/multi-provider-settings-STATE.md §3.2).
  // saveProviderKey/clearProviderKey/setActiveProvider are deliberately NOT in this set —
  // they mutate providers.json and still require the session token like every other
  // non-ping/non-read-only method (no change to the auth gate itself, just correct set
  // membership for the new methods).
  "listProviders",
]);

export interface DaemonServerOptions {
  port: number;
  version: string;
  /** absolute path to the built apps/web static export (`apps/web/out`); undefined in dev/test. */
  webStaticRoot?: string;
}

export interface DaemonServerHandle {
  port: number;
  token: string;
  close: () => Promise<void>;
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function isAllowedHost(headerValue: string | undefined, port: number): boolean {
  if (!headerValue) return false;
  // Accept bare "127.0.0.1:<port>" / "localhost:<port>" Origin or Host headers only.
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  return allowed.has(headerValue);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * startServer — binds 127.0.0.1 ONLY (never 0.0.0.0). Every mutating RPC requires
 * the per-boot session token; Origin/Host are allowlisted as defense-in-depth
 * against DNS-rebinding (STATE §1.4 / CLAUDE.md filesystem-safety mandate).
 */
export function startServer(opts: DaemonServerOptions): Promise<DaemonServerHandle> {
  const token = generateToken();

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && opts.webStaticRoot) {
      const served = serveStaticFile(opts.webStaticRoot, req.url ?? "/", res);
      if (served) return;
    }

    if (req.method !== "POST" || req.url !== "/rpc") {
      sendJson(res, 404, { error: { code: "not-found", message: "Not found" } });
      return;
    }

    const origin = req.headers["origin"] as string | undefined;
    const host = req.headers["host"] as string | undefined;
    if (origin !== undefined && !isAllowedHost(origin, opts.port)) {
      sendJson(res, 403, { error: { code: "origin-rejected", message: "Origin không hợp lệ." } });
      return;
    }
    if (!isAllowedHost(host, opts.port)) {
      sendJson(res, 403, { error: { code: "host-rejected", message: "Host không hợp lệ." } });
      return;
    }

    let body: { method?: RpcMethod; params?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: { code: "bad-json", message: "JSON không hợp lệ." } });
      return;
    }

    const method = body.method;
    if (!method || !(method in handlers)) {
      sendJson(res, 400, { error: { code: "unknown-method", message: `Unknown method: ${method}` } });
      return;
    }

    const isReadOnly = READ_ONLY_METHODS.has(method);
    const authHeader = req.headers["x-symbion-token"] as string | undefined;
    if (!isReadOnly || method !== "ping") {
      // ping is allowed without a token (used for initial connectivity probing);
      // every other method — including all read-only ones — requires the token,
      // since even read methods can read arbitrary filesystem paths.
      if (authHeader !== token) {
        sendJson(res, 401, { error: { code: "unauthorized", message: "Thiếu hoặc sai session token." } });
        return;
      }
    }

    try {
      const handlerFn = handlers[method as keyof typeof handlers] as (
        params: unknown,
        ctx: { port: number; version: string }
      ) => unknown;
      // Default params to {} when the client omits the `params` key entirely
      // (not just when params.path is missing/wrong-type) — every handler
      // destructures/accesses fields off `params` directly, so an `undefined`
      // params object throws a bare TypeError before any handler-level
      // invalid-params validation runs, producing a misleading 500
      // internal-error instead of 400 invalid-params. `ping`'s `_params` is
      // unused so this default is a no-op for it.
      const params = body.params ?? {};
      const result = await handlerFn(params, { port: opts.port, version: opts.version });
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof RpcError) {
        sendJson(res, 400, { error: { code: err.code, message: err.message } });
        return;
      }
      sendJson(res, 500, { error: { code: "internal-error", message: (err as Error).message } });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // Bind 127.0.0.1 ONLY — never 0.0.0.0 (no LAN exposure).
    server.listen(opts.port, "127.0.0.1", () => {
      resolve({
        port: opts.port,
        token,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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

export interface DaemonServerOptions {
  port: number;
  version: string;
  /** absolute path to the built apps/web static export (`apps/web/out`); undefined in dev/test. */
  webStaticRoot?: string;
}

export interface DaemonServerHandle {
  port: number;
  close: () => Promise<void>;
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
 * startServer — binds 127.0.0.1 ONLY (never 0.0.0.0). Single-user local tool:
 * there is NO per-request session token (removed — it broke on F5 refresh, see
 * docs/loops/tokenless-daemon-STATE.md). The trust boundary is the loopback-only
 * bind + the Origin/Host allowlist below (anti DNS-rebinding), plus the per-write
 * diff-preview/backup/path-confinement in the fs layer (CLAUDE.md filesystem-safety).
 */
export function startServer(opts: DaemonServerOptions): Promise<DaemonServerHandle> {
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
      sendJson(res, 403, { error: { code: "origin-rejected", message: "Invalid origin." } });
      return;
    }
    if (!isAllowedHost(host, opts.port)) {
      sendJson(res, 403, { error: { code: "host-rejected", message: "Invalid host." } });
      return;
    }

    let body: { method?: RpcMethod; params?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: { code: "bad-json", message: "Invalid JSON." } });
      return;
    }

    const method = body.method;
    if (!method || !(method in handlers)) {
      sendJson(res, 400, { error: { code: "unknown-method", message: `Unknown method: ${method}` } });
      return;
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
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

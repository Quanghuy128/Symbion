"use client";

/**
 * useDaemonRpc — typed fetch to the local daemon at 127.0.0.1:PORT. There is NO
 * session token (removed — it broke on F5 refresh, see
 * docs/loops/tokenless-daemon-STATE.md); the daemon's trust boundary is its
 * loopback-only bind + Origin/Host allowlist. The web app never touches disk
 * directly; every effect funnels through this client (CLAUDE.md architecture rule).
 */

export interface RpcErrorShape {
  code: string;
  message: string;
}

export class DaemonRpcError extends Error {
  code: string;
  constructor(shape: RpcErrorShape) {
    super(shape.message);
    this.code = shape.code;
  }
}

let cachedPort: number | null = null;

/** Record the daemon port for this page load. Derived from the URL by each page
 *  shell on mount; survives F5 because it's re-derived from window.location, not
 *  a stripped one-time query param. */
export function initDaemonSession(port: number): void {
  cachedPort = port;
}

export function getDaemonOrigin(): string {
  const port = cachedPort ?? Number(process.env["NEXT_PUBLIC_DAEMON_PORT"] ?? 12802);
  return `http://127.0.0.1:${port}`;
}

export async function callRpc<TParams, TResult>(method: string, params: TParams): Promise<TResult> {
  const res = await fetch(`${getDaemonOrigin()}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ method, params }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new DaemonRpcError(body.error ?? { code: "unknown", message: "RPC call failed" });
  }
  return body as TResult;
}

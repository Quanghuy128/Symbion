"use client";

/**
 * useDaemonRpc — typed fetch to the local daemon at 127.0.0.1:PORT with the
 * per-boot session token. The web app never touches disk directly; every
 * effect funnels through this client (CLAUDE.md architecture rule).
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

let cachedToken: string | null = null;
let cachedPort: number | null = null;

/** Read the session token + port handed to the page once at boot (query param), kept in memory only. */
export function initDaemonSession(token: string, port: number): void {
  cachedToken = token;
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
      ...(cachedToken ? { "x-symbion-token": cachedToken } : {}),
    },
    body: JSON.stringify({ method, params }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new DaemonRpcError(body.error ?? { code: "unknown", message: "RPC call failed" });
  }
  return body as TResult;
}

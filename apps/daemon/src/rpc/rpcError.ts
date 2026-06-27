/**
 * RpcError — the single error type every RPC handler throws to signal a
 * clean, mapped error (server.ts catches it and emits {code, message} as a
 * 400 response body; anything else falls through to a generic 500). Lives in
 * its own module (rather than rpc/handlers.ts, where it was originally
 * defined) so non-handler fs modules (e.g. fs/listDir.ts) can throw it
 * without creating a circular import with rpc/handlers.ts.
 */
export class RpcError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

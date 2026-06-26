/**
 * findOpenPort — E15 port-scan retry. Extracted as a standalone, named,
 * exported function with an injectable `tryBind` so it's unit-testable
 * without binding real sockets (the default `tryBind` does bind a real
 * socket via `startServer`/an http server in production call sites).
 */

export interface FindOpenPortOptions {
  /** max number of ports to try (inclusive of the start port) before giving up. */
  maxAttempts?: number;
}

/** Error code Node uses for "address already in use". */
export const EADDRINUSE = "EADDRINUSE";

/**
 * Scans forward from `startPort`, calling `tryBind(port)` for each candidate.
 * `tryBind` should attempt to bind/listen and resolve with the bound handle,
 * or reject with an error carrying `.code === "EADDRINUSE"` if the port is
 * taken (any other rejection is rethrown immediately — not retried).
 *
 * Returns `{ port, handle }` for the first port that successfully binds.
 * Throws if no open port is found within `maxAttempts`.
 */
export async function findOpenPort<T>(
  startPort: number,
  tryBind: (port: number) => Promise<T>,
  options: FindOpenPortOptions = {}
): Promise<{ port: number; handle: T }> {
  const maxAttempts = options.maxAttempts ?? 20;
  let port = startPort;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const handle = await tryBind(port);
      return { port, handle };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === EADDRINUSE) {
        port += 1;
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Không tìm được cổng trống bắt đầu từ ${startPort} (đã thử ${maxAttempts} cổng).`);
}

import { describe, expect, it } from "vitest";
import { findOpenPort } from "../src/net/findOpenPort.js";

function eaddrinuse(): NodeJS.ErrnoException {
  const err = new Error("address in use") as NodeJS.ErrnoException;
  err.code = "EADDRINUSE";
  return err;
}

describe("findOpenPort (E15)", () => {
  it("returns the start port immediately when it is free", async () => {
    const attempted: number[] = [];
    const result = await findOpenPort(20128, async (port) => {
      attempted.push(port);
      return { boundPort: port };
    });
    expect(result.port).toBe(20128);
    expect(result.handle).toEqual({ boundPort: 20128 });
    expect(attempted).toEqual([20128]);
  });

  it("retries forward on EADDRINUSE until an open port is found", async () => {
    const attempted: number[] = [];
    const result = await findOpenPort(20128, async (port) => {
      attempted.push(port);
      if (port < 20131) throw eaddrinuse();
      return { boundPort: port };
    });
    expect(result.port).toBe(20131);
    expect(attempted).toEqual([20128, 20129, 20130, 20131]);
  });

  it("rethrows non-EADDRINUSE errors immediately without retrying", async () => {
    const attempted: number[] = [];
    const boom = new Error("permission denied");
    await expect(
      findOpenPort(20128, async (port) => {
        attempted.push(port);
        throw boom;
      })
    ).rejects.toThrow(boom);
    expect(attempted).toEqual([20128]);
  });

  it("throws after exhausting maxAttempts when every port is in use", async () => {
    const attempted: number[] = [];
    await expect(
      findOpenPort(
        20128,
        async (port) => {
          attempted.push(port);
          throw eaddrinuse();
        },
        { maxAttempts: 5 }
      )
    ).rejects.toThrow(/Không tìm được cổng trống/);
    expect(attempted).toEqual([20128, 20129, 20130, 20131, 20132]);
  });

  it("works against a real socket bind (EADDRINUSE retry path, integration)", async () => {
    const net = await import("node:net");
    // Occupy one real port first.
    const occupied = net.createServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const occupiedPort = (occupied.address() as { port: number }).port;

    try {
      const result = await findOpenPort(occupiedPort, (port) => {
        return new Promise((resolve, reject) => {
          const server = net.createServer();
          server.once("error", reject);
          server.listen(port, "127.0.0.1", () => resolve(server));
        });
      });
      expect(result.port).not.toBe(occupiedPort);
      expect(result.port).toBeGreaterThan(occupiedPort);
      await new Promise<void>((resolve) => (result.handle as import("node:net").Server).close(() => resolve()));
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });
});

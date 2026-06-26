import { defineConfig } from "@playwright/test";

/**
 * Playwright e2e config (STATE §1.1 / testplan §3). Tests boot a *real* daemon
 * (built apps/daemon/dist + the built apps/web static export it serves) against
 * an isolated temp project repo + temp SYMBION_CONFIG_DIR, so the real repo and
 * the real ~/.config/symbion are never touched. See e2e/daemon-fixture.ts for
 * the boot/teardown logic — there is no Playwright `webServer` entry because
 * each test needs its own isolated temp dirs (fresh daemon per test file).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // each test boots its own daemon on its own port; keep sequential for simplicity/stability
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});

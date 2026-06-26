import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    extends: "./packages/core/vitest.config.ts",
    test: {
      name: "core",
      root: "./packages/core",
    },
  },
  {
    extends: "./apps/daemon/vitest.config.ts",
    test: {
      name: "daemon",
      root: "./apps/daemon",
    },
  },
]);

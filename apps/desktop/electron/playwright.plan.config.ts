import { defineConfig } from "@playwright/test"
import { resolve } from "node:path"

export default defineConfig({
  testDir: "./smoke-tests",
  testMatch: "plan-flow.smoke.ts",
  outputDir: resolve(
    process.env.CODEPILOTX_PLAYWRIGHT_OUTPUT_DIR
      ?? "./test-results/plan-flow",
  ),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  workers: 1,
  timeout:
    process.env.CODEPILOTX_PLAN_SMOKE_LIVE === "1"
      ? 300_000
      : 120_000,
  expect: {
    timeout:
      process.env.CODEPILOTX_PLAN_SMOKE_LIVE === "1"
        ? 120_000
        : 20_000,
  },
})

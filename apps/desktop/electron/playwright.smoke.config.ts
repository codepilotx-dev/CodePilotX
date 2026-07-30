import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./smoke-tests",
  testMatch: "desktop-host.smoke.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
})

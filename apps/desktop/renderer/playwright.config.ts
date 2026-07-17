import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const rendererRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  testDir: './visual-tests',
  testMatch: '**/*.visual.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  workers: 2,
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run dev',
    cwd: rendererRoot,
    reuseExistingServer: true,
    timeout: 120_000,
    url: 'http://127.0.0.1:5173',
  },
})

import { defineConfig } from '@playwright/test'
import visualConfig from './playwright.config.js'

export default defineConfig({
  ...visualConfig,
  testDir: './a11y-tests',
  testMatch: '**/*.a11y.ts',
  timeout: 60_000,
  retries: 0,
  workers: 1,
})

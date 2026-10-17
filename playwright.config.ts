import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 20_000,
  use: { channel: 'chrome' },
})

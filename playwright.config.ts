import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173/crypto-lab-time-trust/',
    colorScheme: 'dark',
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/crypto-lab-time-trust/',
    reuseExistingServer: !process.env.CI,
  },
});

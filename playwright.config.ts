import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4672/crypto-lab-time-trust/',
    colorScheme: 'dark',
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    // Build first: `preview` only serves whatever is already in dist/. Without the
    // build, a failed compile leaves the previous good bundle on disk and the suite
    // passes green against source that no longer compiles, which silently
    // invalidates mutation checking. Building here makes a broken source abort the run.
    command: 'npm run build && npm run preview -- --port 4672 --strictPort',
    url: 'http://localhost:4672/crypto-lab-time-trust/',
    reuseExistingServer: !process.env.CI,
  },
});

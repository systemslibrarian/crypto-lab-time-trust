import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  base: '/crypto-lab-time-trust/',
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});

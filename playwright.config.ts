import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const swiftshader = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    {
      name: 'chromium',
      testMatch: 'smoke.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: swiftshader },
    },
    { name: 'pixel-5', testMatch: 'mobile.spec.ts', use: { ...devices['Pixel 5'], launchOptions: swiftshader } },
    { name: 'pixel-5-landscape', testMatch: 'mobile.spec.ts', use: { ...devices['Pixel 5 landscape'], launchOptions: swiftshader } },
    { name: 'iphone-13', testMatch: 'mobile.spec.ts', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

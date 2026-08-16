import { defineConfig, devices } from "@playwright/test";

const outputRoot = process.env.B2_VISUAL_OUTPUT_DIR ?? "/tmp/dialogue-atlas-b2-visual/playwright";
const visualPort = Number(process.env.B2_VISUAL_PORT ?? 4186);
const baseURL = `http://127.0.0.1:${visualPort}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: outputRoot,
  reporter: [["line"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    browserName: "chromium",
    viewport: { width: 1586, height: 992 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Tokyo",
    colorScheme: "dark",
    reducedMotion: "reduce",
    screenshot: "off",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${visualPort} --strictPort`,
    url: `${baseURL}/?demo=b2`,
    cwd: ".",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});

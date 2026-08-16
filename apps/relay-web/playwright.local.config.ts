import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.RELAY_LOCAL_E2E_PORT ?? 4191);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./integration",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  outputDir: "/tmp/dialogue-atlas-relay-local-e2e",
  reporter: [["line"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Tokyo",
    colorScheme: "dark",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `VITE_RELAY_LOCAL_INTEGRATION=1 npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/`,
    cwd: ".",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});

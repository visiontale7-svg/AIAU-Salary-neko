import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, type BrowserContext, type Page, test } from "@playwright/test";

const VISUAL_PORT = Number(process.env.B2_VISUAL_PORT ?? 4186);
const BASE_ORIGIN = `http://127.0.0.1:${VISUAL_PORT}`;
const OUTPUT_ROOT = process.env.B2_HALO_OUTPUT_DIR ?? "/tmp/dialogue-atlas-b2-halo";
const HALO_ROUTE = "/?demo=b2&haloLab=1";
const TARGET_SAMPLE = '[data-halo-sample="source-target-100"]';

async function freezeVisuals(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const install = () => {
      if (document.getElementById("b2-halo-test-freeze")) return;
      const style = document.createElement("style");
      style.id = "b2-halo-test-freeze";
      style.textContent = `
        *, *::before, *::after {
          animation: none !important;
          caret-color: transparent !important;
          scroll-behavior: auto !important;
          transition: none !important;
        }
      `;
      (document.head ?? document.documentElement).append(style);
    };
    document.addEventListener("DOMContentLoaded", install, { once: true });
  });
}

async function openHaloLab(page: Page): Promise<string[]> {
  const externalRequests: string[] = [];
  await freezeVisuals(page);
  await page.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    const url = new URL(requestUrl);
    const local = url.origin === BASE_ORIGIN;
    const inline = url.protocol === "data:" || url.protocol === "blob:";
    if (!local && !inline) {
      externalRequests.push(requestUrl);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await page.goto(HALO_ROUTE, { waitUntil: "networkidle" });
  await expect(page.locator('[data-halo-lab="true"]')).toBeVisible();
  await page.locator('[data-b2-ready="true"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
  return externalRequests;
}

async function captureStableSample(page: Page, suffix: string): Promise<Buffer> {
  const sample = page.locator(TARGET_SAMPLE);
  await expect(sample).toBeVisible();
  const box = await sample.boundingBox();
  if (!box) throw new Error("Target halo sample is not measurable");
  expect(Math.abs(box.width - 96)).toBeLessThanOrEqual(0.1);
  expect(Math.abs(box.height - 96)).toBeLessThanOrEqual(0.1);

  const captures: Buffer[] = [];
  for (let index = 0; index < 5; index += 1) {
    captures.push(await sample.screenshot({ animations: "disabled", caret: "hide", scale: "device" }));
  }
  const hashes = captures.map((capture) => createHash("sha256").update(capture).digest("hex"));
  expect(new Set(hashes).size, `${suffix} hashes: ${hashes.join(", ")}`).toBe(1);
  return captures[0];
}

async function closeContext(context: BrowserContext): Promise<void> {
  await context.close();
}

test("Halo Lab is isolated, decoded, static, and network-free", async ({ page }) => {
  const externalRequests = await openHaloLab(page);
  await expect(page.getByRole("heading", { name: "星体光晕实验室" })).toBeVisible();
  expect(await page.locator('[data-halo-sample^="source-"]').count()).toBeGreaterThanOrEqual(7);
  expect(await page.locator('[data-halo-sample^="root-"]').count()).toBeGreaterThan(0);
  expect(await page.locator('[data-halo-sample^="team-"]').count()).toBeGreaterThan(0);
  expect(await page.locator('[data-halo-sample^="question-"]').count()).toBeGreaterThan(0);
  expect(await page.locator('[data-halo-sample^="candidate-"]').count()).toBeGreaterThan(0);
  expect(externalRequests).toEqual([]);
});

test("target Source is byte-stable at DPR1 and DPR2", async ({ browser, page }) => {
  await mkdir(OUTPUT_ROOT, { recursive: true });

  const externalDpr1 = await openHaloLab(page);
  const dpr1 = await captureStableSample(page, "DPR1");
  expect({ width: dpr1.readUInt32BE(16), height: dpr1.readUInt32BE(20) }).toEqual({
    width: 96,
    height: 96,
  });

  const context = await browser.newContext({
    baseURL: BASE_ORIGIN,
    viewport: { width: 1586, height: 992 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    timezoneId: "Asia/Tokyo",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const dpr2Page = await context.newPage();
  const externalDpr2 = await openHaloLab(dpr2Page);
  const dpr2 = await captureStableSample(dpr2Page, "DPR2");
  expect({ width: dpr2.readUInt32BE(16), height: dpr2.readUInt32BE(20) }).toEqual({
    width: 192,
    height: 192,
  });

  await Promise.all([
    writeFile(`${OUTPUT_ROOT}/source-target-dpr1.png`, dpr1),
    writeFile(`${OUTPUT_ROOT}/source-target-dpr2.png`, dpr2),
  ]);
  expect(externalDpr1).toEqual([]);
  expect(externalDpr2).toEqual([]);
  await closeContext(context);
});

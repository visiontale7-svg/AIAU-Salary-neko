import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const VISUAL_PORT = Number(process.env.B2_VISUAL_PORT ?? 4186);
const BASE_ORIGIN = `http://127.0.0.1:${VISUAL_PORT}`;
const CANDIDATE_ROOT = process.env.B2_VISUAL_CANDIDATE_DIR ?? "/tmp/dialogue-atlas-b2-visual";
const CANONICAL_REFERENCE = new URL(
  "../../../docs/images/dialogue-atlas-living-constellation-b2.png",
  import.meta.url,
);
const EXPLORATION_REFERENCE = new URL(
  "../../../docs/images/dialogue-atlas-living-constellation-b2-exploration.png",
  import.meta.url,
);
const REFERENCE_MANIFEST = new URL(
  "../../../docs/images/dialogue-atlas-living-constellation-b2.reference.json",
  import.meta.url,
);

async function openFrozenB2(page: Page): Promise<string[]> {
  const externalRequests: string[] = [];

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });

  await page.addInitScript(() => {
    const installFreezeStyle = () => {
      if (document.getElementById("b2-visual-test-freeze")) return;
      const style = document.createElement("style");
      style.id = "b2-visual-test-freeze";
      style.textContent = `
        *, *::before, *::after {
          animation-delay: 0s !important;
          animation-duration: 0s !important;
          animation-iteration-count: 1 !important;
          caret-color: transparent !important;
          scroll-behavior: auto !important;
          transition: none !important;
        }
      `;
      (document.head ?? document.documentElement).append(style);
    };
    document.addEventListener("DOMContentLoaded", installFreezeStyle, { once: true });
  });

  await page.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    const url = new URL(requestUrl);
    const isLocal = url.origin === BASE_ORIGIN;
    const isInline = url.protocol === "data:" || url.protocol === "blob:";
    if (!isLocal && !isInline) {
      externalRequests.push(requestUrl);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  await page.goto("/?demo=b2", { waitUntil: "networkidle" });
  await expect(page.locator('[data-runtime="deterministic-visual-fixture"]')).toBeVisible();
  await page.locator('[data-b2-ready="true"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (image) => image.decode().catch(() => undefined)),
    );
  });
  await page.waitForTimeout(100);

  return externalRequests;
}

test("canonical reference identity is locked and the former image remains an exploration artifact", async () => {
  const [canonical, exploration, manifestSource] = await Promise.all([
    readFile(CANONICAL_REFERENCE),
    readFile(EXPLORATION_REFERENCE),
    readFile(REFERENCE_MANIFEST, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);

  expect(createHash("sha256").update(canonical).digest("hex")).toBe(
    "f83d824d4e282440f0d3677bd438cf1b129c87cec4fd0e13bac6aca5f19a1a97",
  );
  expect(createHash("sha256").update(exploration).digest("hex")).toBe(
    "b4f4a7dbf7569a12a9e7aa3d1b8a7081d43838264dd21f3fc79f118ad9a30f8f",
  );
  expect({ width: canonical.readUInt32BE(16), height: canonical.readUInt32BE(20) }).toEqual({
    width: 1586,
    height: 992,
  });
  expect(manifest).toMatchObject({
    canonical: {
      sha256: "f83d824d4e282440f0d3677bd438cf1b129c87cec4fd0e13bac6aca5f19a1a97",
      width: 1586,
      height: 992,
    },
    capture: {
      route: "/?demo=b2",
      browser: "chromium",
      deviceScaleFactor: 1,
      locale: "zh-CN",
      timezoneId: "Asia/Tokyo",
      reducedMotion: "reduce",
    },
    approval: { automaticGoldenUpdates: false },
  });
});

test("@candidate captures the canonical 1586x992 DPR1 visual without external traffic", async ({ page }) => {
  const externalRequests = await openFrozenB2(page);
  await mkdir(CANDIDATE_ROOT, { recursive: true });

  expect(page.viewportSize()).toEqual({ width: 1586, height: 992 });
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

  const [railBox, canvasBox, workbenchBox] = await Promise.all([
    page.getByLabel("Dialogue Atlas navigation").boundingBox(),
    page.getByLabel("星图画布").boundingBox(),
    page.getByLabel("协作工作台").boundingBox(),
  ]);
  if (!railBox || !canvasBox || !workbenchBox) throw new Error("Canonical columns are not measurable");
  const expectNear = (actual: number, expected: number) => {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2);
  };
  expectNear(railBox.x, 0);
  expectNear(railBox.width, 64);
  expectNear(canvasBox.x, 64);
  expectNear(canvasBox.width, 1096);
  expectNear(workbenchBox.x, 1160);
  expectNear(workbenchBox.width, 426);

  await page.screenshot({
    path: `${CANDIDATE_ROOT}/candidate-1586x992.png`,
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
  expect(externalRequests).toEqual([]);
});

test("five consecutive canonical captures are byte-stable", async ({ page }) => {
  const externalRequests = await openFrozenB2(page);
  const hashes: string[] = [];

  for (let index = 0; index < 5; index += 1) {
    const png = await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" });
    hashes.push(createHash("sha256").update(png).digest("hex"));
  }

  expect(new Set(hashes).size, `capture hashes: ${hashes.join(", ")}`).toBe(1);
  expect(externalRequests).toEqual([]);
});

test("1280x800 keeps the workbench beside the graph without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const externalRequests = await openFrozenB2(page);
  await mkdir(CANDIDATE_ROOT, { recursive: true });

  const [canvasBox, workbenchBox, overflow] = await Promise.all([
    page.getByLabel("星图画布").boundingBox(),
    page.getByLabel("协作工作台").boundingBox(),
    page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    })),
  ]);

  if (!canvasBox || !workbenchBox) throw new Error("B2 canvas or workbench is not measurable");
  expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(workbenchBox.x + 1);
  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  expect(overflow.bodyWidth).toBeLessThanOrEqual(overflow.viewportWidth);

  await page.screenshot({
    path: `${CANDIDATE_ROOT}/candidate-1280x800.png`,
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
  expect(externalRequests).toEqual([]);
});

test("keyboard selection, workbench tabs and local zoom remain interactive", async ({ page }) => {
  const externalRequests = await openFrozenB2(page);
  const node = page.getByRole("button", { name: "3.2 数据与隐私" });

  await node.focus();
  await node.press("Space");
  await expect(page.getByRole("tab", { name: "节点" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("节点详情")).toContainText("3.2 数据与隐私");

  await page.getByRole("tab", { name: "执行" }).click();
  await expect(page.getByRole("tab", { name: "执行" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("执行详情")).toContainText("分析法规差异");

  await page.getByRole("tab", { name: "对话" }).click();
  await expect(page.getByRole("tab", { name: "对话" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("LLM 房间共享对话")).toBeVisible();

  await page.getByRole("button", { name: "放大" }).click();
  await expect(page.getByLabel("当前缩放")).toContainText("110%");
  await page.getByRole("button", { name: "缩小" }).click();
  await expect(page.getByLabel("当前缩放")).toContainText("100%");

  expect(externalRequests).toEqual([]);
});

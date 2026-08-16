import { createHash } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

const VISUAL_PORT = Number(process.env.B2_VISUAL_PORT ?? 4186);
const BASE_ORIGIN = `http://127.0.0.1:${VISUAL_PORT}`;
const MOTION_ROUTE = "/?demo=b2&motionLab=1";

type PublicSequence = "selected" | "new-node" | "devin-event" | "devin-stale";
type InternalSequence = "selected-focus" | "node-appearing" | "devin-event" | "devin-stale";

interface FrozenFrame {
  publicSequence: PublicSequence;
  internalSequence: InternalSequence;
  timeMs: number;
}

const FROZEN_FRAMES: readonly FrozenFrame[] = [
  { publicSequence: "selected", internalSequence: "selected-focus", timeMs: 0 },
  { publicSequence: "selected", internalSequence: "selected-focus", timeMs: 180 },
  { publicSequence: "selected", internalSequence: "selected-focus", timeMs: 520 },
  { publicSequence: "new-node", internalSequence: "node-appearing", timeMs: 0 },
  { publicSequence: "new-node", internalSequence: "node-appearing", timeMs: 300 },
  { publicSequence: "new-node", internalSequence: "node-appearing", timeMs: 650 },
  { publicSequence: "new-node", internalSequence: "node-appearing", timeMs: 900 },
  { publicSequence: "new-node", internalSequence: "node-appearing", timeMs: 1200 },
  { publicSequence: "new-node", internalSequence: "node-appearing", timeMs: 1450 },
] as const;

const DEVIN_FROZEN_FRAMES: readonly FrozenFrame[] = [
  { publicSequence: "devin-event", internalSequence: "devin-event", timeMs: 0 },
  { publicSequence: "devin-event", internalSequence: "devin-event", timeMs: 90 },
  { publicSequence: "devin-event", internalSequence: "devin-event", timeMs: 580 },
  { publicSequence: "devin-event", internalSequence: "devin-event", timeMs: 640 },
  { publicSequence: "devin-event", internalSequence: "devin-event", timeMs: 700 },
  { publicSequence: "devin-event", internalSequence: "devin-event", timeMs: 745 },
  { publicSequence: "devin-event", internalSequence: "devin-event", timeMs: 850 },
  { publicSequence: "devin-stale", internalSequence: "devin-stale", timeMs: 0 },
  { publicSequence: "devin-stale", internalSequence: "devin-stale", timeMs: 360 },
  { publicSequence: "devin-stale", internalSequence: "devin-stale", timeMs: 800 },
  { publicSequence: "devin-stale", internalSequence: "devin-stale", timeMs: 1400 },
  { publicSequence: "devin-stale", internalSequence: "devin-stale", timeMs: 1600 },
] as const;

async function installNetworkGuard(page: Page): Promise<string[]> {
  const externalRequests: string[] = [];
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
  return externalRequests;
}

async function waitForMotionLab(page: Page): Promise<void> {
  await expect(page.locator('[data-motion-lab="true"]')).toBeVisible();
  await page.locator('[data-b2-ready="true"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
}

async function openFrozenFrame(page: Page, frame: FrozenFrame): Promise<void> {
  await page.goto(
    `${MOTION_ROUTE}&sequence=${frame.publicSequence}&time=${frame.timeMs}&motion=full`,
    { waitUntil: "networkidle" },
  );
  await waitForMotionLab(page);

  const workbench = page.locator("[data-motion-sequence]");
  await expect(workbench).toHaveAttribute("data-motion-sequence", frame.internalSequence);
  await expect(workbench).toHaveAttribute("data-motion-time-ms", String(frame.timeMs));
  await expect(workbench).toHaveAttribute("data-motion-playback", "paused");
  await expect(workbench).toHaveAttribute("data-motion-reduced", "false");
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  expect(overflow.bodyWidth).toBeLessThanOrEqual(overflow.viewportWidth);
}

test("all approved Selected and New Node query frames freeze at exact deterministic state", async ({ page }, testInfo) => {
  const externalRequests = await installNetworkGuard(page);

  for (const frame of FROZEN_FRAMES) {
    await openFrozenFrame(page, frame);
    await page.getByRole("img", { name: "Motion stage" }).screenshot({
      path: testInfo.outputPath(`${frame.publicSequence}-${frame.timeMs}ms.png`),
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });
  }

  expect(externalRequests).toEqual([]);
});

test("the representative selected frame is byte-identical across five captures", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);
  await openFrozenFrame(page, {
    publicSequence: "selected",
    internalSequence: "selected-focus",
    timeMs: 180,
  });

  const stage = page.getByRole("img", { name: "Motion stage" });
  await expect(stage).toBeVisible();
  const hashes: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const png = await stage.screenshot({ animations: "disabled", caret: "hide", scale: "css" });
    hashes.push(createHash("sha256").update(png).digest("hex"));
  }

  expect(new Set(hashes).size, `capture hashes: ${hashes.join(", ")}`).toBe(1);
  expect(externalRequests).toEqual([]);
});

test("Devin Event and Stale expose every approved deterministic frame with at most one packet", async ({ page }, testInfo) => {
  const externalRequests = await installNetworkGuard(page);
  const hashes: string[] = [];

  for (const frame of DEVIN_FROZEN_FRAMES) {
    await openFrozenFrame(page, frame);
    await expect(page.locator('[data-motion-devin-fixture="true"]')).toContainText("视觉 Fixture · 非实时状态");

    const packet = page.locator('[data-motion-event-packet="true"]');
    if (frame.publicSequence === "devin-event" && frame.timeMs > 0 && frame.timeMs < 700) {
      await expect(packet).toHaveCount(1);
      await expect(page.locator('[data-motion-path-packet="devin-event"]')).toHaveCount(1);
    } else {
      await expect(packet).toHaveCount(0);
    }

    if (frame.publicSequence === "devin-stale") {
      await expect(page.locator("[data-motion-path-packet]")).toHaveCount(0);
      if (frame.timeMs === 1600) {
        await expect(page.locator('[data-motion-devin-body="true"]')).toHaveAttribute("opacity", "0.8200000000000001");
        await expect(page.locator('[data-motion-devin-energy="true"]')).toHaveAttribute("opacity", "0.4");
        await expect(page.locator('[data-motion-stale-ring="true"]')).toHaveAttribute("opacity", "1");
      }
    }

    const png = await page.getByRole("img", { name: "Motion stage" }).screenshot({
      path: testInfo.outputPath(`${frame.publicSequence}-${frame.timeMs}ms.png`),
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });
    if (frame.publicSequence === "devin-event" && frame.timeMs === 640) {
      hashes.push(createHash("sha256").update(png).digest("hex"));
      for (let index = 0; index < 4; index += 1) {
        const repeated = await page.getByRole("img", { name: "Motion stage" }).screenshot({
          animations: "disabled",
          caret: "hide",
          scale: "css",
        });
        hashes.push(createHash("sha256").update(repeated).digest("hex"));
      }
    }
  }

  expect(new Set(hashes).size, `Devin event capture hashes: ${hashes.join(", ")}`).toBe(1);
  expect(externalRequests).toEqual([]);
});

test("canonical and compact viewports remain contained without horizontal overflow", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);

  for (const viewport of [
    { width: 1586, height: 992 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await openFrozenFrame(page, {
      publicSequence: "selected",
      internalSequence: "selected-focus",
      timeMs: 180,
    });
    expect(page.viewportSize()).toEqual(viewport);
    await expectNoHorizontalOverflow(page);
  }

  expect(externalRequests).toEqual([]);
});

test("Reduced Motion exposes the final New Node state and a static new marker", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);
  await page.goto(`${MOTION_ROUTE}&sequence=new-node&motion=reduced`, { waitUntil: "networkidle" });
  await waitForMotionLab(page);

  const workbench = page.locator("[data-motion-sequence]");
  await expect(workbench).toHaveAttribute("data-motion-sequence", "node-appearing");
  await expect(workbench).toHaveAttribute("data-motion-time-ms", "1450");
  await expect(workbench).toHaveAttribute("data-motion-playback", "finished");
  await expect(workbench).toHaveAttribute("data-motion-reduced", "true");
  await expect(page.locator('[data-motion-static-new="true"]')).toContainText("新增");
  await expect(page.locator("[data-motion-particle]")).toHaveCount(12);

  expect(externalRequests).toEqual([]);
});

test("Reduced Motion settles Devin Event and Stale without requestAnimationFrame", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    Object.defineProperty(window, "__b2MotionRafCalls", { value: 0, writable: true });
    window.requestAnimationFrame = (callback) => {
      const state = window as typeof window & { __b2MotionRafCalls: number };
      state.__b2MotionRafCalls += 1;
      return original(callback);
    };
  });

  await page.goto(`${MOTION_ROUTE}&sequence=devin-event&motion=reduced`, { waitUntil: "networkidle" });
  await waitForMotionLab(page);
  let workbench = page.locator("[data-motion-sequence]");
  await expect(workbench).toHaveAttribute("data-motion-time-ms", "850");
  await expect(workbench).toHaveAttribute("data-motion-playback", "finished");
  await expect(page.locator('[data-motion-event-packet="true"]')).toHaveCount(0);
  await expect(page.locator('[data-motion-devin-event-lift="true"]')).toHaveAttribute("opacity", "0");
  expect(await page.evaluate(() => (window as typeof window & { __b2MotionRafCalls: number }).__b2MotionRafCalls)).toBe(0);

  await page.goto(`${MOTION_ROUTE}&sequence=devin-stale&motion=reduced`, { waitUntil: "networkidle" });
  await waitForMotionLab(page);
  workbench = page.locator("[data-motion-sequence]");
  await expect(workbench).toHaveAttribute("data-motion-time-ms", "1600");
  await expect(workbench).toHaveAttribute("data-motion-playback", "finished");
  await expect(page.locator('[data-motion-devin-body="true"]')).toHaveAttribute("opacity", "0.8200000000000001");
  await expect(page.locator('[data-motion-devin-energy="true"]')).toHaveAttribute("opacity", "0.4");
  await expect(page.locator('[data-motion-stale-ring="true"]')).toHaveAttribute("opacity", "1");
  await expect(page.locator('[data-motion-event-packet="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { __b2MotionRafCalls: number }).__b2MotionRafCalls)).toBe(0);

  await page.goto(`${MOTION_ROUTE}&sequence=devin-stale&time=100&motion=reduced`, { waitUntil: "networkidle" });
  await waitForMotionLab(page);
  workbench = page.locator("[data-motion-sequence]");
  await expect(workbench).toHaveAttribute("data-motion-time-ms", "1600");
  await expect(workbench).toHaveAttribute("data-motion-playback", "paused");
  expect(externalRequests).toEqual([]);
});

test("inspection scale and manual Replay/Pause controls stay interactive", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);
  await page.goto(`${MOTION_ROUTE}&motion=full`, { waitUntil: "networkidle" });
  await waitForMotionLab(page);

  const workbench = page.locator("[data-motion-sequence]");
  await expect(workbench).toHaveAttribute("data-motion-sequence", "idle");
  await expect(workbench).toHaveAttribute("data-motion-time-ms", "0");
  await expect(workbench).toHaveAttribute("data-motion-playback", "idle");

  await page.getByRole("button", { name: "200% inspection" }).click();
  await expect(page.getByRole("img", { name: "Motion stage" })).toHaveAttribute("data-motion-stage-scale", "2");
  await page.getByRole("button", { name: "100% inspection" }).click();
  await expect(page.getByRole("img", { name: "Motion stage" })).toHaveAttribute("data-motion-stage-scale", "1");

  await page.getByRole("button", { name: "Selected" }).click();
  await expect(workbench).toHaveAttribute("data-motion-sequence", "selected-focus");
  await expect(page.getByRole("button", { name: "Replay animation" })).toBeEnabled();
  await page.getByRole("button", { name: "Replay animation" }).click();
  await expect(workbench).toHaveAttribute("data-motion-playback", "playing");
  await page.getByRole("button", { name: "Pause animation" }).click();
  await expect(workbench).toHaveAttribute("data-motion-playback", "paused");
  await expect(page.getByRole("slider", { name: "Motion timeline" })).toBeEnabled();

  await page.getByRole("button", { name: "Devin Event" }).click();
  await expect(workbench).toHaveAttribute("data-motion-sequence", "devin-event");
  await expect(workbench).toHaveAttribute("data-motion-playback", "idle");
  await page.getByRole("button", { name: "Replay animation" }).click();
  await expect(workbench).toHaveAttribute("data-motion-playback", "playing");
  await page.getByRole("button", { name: "Pause animation" }).click();
  await expect(workbench).toHaveAttribute("data-motion-playback", "paused");

  await page.getByRole("button", { name: "Devin Stale" }).click();
  await expect(workbench).toHaveAttribute("data-motion-sequence", "devin-stale");
  await expect(workbench).toHaveAttribute("data-motion-playback", "idle");

  const prohibited = await page.locator('[data-motion-lab="true"]').innerText();
  expect(prohibited).not.toMatch(/offline|reconnect|离线/i);
  expect(await page.locator("animate, animateTransform, animateMotion").count()).toBe(0);
  const animatedElements = await page.locator(".motion-lab *").evaluateAll((elements) => elements.filter((element) => {
    const style = getComputedStyle(element);
    return style.animationName !== "none" && style.animationDuration !== "0s";
  }).length);
  expect(animatedElements).toBe(0);

  expect(externalRequests).toEqual([]);
});

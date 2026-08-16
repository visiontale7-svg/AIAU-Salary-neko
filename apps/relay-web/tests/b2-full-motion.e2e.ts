import { createHash } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

const VISUAL_PORT = Number(process.env.B2_VISUAL_PORT ?? 4186);
const BASE_ORIGIN = `http://127.0.0.1:${VISUAL_PORT}`;
const FULL_DEMO_ROUTE = "/?demo=b2&motionDemo=1";

interface FrozenDemoFrame {
  timeMs: number;
  phase:
    | "prepare"
    | "candidate"
    | "candidate-settled"
    | "devin-event"
    | "event-settled"
    | "devin-stale"
    | "finished";
  sequence: "idle" | "node-appearing" | "devin-event" | "devin-stale";
  packetCount: 0 | 1;
}

const FROZEN_DEMO_FRAMES: readonly FrozenDemoFrame[] = [
  { timeMs: 0, phase: "prepare", sequence: "idle", packetCount: 0 },
  { timeMs: 1000, phase: "candidate", sequence: "node-appearing", packetCount: 1 },
  { timeMs: 1850, phase: "candidate-settled", sequence: "idle", packetCount: 0 },
  { timeMs: 2700, phase: "devin-event", sequence: "devin-event", packetCount: 1 },
  { timeMs: 3200, phase: "event-settled", sequence: "idle", packetCount: 0 },
  { timeMs: 4500, phase: "devin-stale", sequence: "devin-stale", packetCount: 0 },
  { timeMs: 5300, phase: "finished", sequence: "idle", packetCount: 0 },
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

async function waitForFullB2(page: Page): Promise<void> {
  await expect(page.locator('[data-runtime="deterministic-visual-fixture"]')).toBeVisible();
  await page.locator('[data-b2-ready="true"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
}

async function openFrozenDemoFrame(page: Page, frame: FrozenDemoFrame): Promise<void> {
  await page.goto(
    `${FULL_DEMO_ROUTE}&motionTime=${frame.timeMs}&motion=full`,
    { waitUntil: "networkidle" },
  );
  await waitForFullB2(page);

  const root = page.locator('[data-motion-demo="true"]');
  await expect(root).toHaveAttribute("data-motion-time-ms", String(frame.timeMs));
  await expect(root).toHaveAttribute("data-motion-phase", frame.phase);
  await expect(root).toHaveAttribute("data-motion-sequence", frame.sequence);
  await expect(root).toHaveAttribute("data-motion-playback", frame.timeMs === 5300 ? "finished" : "paused");
  await expect(root).toHaveAttribute("data-motion-reduced", "false");
  await expect(root).toHaveAttribute("data-motion-packet-count", String(frame.packetCount));
  await expect(page.locator("[data-motion-path-packet]")).toHaveCount(frame.packetCount);
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

test("full B2 exposes every locked motion-demo phase as a deterministic fixed frame", async ({ page }, testInfo) => {
  const externalRequests = await installNetworkGuard(page);

  for (const frame of FROZEN_DEMO_FRAMES) {
    await openFrozenDemoFrame(page, frame);
    await page.getByLabel("星图画布").screenshot({
      path: testInfo.outputPath(`full-demo-${frame.timeMs}ms.png`),
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });
  }

  expect(externalRequests).toEqual([]);
});

test("candidate growth preserves context, uses twelve particles and never creates a second packet", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);
  await openFrozenDemoFrame(page, FROZEN_DEMO_FRAMES[1]);

  await expect(page.locator('[data-b2-pass="path-atmosphere"] .b2-path.is-dashed')).toHaveCount(1);
  await expect(page.locator('[data-motion-path-reveal="candidate"]')).toHaveCount(1);
  await expect(page.locator("[data-motion-particle]")).toHaveCount(12);
  const candidate = page.locator('[data-b2-star-id="candidate"]');
  const candidateHit = page.locator('[data-b2-star-hit="candidate"]');
  await expect(candidate).toHaveCSS("pointer-events", "none");
  await expect(candidate).not.toHaveAttribute("role", "button");
  await expect(candidate).not.toHaveAttribute("tabindex", "0");
  await expect(candidateHit).toHaveAttribute("pointer-events", "none");

  const hitBox = await candidateHit.boundingBox();
  expect(hitBox).not.toBeNull();
  const initialReadout = await page.locator(".b2-selected-readout").textContent();
  await page.mouse.click(hitBox!.x + hitBox!.width / 2, hitBox!.y + hitBox!.height / 2);
  await expect(page.locator(".b2-selected-readout")).toHaveText(initialReadout ?? "");

  const keyboardFocusedStarIds: string[] = [];
  for (let index = 0; index < 28; index += 1) {
    await page.keyboard.press("Tab");
    const focusedId = await page.evaluate(() => document.activeElement?.getAttribute("data-b2-star-id") ?? "");
    if (focusedId) {
      keyboardFocusedStarIds.push(focusedId);
      await page.keyboard.press("Enter");
      await expect(page.locator(".b2-selected-readout")).not.toHaveText("当前选择：候选观点");
    }
  }
  expect(keyboardFocusedStarIds).not.toContain("candidate");
  expect(externalRequests).toEqual([]);
});

test("Devin packet is singular and stale is a static non-packet terminal state", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);
  await openFrozenDemoFrame(page, FROZEN_DEMO_FRAMES[3]);

  const packet = page.locator('[data-motion-path-packet="devin-event"]');
  await expect(packet).toHaveCount(1);
  await expect(packet.locator("circle")).toHaveCount(2);
  await expect(packet.locator("rect")).toHaveCount(1);

  await openFrozenDemoFrame(page, FROZEN_DEMO_FRAMES[5]);
  await expect(page.locator("[data-motion-path-packet]")).toHaveCount(0);
  await expect(page.locator('[data-motion-stale-ring="privacy"]')).toHaveCount(1);
  await expect(page.locator('[data-motion-devin-stale="privacy"]')).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText(/offline|reconnect|离线/i);
  expect(externalRequests).toEqual([]);
});

test("one representative full-demo frame is byte-identical across five captures", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);
  await openFrozenDemoFrame(page, FROZEN_DEMO_FRAMES[3]);

  const hashes: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const png = await page.getByLabel("星图画布").screenshot({
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });
    hashes.push(createHash("sha256").update(png).digest("hex"));
  }

  expect(new Set(hashes).size, `capture hashes: ${hashes.join(", ")}`).toBe(1);
  expect(externalRequests).toEqual([]);
});

test("Reduced Motion resolves the demo to its final semantic frame without moving", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);
  await page.goto(`${FULL_DEMO_ROUTE}&motionTime=1000&motion=reduced`, { waitUntil: "networkidle" });
  await waitForFullB2(page);

  const root = page.locator('[data-motion-demo="true"]');
  await expect(root).toHaveAttribute("data-motion-time-ms", "5300");
  await expect(root).toHaveAttribute("data-motion-phase", "finished");
  await expect(root).toHaveAttribute("data-motion-playback", "finished");
  await expect(root).toHaveAttribute("data-motion-reduced", "true");
  await expect(root).toHaveAttribute("data-motion-packet-count", "0");
  await expect(page.locator('[data-motion-static-new="candidate"]')).toHaveCount(1);
  await expect(page.locator('[data-motion-stale-ring="privacy"]')).toHaveCount(1);
  await expect(page.locator("[data-motion-path-packet]")).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test("full B2 retains eight passes and responsive containment at both approved viewports", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);

  for (const viewport of [{ width: 1586, height: 992 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await openFrozenDemoFrame(page, FROZEN_DEMO_FRAMES[3]);
    const passes = await page.locator(".b2-graph__zoom > [data-b2-pass]").evaluateAll(
      (elements) => elements.map((element) => element.getAttribute("data-b2-pass")),
    );
    expect(passes).toEqual([
      "path-atmosphere",
      "star-aura",
      "path-core",
      "motion-path-overlay",
      "path-particles",
      "star-body",
      "motion-star-overlay",
      "star-overlay",
    ]);
    await expectNoHorizontalOverflow(page);
  }

  expect(externalRequests).toEqual([]);
});

test("ordinary B2 replays selection only after the selected node changes", async ({ page }) => {
  const externalRequests = await installNetworkGuard(page);
  await page.goto("/?demo=b2&motion=full", { waitUntil: "networkidle" });
  await waitForFullB2(page);

  const root = page.locator('[data-runtime="deterministic-visual-fixture"]');
  await expect(root).toHaveAttribute("data-motion-playback", "idle");

  await page.getByRole("button", { name: "1 · 用户价值" }).click();
  await expect(root).toHaveAttribute("data-motion-event-key", "selection:1:value");
  await page.getByRole("button", { name: "1 · 用户价值" }).click();
  await expect(root).toHaveAttribute("data-motion-event-key", "selection:1:value");

  await page.getByRole("button", { name: "2 · 核心体验" }).focus();
  await page.getByRole("button", { name: "2 · 核心体验" }).press("Enter");
  await expect(root).toHaveAttribute("data-motion-event-key", "selection:2:experience");
  await expect(page.locator('[data-motion-selection-departing="value"]')).toHaveCount(1);

  await page.getByRole("button", { name: "1 · 用户价值" }).focus();
  await page.getByRole("button", { name: "1 · 用户价值" }).press("Space");
  await expect(root).toHaveAttribute("data-motion-event-key", "selection:3:value");
  await expect(page.locator('[data-motion-selection-departing="experience"]')).toHaveCount(1);
  expect(externalRequests).toEqual([]);
});

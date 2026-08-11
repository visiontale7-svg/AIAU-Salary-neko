import { expect, test, type Page } from "@playwright/test";

async function openFreshB5(page: Page) {
  await page.goto("/?fixture=b5&reset=1");
  await expect(page.getByRole("heading", { name: /^对话图谱/ })).toBeVisible();
  await expect(page.getByLabel("对话关系星图")).toBeVisible();
}

test.describe("B5 Dialogue Atlas browser demo", () => {
  test("an empty persisted layout is automatically organized and saved without page errors", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await openFreshB5(page);

    // Force one store update so the fixed demo snapshot exists in localStorage,
    // then reproduce a desktop snapshot whose persisted layout has no nodes.
    await page.getByRole("button", { name: "模式叠层" }).first().click();
    await page.getByRole("button", { name: "模式叠层" }).first().click();
    await page.evaluate(() => {
      const key = "dialogue-atlas-demo-snapshot-v1";
      const value = window.localStorage.getItem(key);
      if (!value) throw new Error("demo snapshot was not persisted");
      const snapshot = JSON.parse(value) as { layout: Record<string, unknown> };
      snapshot.layout = {};
      window.localStorage.setItem(key, JSON.stringify(snapshot));
    });

    await page.goto("/?fixture=b5");
    await expect(page.getByLabel("对话关系星图")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const value = window.localStorage.getItem("dialogue-atlas-demo-snapshot-v1");
      if (!value) return false;
      const snapshot = JSON.parse(value) as {
        layout: Record<string, { x: number; y: number }>;
      };
      const positions = Object.values(snapshot.layout);
      return positions.length > 0 && positions.every(
        ({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0),
      );
    }), { timeout: 15_000 }).toBe(true);

    await page.getByRole("button", { name: "整理布局" }).click();
    await expect(page.getByText("已整理布局；手动固定的节点保持原位")).toBeVisible({
      timeout: 15_000,
    });
    expect(pageErrors).toEqual([]);
  });

  test("renders the approved 1536×1024 graph-first frame", async ({ page }) => {
    await openFreshB5(page);

    await expect(page.getByText(/15\s*轮/).first()).toBeVisible();
    await expect(page.getByText(/41\s*个?语义片段|41\s*片段/).first()).toBeVisible();
    await expect(page.getByText(/29\s*(个)?已展开/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /不换题，但不要逃避 novelty/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /每句话都要先主动证伪/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /展开 12 个次级片段/ })).toBeVisible();

    await expect(page).toHaveScreenshot("b5-atlas-1536x1024.png", {
      animations: "disabled",
      caret: "hide",
      fullPage: false,
    });
  });

  test("mode inference can be hidden without moving semantic nodes", async ({ page }) => {
    await openFreshB5(page);

    const anchor = page.getByRole("button", { name: /每句话都要先主动证伪/ }).first();
    // The initial fitView animation must settle before position invariance is measured.
    await page.waitForTimeout(700);
    const before = await anchor.boundingBox();
    expect(await page.getByTestId("mode-island").count()).toBeGreaterThan(0);

    await page.getByRole("button", { name: "模式叠层" }).first().click();
    await expect(page.getByTestId("mode-island")).toHaveCount(0);

    const after = await anchor.boundingBox();
    expect(after?.x).toBeCloseTo(before?.x ?? 0, 0);
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);

    await page.getByRole("button", { name: "模式叠层" }).first().click();
    expect(await page.getByTestId("mode-island").count()).toBeGreaterThan(0);
  });

  test("a node opens its exact visible evidence", async ({ page }) => {
    await openFreshB5(page);

    await page.getByRole("button", { name: /每句话都要先主动证伪/ }).first().click();
    const evidence = page.getByLabel("原文证据");
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText("每句话要像研究一样，都得有依据为自己辩护才行");
    await expect(evidence).toContainText(/AI 推断|人工纠正/);
  });

  test("expands and collapses all 12 secondary fragments", async ({ page }) => {
    await openFreshB5(page);

    await page.getByRole("button", { name: /展开 12 个次级片段/ }).click();
    await expect(
      page.getByRole("button", { name: /检索范围：linkography 与 rationale/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /收起 12 个次级片段/ })).toBeVisible();

    await page.getByRole("button", { name: /收起 12 个次级片段/ }).click();
    await expect(
      page.getByRole("button", { name: /检索范围：linkography 与 rationale/ }),
    ).toHaveCount(0);
  });

  test("search and keyboard selection reach the same evidence panel", async ({ page }) => {
    await openFreshB5(page);

    await page.getByLabel("搜索原文").fill("pilot");
    const result = page.getByRole("button", { name: /外部标注 pilot 已有直接先例/ }).first();
    await expect(result).toBeVisible();
    await result.focus();
    await expect(result).toBeFocused();
    await result.press("Enter");
    await expect(page.getByLabel("原文证据")).toContainText("外部标注 pilot 已经有直接先例");
  });

  test("a local correction survives a browser refresh", async ({ page }) => {
    await openFreshB5(page);

    await page.getByRole("button", { name: /每句话都要先主动证伪/ }).first().click();
    await page.getByRole("button", { name: "纠正分析" }).click();
    const input = page.getByLabel(/修正后的标签|显示标签/);
    await input.fill("每项判断都要先主动证伪");
    await page.getByRole("button", { name: "保存纠正" }).click();
    await expect(page.getByRole("button", { name: /每项判断都要先主动证伪/ }).first()).toBeVisible();

    await page.goto("/?fixture=b5");
    await expect(page.getByRole("button", { name: /每项判断都要先主动证伪/ }).first()).toBeVisible();
  });

  test("the relation editor is keyboard-modal and creates an evidence-backed relation", async ({ page }) => {
    await openFreshB5(page);

    await page.getByRole("button", { name: "＋ 关系" }).click();
    const dialog = page.getByRole("dialog", { name: "新增有证据的关系" });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "＋ 关系" }).click();
    await page.getByLabel("显示标签").fill("人工证据关系");
    await page.getByRole("button", { name: "新增关系" }).click();
    await expect(page.getByRole("button", { name: /人工证据关系/ }).first()).toBeVisible();
  });

  test("browser paste stays a preview and cannot masquerade as model analysis", async ({ page }) => {
    await openFreshB5(page);

    await page.getByRole("button", { name: "导入对话" }).click();
    await page.getByLabel(/使用“用户/).fill("用户：这是我的问题\nGPT：这是回答");
    await page.getByRole("button", { name: "预览轮次" }).click();
    await expect(page.getByText("浏览器仅预览轮次")).toBeVisible();
    await expect(page.getByRole("button", { name: "请使用桌面版分析" })).toBeDisabled();
  });

  test("provider choices stay visible while browser-demo keeps every readiness action offline", async ({ page }) => {
    await openFreshB5(page);

    await page.getByRole("button", { name: "设置" }).click();
    const dialog = page.getByRole("dialog", { name: "本地分析设置" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /OpenAI API/ })).toBeChecked();
    await expect(dialog.getByLabel("OpenAI API key")).toBeVisible();
    await expect(dialog.getByText(/不会调用 Codex CLI、读取 Keychain 或发送 OpenAI API 请求/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "保存并测试" })).toBeDisabled();

    await dialog.getByRole("radio", { name: /Codex via ChatGPT/ }).click();
    await expect(dialog.getByLabel("OpenAI API key")).toHaveCount(0);
    await expect(dialog.getByText(/先消耗套餐内 Codex 用量/)).toBeVisible();
    await expect(dialog.getByText(/auto top-up/).first()).toBeVisible();
    await expect(dialog.getByText(/不会读取、复制或保存登录令牌/)).toBeVisible();
    await expect(dialog.getByText(/只确认 CLI 兼容且当前为 ChatGPT 登录/)).toContainText("不读取剩余额度");
    await expect(dialog.getByRole("button", { name: "保存并检测登录" })).toBeDisabled();
  });
});

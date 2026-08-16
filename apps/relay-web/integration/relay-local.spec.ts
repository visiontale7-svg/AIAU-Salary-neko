import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { RelaySupabaseRepository, type SupabaseClientLike } from "@dialogue-atlas/relay-supabase";
import { relayFixturePackage } from "../src/fixture";

interface PublicConfig {
  url: string;
  publishableKey: string;
}

interface OwnerIdentity {
  client: SupabaseClient;
  repository: RelaySupabaseRepository;
  session: Session;
}

function publicConfig(): PublicConfig {
  const file = path.resolve(import.meta.dirname, "../../../.env.local");
  const values = Object.fromEntries(readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
  const url = values.VITE_SUPABASE_URL;
  const publishableKey = values.VITE_SUPABASE_PUBLISHABLE_KEY;
  const parsed = new URL(url ?? "");
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1"
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || !publishableKey?.startsWith("sb_publishable_")) {
    throw new Error("Local Relay E2E requires the generated loopback public-client configuration");
  }
  return { url, publishableKey };
}

async function createOwner(config: PublicConfig): Promise<OwnerIdentity> {
  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const auth = await client.auth.signInAnonymously();
  if (auth.error || !auth.data.session) throw new Error(auth.error?.message ?? "Anonymous owner session failed");
  return {
    client,
    session: auth.data.session,
    repository: new RelaySupabaseRepository(client as unknown as SupabaseClientLike),
  };
}

async function installSession(context: BrowserContext, config: PublicConfig, session: Session): Promise<void> {
  const storageKey = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
  await context.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: session });
}

test("two anonymous browsers complete the B2 collaboration decision loop", async ({ browser, baseURL }) => {
  const config = publicConfig();
  const owner = await createOwner(config);
  const suffix = Date.now().toString(36);
  const pkg = structuredClone(relayFixturePackage);
  pkg.packageId = `pkg_browser_${suffix}`;
  pkg.clientPublishId = `publish_browser_${suffix}`;
  pkg.title = "B2 local browser collaboration";
  pkg.publishedAt = new Date().toISOString();
  const created = await owner.repository.createRoomWithPackage(pkg, { maxUses: 2 });

  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  await installSession(ownerContext, config, owner.session);
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();

  try {
    await ownerPage.goto(`${baseURL}/room/${created.roomId}`);
    await expect(ownerPage.getByRole("group", { name: "Live Relay decision constellation" })).toBeVisible();
    await expect(ownerPage.getByText("实时协作中")).toBeVisible();

    await memberPage.goto(`${baseURL}/room/${created.roomId}#invite=${encodeURIComponent(created.inviteToken)}`);
    await expect(memberPage.getByRole("heading", { name: "Join a private review room" })).toBeVisible();
    await memberPage.getByLabel("Display name").fill("Browser reviewer");
    await memberPage.getByRole("button", { name: "Join room" }).click();
    await expect(memberPage).toHaveURL(`${baseURL}/room/${created.roomId}`);
    await expect(memberPage.getByRole("group", { name: "Live Relay decision constellation" })).toBeVisible();
    await expect(ownerPage.getByLabel("Members online")).toContainText("2 人在线");

    await memberPage.getByRole("tab", { name: "节点" }).click();
    await memberPage.getByRole("button", { name: "＋ 团队观点" }).click();
    await memberPage.getByRole("form", { name: "新增团队观点" }).getByLabel("标题").fill("与 Miro 的定位差异");
    await memberPage.getByRole("button", { name: "加入房间" }).click();

    await expect(ownerPage.locator("main[data-motion-sequence='node-appearing']")).toBeVisible();
    await expect(ownerPage.getByRole("button", { name: "团队节点：与 Miro 的定位差异" })).toBeVisible();

    const source = memberPage.getByRole("button", { name: /来源节点：/ }).first();
    await source.click();
    await memberPage.getByText("提出语义修改提案").click();
    await memberPage.getByLabel("建议值").fill("强调从私人证据到团队决策的连续链路");
    await memberPage.getByLabel("理由").fill("区别于通用白板，需要保留来源和决策责任。");
    await memberPage.getByRole("button", { name: "提交提案" }).click();

    await ownerPage.getByRole("tab", { name: /讨论/ }).click();
    await expect(ownerPage.getByRole("list", { name: "房间提案" }).getByText("区别于通用白板，需要保留来源和决策责任。"))
      .toBeVisible();
    await ownerPage.getByLabel("房主决定依据").fill("该定位直接说明产品价值和边界。");
    await ownerPage.getByRole("button", { name: "接受" }).click();

    await memberPage.getByRole("tab", { name: /讨论/ }).click();
    await expect(memberPage.locator(".b2-decision").getByText("accepted", { exact: true })).toBeVisible();
    const ownerBundle = await owner.repository.fetchRoom(created.roomId);
    expect(ownerBundle.teamItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemType: "node", label: "与 Miro 的定位差异" }),
    ]));
    expect(ownerBundle.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: "accepted" }),
    ]));
  } finally {
    await owner.repository.closeRoom(created.roomId).catch(() => undefined);
    await ownerContext.close();
    await memberContext.close();
    await owner.client.auth.signOut().catch(() => undefined);
  }
});

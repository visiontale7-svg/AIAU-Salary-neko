import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { RelaySupabaseRepository, type SupabaseClientLike } from "@dialogue-atlas/relay-supabase";
import { describe, expect, it } from "vitest";
import { relayFixturePackage } from "./fixture";

const localEnabled = process.env.RELAY_LOCAL_SUPABASE_SMOKE === "1";
const linkedEnabled = process.env.RELAY_LINKED_SUPABASE_SMOKE === "1";
const enabled = localEnabled || linkedEnabled;

function publicConfig(): { url: string; publishableKey: string } {
  if (localEnabled === linkedEnabled) {
    throw new Error("Select exactly one Relay Supabase smoke environment");
  }
  const fileName = localEnabled ? ".env.local" : ".env.production.local";
  const file = path.resolve(import.meta.dirname, `../../../${fileName}`);
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
  const validOrigin = localEnabled
    ? parsed.protocol === "http:" && parsed.hostname === "127.0.0.1"
    : parsed.protocol === "https:" && parsed.hostname.endsWith(".supabase.co");
  if (!validOrigin || parsed.username || parsed.password || parsed.search || parsed.hash
    || !publishableKey?.startsWith("sb_publishable_")) {
    throw new Error("Supabase public client configuration is missing or unsafe");
  }
  return { url, publishableKey };
}

describe.skipIf(!enabled)("Supabase integration", () => {
  it("authenticates anonymous owner/member identities and enforces room RLS", async () => {
    const { url, publishableKey } = publicConfig();
    const createAnonymousRepository = async () => {
      const client = createClient(url, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const auth = await client.auth.signInAnonymously();
      if (auth.error || !auth.data.session) {
        throw new Error(auth.error?.message ?? "Anonymous authentication returned no session");
      }
      return new RelaySupabaseRepository(client as unknown as SupabaseClientLike);
    };

    const owner = await createAnonymousRepository();
    const suffix = Date.now().toString(36);
    const pkg = structuredClone(relayFixturePackage);
    pkg.packageId = `pkg_rls_smoke_${suffix}`;
    pkg.clientPublishId = `publish_rls_smoke_${suffix}`;
    pkg.title = "Relay RLS smoke room";
    pkg.publishedAt = new Date().toISOString();

    const created = await owner.createRoomWithPackage(pkg, { maxUses: 2 });
    const member = await createAnonymousRepository();
    await expect(member.joinRoom(created.inviteToken, "Local reviewer"))
      .resolves.toEqual({ roomId: created.roomId });

    const ownerBundle = await owner.fetchRoom(created.roomId);
    const memberBundle = await member.fetchRoom(created.roomId);
    expect(ownerBundle.member.role).toBe("owner");
    expect(memberBundle.member.role).toBe("member");

    const outsider = await createAnonymousRepository();
    await expect(outsider.fetchRoom(created.roomId)).rejects.toThrow();
    await expect(owner.closeRoom(created.roomId)).resolves.toEqual({ activitySeq: expect.any(Number) });
  });
});

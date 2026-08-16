import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  RelayRoomRepository,
  RoomBundle,
} from "@dialogue-atlas/relay-contract";
import { RelayWebApp } from "./App";
import { createRelayFixtureBundle, relayFixturePackage } from "./fixture";
import {
  bootstrapRelayAnonymousClient,
  parseRelayRoute,
  RelayProductionApp,
  sanitizeRedeemedInviteRoute,
  validateRelayProductionConfig,
  type RelayAnonymousClient,
} from "./production";
import { relayContentSecurityPolicy, relaySupabaseConnectSources } from "./security-policy";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function repository(overrides: Partial<RelayRoomRepository> = {}): RelayRoomRepository {
  const bundle = createRelayFixtureBundle();
  return {
    createRoomWithPackage: vi.fn(async () => ({ roomId: bundle.room.id, inviteToken: "invite_demo" })),
    publishAtlasVersion: vi.fn(async () => ({ atlasVersionId: "version_next", version: 2, activitySeq: 22 })),
    createRoomInvite: vi.fn(async () => ({ inviteToken: "invite_next" })),
    closeRoom: vi.fn(async () => ({ activitySeq: 22 })),
    joinRoom: vi.fn(async () => ({ roomId: bundle.room.id })),
    fetchRoom: vi.fn(async () => bundle),
    loadActivity: vi.fn(async () => []),
    upsertTeamGraphItem: vi.fn(async () => ({ value: bundle.teamItems[0]!, activitySeq: 22 })),
    saveLayoutItem: vi.fn(async () => ({ value: { roomId: bundle.room.id, nodeId: "n001", x: 10, y: 10, revision: 1, updatedBy: bundle.member.userId }, activitySeq: 22 })),
    setNodeStance: vi.fn(async ({ roomId, nodeId, stance }) => ({ value: { roomId, nodeId, stance, userId: bundle.member.userId, updatedAt: "2026-08-15T03:30:00.000Z" }, activitySeq: 22 })),
    submitProposal: vi.fn(async (input) => ({ value: { ...input, id: "proposal_mock", status: "open", revision: 1, createdBy: bundle.member.userId, createdAt: "2026-08-15T03:30:00.000Z" }, activitySeq: 22 })),
    appendProposalComment: vi.fn(async ({ roomId, proposalId, body, clientMutationId }) => ({ value: { id: "comment_mock", roomId, proposalId, body, clientMutationId, createdBy: bundle.member.userId, createdAt: "2026-08-15T03:30:00.000Z" }, activitySeq: 22 })),
    decideProposal: vi.fn(async ({ roomId, proposalId, decision, rationale }) => ({ value: { id: "decision_mock", roomId, proposalId, decision, rationale, decidedBy: bundle.member.userId, decidedAt: "2026-08-15T03:30:00.000Z" }, activitySeq: 22 })),
    createActionBrief: vi.fn(async (input) => ({ value: { ...input, id: "brief_mock", createdBy: bundle.member.userId, createdAt: "2026-08-15T03:30:00.000Z" }, activitySeq: 22 })),
    createDevinRun: vi.fn(async ({ roomId, actionBriefId }) => ({ id: "devin_mock", roomId, actionBriefId, state: "not_configured" as const, providerHealth: "unknown" as const, consecutiveFailures: 0, updatedAt: "2026-08-15T03:30:00.000Z" })),
    refreshDevinRun: vi.fn(async ({ roomId, runId }) => ({ id: runId, roomId, actionBriefId: "brief_demo", state: "not_configured" as const, providerHealth: "unknown" as const, consecutiveFailures: 0, updatedAt: "2026-08-15T03:30:00.000Z" })),
    sendDevinMessage: vi.fn(async ({ roomId, runId }) => ({ id: runId, roomId, actionBriefId: "brief_demo", state: "not_configured" as const, providerHealth: "unknown" as const, consecutiveFailures: 0, updatedAt: "2026-08-15T03:30:00.000Z" })),
    fetchDevinEvents: vi.fn(async () => []),
    ...overrides,
  };
}

describe("RelayWebApp", () => {
  it("renders a validated static RelayPackageV1 fixture before any adapter is supplied", () => {
    render(<RelayWebApp storage={null} />);
    expect(relayFixturePackage.schemaVersion).toBe("relay-v1");
    expect(screen.getByRole("heading", { name: "Relay launch decision" })).toBeInTheDocument();
    expect(screen.getByText("Static demo fixture")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Handoff" }));
    expect(screen.getByText(/no Devin service is connected and no request was sent/i)).toBeInTheDocument();
  });

  it("loads a room through an injected repository port", async () => {
    const adapter = repository();
    render(<RelayWebApp repository={adapter} initialRoomId="room_static_demo" storage={null} />);
    expect(screen.getByRole("heading", { name: /Loading the approved package/i })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Relay launch decision" });
    expect(adapter.fetchRoom).toHaveBeenCalledWith("room_static_demo");
    expect(screen.queryByText("Static demo fixture")).not.toBeInTheDocument();
  });

  it("renders a production room through the B2 constellation view without replacing the Relay controller", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const adapter = repository();
    const { container } = render(<RelayWebApp repository={adapter} initialRoomId="room_static_demo" storage={null} readyView="b2" />);
    await screen.findByRole("group", { name: "Live Relay decision constellation" });
    expect(container.querySelector('[data-relay-view="b2-room"]')).toBeInTheDocument();
    expect(screen.getByText("Relay launch decision")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开旧版完整面板（回退）" }));
    expect(await screen.findByRole("heading", { name: "Relay launch decision" })).toBeInTheDocument();
    expect(container.querySelector('[data-relay-view="b2-room"]')).not.toBeInTheDocument();
    getContext.mockRestore();
  });

  it("gives a fragment invite precedence over the room fetch, then loads the matching room", async () => {
    const adapter = repository();
    const onInviteRedeemed = vi.fn();
    render(<RelayWebApp repository={adapter} initialRoomId="room_static_demo" initialInviteToken="invite_demo" storage={null} onInviteRedeemed={onInviteRedeemed} />);
    expect(adapter.fetchRoom).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Join room" }));
    await screen.findByRole("heading", { name: "Relay launch decision" });
    expect(adapter.joinRoom).toHaveBeenCalledWith("invite_demo", "Reviewer");
    expect(adapter.fetchRoom).toHaveBeenCalledWith("room_static_demo");
    expect(onInviteRedeemed).toHaveBeenCalledWith("room_static_demo");
  });

  it("reconciles a lost single-use invite response through RLS-visible membership", async () => {
    const bundle = createRelayFixtureBundle();
    const adapter = repository({
      joinRoom: vi.fn(async () => { throw new Error("response lost"); }),
      fetchRoom: vi.fn(async () => bundle),
    });
    const onInviteRedeemed = vi.fn();
    render(<RelayWebApp repository={adapter} initialRoomId={bundle.room.id} initialInviteToken="single_use_secret" storage={null} onInviteRedeemed={onInviteRedeemed} />);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Join room" }));
    await screen.findByRole("heading", { name: bundle.room.title });
    expect(onInviteRedeemed).toHaveBeenCalledWith(bundle.room.id);
    expect(adapter.fetchRoom).toHaveBeenCalledWith(bundle.room.id);
  });

  it("retains a failed durable mutation locally and exposes reconnect UI", async () => {
    const bundle: RoomBundle = createRelayFixtureBundle();
    const storage = memoryStorage();
    const setNodeStance = vi.fn(async () => { throw new Error("network unavailable"); });
    const adapter = repository({ fetchRoom: vi.fn(async () => bundle), setNodeStance });
    render(<RelayWebApp repository={adapter} initialRoomId={bundle.room.id} storage={storage} />);
    await screen.findByRole("heading", { name: "Relay launch decision" });
    fireEvent.click(screen.getByRole("button", { name: "Request more evidence" }));
    await screen.findByText("1 retained draft");
    expect(screen.getByText(/retained on this device/)).toBeInTheDocument();
    expect(storage.length).toBe(1);
    expect(setNodeStance).toHaveBeenCalled();
  });

  it("keeps source selection and mutation callbacks controlled in static mode", async () => {
    render(<RelayWebApp storage={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Request more evidence" }));
    await waitFor(() => expect(screen.getByText(/Static fixture updated in memory/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Request more evidence" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Relay production bootstrap", () => {
  it("parses Vercel-compatible room paths and fragment-only invite routes", () => {
    expect(parseRelayRoute({ pathname: "/room/room_123", search: "" })).toEqual({ roomId: "room_123", inviteToken: undefined });
    expect(parseRelayRoute({ pathname: "/", search: "", hash: "#invite=invite_abc" })).toEqual({ roomId: undefined, inviteToken: "invite_abc" });
    expect(parseRelayRoute({ pathname: "/", search: "?invite=query_secret" })).toEqual({ roomId: undefined, inviteToken: undefined });
    expect(parseRelayRoute({ pathname: "/", search: "?room=room_query" }).roomId).toBe("room_query");
    expect(parseRelayRoute({ pathname: "/room/room_123", search: "?invite=ignored", hash: "#invite=fragment_secret" })).toEqual({ roomId: "room_123", inviteToken: "fragment_secret" });
  });

  it("replaces a redeemed invite route with a token-free canonical room path", () => {
    const history = { state: { retained: true }, replaceState: vi.fn() };
    expect(sanitizeRedeemedInviteRoute("room/with space", history)).toBe("/room/room%2Fwith%20space");
    expect(history.replaceState).toHaveBeenCalledWith({ retained: true }, "", "/room/room%2Fwith%20space");
  });

  it("validates public production configuration without exposing a fallback", () => {
    expect(validateRelayProductionConfig({})).toMatch(/not configured/i);
    expect(validateRelayProductionConfig({ supabaseUrl: "http://example.test", supabasePublishableKey: "public-demo-key" })).toMatch(/HTTPS/i);
    expect(validateRelayProductionConfig({ supabaseUrl: "https://project.supabase.co/rest/v1", supabasePublishableKey: "public-demo-key" })).toMatch(/bare/i);
    expect(validateRelayProductionConfig({ supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-demo-key" })).toBeUndefined();
  });

  it("allows HTTP only for explicit local integration on an exact loopback host", () => {
    const config = { supabaseUrl: "http://127.0.0.1:54321", supabasePublishableKey: "public-demo-key" };
    expect(validateRelayProductionConfig(config)).toMatch(/HTTPS/i);
    expect(validateRelayProductionConfig(config, true)).toBeUndefined();
    expect(validateRelayProductionConfig({ ...config, supabaseUrl: "http://localhost:54321" }, true)).toBeUndefined();
    expect(validateRelayProductionConfig({ ...config, supabaseUrl: "http://supabase.internal:54321" }, true)).toMatch(/HTTPS/i);
  });

  it("renders a fail-closed production state when public configuration is missing", () => {
    render(<RelayProductionApp config={{}} location={{ pathname: "/room/room_123", search: "" }} storage={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not configured on this deployment/i);
    expect(screen.queryByText("Static demo fixture")).not.toBeInTheDocument();
  });

  it("starts anonymous auth only when no persisted session exists", async () => {
    const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));
    const signInAnonymously = vi.fn(async () => ({ data: { session: { access_token: "redacted" } }, error: null }));
    const client = {
      auth: { getSession, signInAnonymously },
    } as unknown as RelayAnonymousClient;
    await bootstrapRelayAnonymousClient(
      { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-demo-key" },
      () => client,
    );
    expect(getSession).toHaveBeenCalledOnce();
    expect(signInAnonymously).toHaveBeenCalledOnce();
  });
});

describe("Relay web security policy", () => {
  it("uses exact Supabase HTTPS/WSS origins and never a wildcard", () => {
    expect(relaySupabaseConnectSources("https://project.supabase.co")).toEqual(["'self'", "https://project.supabase.co", "wss://project.supabase.co"]);
    const policy = relayContentSecurityPolicy("https://project.supabase.co");
    expect(policy).toContain("connect-src 'self' https://project.supabase.co wss://project.supabase.co");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("*");
  });

  it("fails closed to self-only for malformed or non-HTTPS endpoints", () => {
    expect(relaySupabaseConnectSources("http://project.supabase.co")).toEqual(["'self'"]);
    expect(relaySupabaseConnectSources("https://project.supabase.co/path")).toEqual(["'self'"]);
    expect(relaySupabaseConnectSources()).toEqual(["'self'"]);
  });
});

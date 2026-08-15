import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayPackageV1, ShareDraft, ShareReceipt } from "@dialogue-atlas/relay-contract";

const ipcMock = vi.hoisted(() => ({
  mode: "tauri" as const,
  buildSharePreview: vi.fn(),
  finalizeSharePackage: vi.fn(),
  recordShareReceipt: vi.fn(),
  listSharePublications: vi.fn(),
  saveLayout: vi.fn(),
}));

const publisherMock = vi.hoisted(() => ({
  configured: true,
  publishRelayPackage: vi.fn(),
  createRelayInvite: vi.fn(),
}));

vi.mock("../src/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ipc")>();
  return { ...actual, atlasIpc: ipcMock };
});

vi.mock("../src/relay/relayPublisher", () => ({
  relayRuntimeConfig: () => publisherMock.configured ? {
    supabaseUrl: "https://project.supabase.co",
    publishableKey: "fixture-public-key",
    relayWebUrl: "https://relay.example",
  } : null,
  publishRelayPackage: publisherMock.publishRelayPackage,
  createRelayInvite: publisherMock.createRelayInvite,
}));

import { RelayPublishDialog } from "../src/relay/RelayPublishDialog";
import { useAtlasStore } from "../src/store";

function RelayPublishHost() {
  return useAtlasStore((state) => state.showShare) ? <RelayPublishDialog /> : null;
}

const draft: ShareDraft = {
  draftId: "draft_public_example",
  snapshotId: "snapshot-local",
  title: "Relay 产品决策",
  expiresAt: "2026-08-15T12:00:00.000Z",
  warnings: [],
  nodes: [
    {
      draftItemId: "n001",
      label: "从私人对话到团队共创",
      kind: "anchor",
      speaker: "user",
      primary: true,
      selectedByDefault: true,
      evidence: [{
        draftEvidenceId: "e001",
        excerpt: "把个人对话转成可以协作的图谱",
        speaker: "user",
        ownerKind: "node",
        ownerLabel: "从私人对话到团队共创",
        selectedByDefault: false,
      }],
    },
    {
      draftItemId: "n002",
      label: "操作性进度",
      kind: "note",
      speaker: "assistant",
      primary: false,
      selectedByDefault: false,
      evidence: [],
    },
  ],
};

const pkg: RelayPackageV1 = {
  schemaVersion: "relay-v1",
  packageId: "pkg_publicexample",
  clientPublishId: "publish_publicexample",
  title: draft.title,
  publishedAt: "2026-08-15T11:00:00.000Z",
  graph: {
    nodes: [{ id: "n001", origin: "source", label: draft.nodes[0].label, kind: "anchor", speaker: "user", acts: [], modeIds: [], evidenceIds: ["e001"], importance: 1, primary: true }],
    edges: [],
    modes: [],
    layout: { n001: { x: 0, y: 0 } },
  },
  evidence: { e001: { excerpt: draft.nodes[0].evidence[0].excerpt, speaker: "user" } },
};

const receipt: ShareReceipt = {
  publicationId: "publication_publicexample",
  snapshotId: "snapshot-local",
  packageId: pkg.packageId,
  clientPublishId: pkg.clientPublishId,
  roomId: "room-public-example",
  atlasVersionId: "version-public-example",
  packageSha256: "1".repeat(64),
  relayUrl: "https://relay.example/room/room-public-example",
  publishedAt: pkg.publishedAt,
};

const inviteUrl = `${receipt.relayUrl}#invite=public-invite`;

beforeEach(() => {
  vi.clearAllMocks();
  publisherMock.configured = true;
  ipcMock.buildSharePreview.mockResolvedValue(structuredClone(draft));
  ipcMock.listSharePublications.mockResolvedValue([]);
  ipcMock.finalizeSharePackage.mockResolvedValue(structuredClone(pkg));
  publisherMock.publishRelayPackage.mockResolvedValue({
    receipt: structuredClone(receipt),
    inviteUrl,
  });
  publisherMock.createRelayInvite.mockResolvedValue(`${receipt.relayUrl}#invite=fresh-invite`);
  ipcMock.recordShareReceipt.mockResolvedValue(structuredClone(receipt));
  useAtlasStore.setState((state) => ({
    ...state,
    snapshot: { ...state.snapshot, id: "snapshot-local" },
    showShare: true,
    primaryView: "atlas",
    activeRelayRoomId: null,
    activeRelayUrl: null,
    toast: null,
  }));
});

afterEach(() => cleanup());

describe("Relay publication approval", () => {
  it("publishes only explicitly selected nodes and evidence, then opens the owner room", async () => {
    render(<RelayPublishDialog />);
    await screen.findByText("从私人对话到团队共创");

    const evidence = screen.getByRole("checkbox", { name: /节点证据 · 从私人对话到团队共创/ });
    expect(evidence).not.toBeChecked();
    fireEvent.click(evidence);
    fireEvent.click(screen.getByRole("button", { name: "批准并发布" }));

    await waitFor(() => expect(ipcMock.finalizeSharePackage).toHaveBeenCalledWith(
      "draft_public_example",
      {
        nodeDraftIds: ["n001"],
        evidenceDraftIds: ["e001"],
        title: "Relay 产品决策",
      },
    ));
    expect(publisherMock.publishRelayPackage).toHaveBeenCalledWith("snapshot-local", pkg, undefined);
    expect(ipcMock.recordShareReceipt).toHaveBeenCalledWith(receipt);
    expect(useAtlasStore.getState()).toMatchObject({
      primaryView: "relay",
      activeRelayRoomId: "room-public-example",
      activeRelayUrl: inviteUrl,
      showShare: false,
    });
  });

  it("can publish a new immutable atlas version into the currently managed room", async () => {
    const existing = { ...structuredClone(receipt), roomId: "room-existing", relayUrl: "https://relay.example/room/room-existing" };
    ipcMock.listSharePublications.mockResolvedValue([existing]);
    useAtlasStore.setState({ activeRelayRoomId: existing.roomId, activeRelayUrl: existing.relayUrl });
    render(<RelayPublishDialog />);
    await screen.findByText("从私人对话到团队共创");

    fireEvent.click(screen.getByRole("radio", { name: /发布为当前图谱的既有房间新版本/ }));
    fireEvent.click(screen.getByRole("button", { name: "批准并发布" }));

    await waitFor(() => expect(publisherMock.publishRelayPackage).toHaveBeenCalledWith(
      "snapshot-local",
      pkg,
      existing.roomId,
    ));
  });

  it("never offers a globally active room from another snapshot as a version target", async () => {
    useAtlasStore.setState({ activeRelayRoomId: "room-other-snapshot", activeRelayUrl: "https://relay.example/room/room-other-snapshot" });
    render(<RelayPublishDialog />);
    await screen.findByText("从私人对话到团队共创");

    expect(screen.queryByRole("radio", { name: /既有房间新版本/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "批准并发布" }));

    await waitFor(() => expect(publisherMock.publishRelayPackage).toHaveBeenCalledWith("snapshot-local", pkg, undefined));
  });

  it("can close a slow publication while the idempotent network task finishes in the background", async () => {
    let resolvePublish!: (value: { receipt: ShareReceipt; inviteUrl: string }) => void;
    publisherMock.publishRelayPackage.mockReturnValue(new Promise((resolve) => {
      resolvePublish = resolve;
    }));
    render(<RelayPublishHost />);
    await screen.findByText("从私人对话到团队共创");

    fireEvent.click(screen.getByRole("button", { name: "批准并发布" }));
    const close = await screen.findByRole("button", { name: "关闭（后台发布）" });
    expect(close).toBeEnabled();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    resolvePublish({ receipt: structuredClone(receipt), inviteUrl });
    await waitFor(() => expect(ipcMock.recordShareReceipt).toHaveBeenCalledWith(receipt));
    expect(useAtlasStore.getState()).toMatchObject({
      primaryView: "atlas",
      activeRelayRoomId: null,
      toast: expect.stringContaining("后台发布完成"),
    });
  });

  it("reopens a locally recorded owner room after an app restart", async () => {
    ipcMock.listSharePublications.mockResolvedValue([structuredClone(receipt)]);
    render(<RelayPublishDialog />);
    await screen.findByText("过去发布 1 次");

    fireEvent.click(screen.getByRole("button", { name: "打开房间" }));

    expect(useAtlasStore.getState()).toMatchObject({
      primaryView: "relay",
      activeRelayRoomId: receipt.roomId,
      activeRelayUrl: receipt.relayUrl,
      showShare: false,
    });
  });

  it("never persists an invite bearer and mints a fresh invitation from history", async () => {
    ipcMock.listSharePublications.mockResolvedValue([structuredClone(receipt)]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<RelayPublishDialog />);
    await screen.findByText("过去发布 1 次");

    fireEvent.click(screen.getByRole("button", { name: "创建新邀请" }));

    await waitFor(() => expect(publisherMock.createRelayInvite).toHaveBeenCalledWith(receipt.roomId));
    expect(writeText).toHaveBeenCalledWith(`${receipt.relayUrl}#invite=fresh-invite`);
    expect(receipt.relayUrl).not.toContain("#invite=");
  });

  it("keeps local review available but blocks cloud publication when Relay is not configured", async () => {
    publisherMock.configured = false;
    render(<RelayPublishDialog />);
    await screen.findByText("从私人对话到团队共创");

    expect(screen.getByText(/Supabase 与 Relay Web 尚未配置/)).toBeVisible();
    expect(screen.getByRole("button", { name: "批准并发布" })).toBeDisabled();
    expect(ipcMock.finalizeSharePackage).not.toHaveBeenCalled();
  });
});

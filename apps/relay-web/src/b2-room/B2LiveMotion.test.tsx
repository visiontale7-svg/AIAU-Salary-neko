import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayReadyRoomModel } from "@dialogue-atlas/relay-room";
import { createRelayFixtureBundle, createRelayFixturePresence } from "../fixture";
import { B2RoomView } from "./B2RoomView";

vi.mock("../b2-visual/B2StarfieldCanvas", () => ({
  B2StarfieldCanvas: () => <canvas data-testid="local-starfield" />,
}));

function model(overrides: Partial<RelayReadyRoomModel> = {}): RelayReadyRoomModel {
  return {
    phase: "ready",
    bundle: createRelayFixtureBundle(),
    connection: "live",
    presence: createRelayFixturePresence(),
    selection: { kind: "node", id: "n005" },
    offline: { drafts: [] },
    devinEvents: {},
    ...overrides,
  };
}

function withNewTeamNode(base: RelayReadyRoomModel): RelayReadyRoomModel {
  return {
    ...base,
    bundle: {
      ...base.bundle,
      teamItems: [
        ...base.bundle.teamItems,
        {
          itemType: "node" as const,
          id: "team_node_live",
          roomId: base.bundle.room.id,
          label: "New durable team insight",
          kind: "claim" as const,
          modeIds: ["m003"],
          revision: 1,
          createdBy: "member_reviewer_demo",
        },
        {
          itemType: "edge" as const,
          id: "team_edge_live",
          roomId: base.bundle.room.id,
          source: "n004",
          target: "team_node_live",
          type: "extends",
          label: "extends",
          revision: 1,
          createdBy: "member_reviewer_demo",
        },
      ],
      lastActivitySeq: 22,
    },
    confirmedLiveActivity: [{ seq: 22, type: "team_graph_item_upserted", targetId: "team_node_live" }],
  };
}

function mockMotionPreference(reduced: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: reduced,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function withRemoteSelection(base: RelayReadyRoomModel, nodeId: string): RelayReadyRoomModel {
  return {
    ...base,
    presence: base.presence.map((member) => member.userId === "member_reviewer_demo"
      ? { ...member, activeNodeId: nodeId, onlineAt: `${member.onlineAt}:${nodeId}` }
      : member),
  };
}

function graphRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: 1096,
    bottom: 860,
    left: 0,
    width: 1096,
    height: 860,
    toJSON: () => ({}),
  };
}

describe("B2 live semantic motion binding", () => {
  let requestFrame: ReturnType<typeof vi.spyOn>;
  let cancelFrame: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockMotionPreference(false);
    requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 17);
    cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });

  afterEach(() => {
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("keeps idle static, uses the exact eight passes, and deduplicates the same selection", async () => {
    const { container } = render(<B2RoomView model={model()} />);
    expect(container.querySelector("main")).toHaveAttribute("data-motion-sequence", "idle");
    expect(requestFrame).not.toHaveBeenCalled();

    const camera = screen.getByTestId("b2-camera-layer");
    expect([...camera.querySelectorAll(":scope > [data-b2-live-pass]")].map((element) => element.getAttribute("data-b2-live-pass"))).toEqual([
      "path-atmosphere",
      "star-aura",
      "path-core",
      "motion-path-overlay",
      "path-particles",
      "star-body",
      "motion-star-overlay",
      "star-overlay",
    ]);

    const target = screen.getByRole("button", { name: /来源节点：How can personal AI work/ });
    fireEvent.click(target);
    await waitFor(() => expect(container.querySelector("main")).toHaveAttribute("data-motion-sequence", "selected-focus"));
    const eventKey = container.querySelector("main")?.getAttribute("data-motion-event-key");
    fireEvent.click(target);
    expect(container.querySelector("main")?.getAttribute("data-motion-event-key")).toBe(eventKey);
    expect(requestFrame).toHaveBeenCalledTimes(1);
  });

  it("animates only a newly confirmed live team node with one packet and twelve fixed particles", async () => {
    const initial = model();
    const { container, rerender } = render(<B2RoomView model={initial} />);
    rerender(<B2RoomView model={withNewTeamNode(initial)} />);

    await waitFor(() => expect(container.querySelector("main")).toHaveAttribute("data-motion-sequence", "node-appearing"));
    expect(container.querySelectorAll("[data-motion-packet]").length).toBeLessThanOrEqual(1);
    expect(container.querySelector("[data-motion-particle-count]")).toHaveAttribute("data-motion-particle-count", "12");
    expect(container.querySelectorAll("[data-motion-particle]")).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /团队节点：New durable team insight/ })).not.toBeInTheDocument();
  });

  it("plays a changed remote Presence selection once, but not its initial or reconnect snapshot", async () => {
    const scheduledFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    let timestamp = 0;
    requestFrame.mockImplementation((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      scheduledFrames.set(id, callback);
      return id;
    });
    cancelFrame.mockImplementation((id: number) => {
      scheduledFrames.delete(id);
    });
    const finishAnimation = async (container: HTMLElement) => {
      for (let index = 0; index < 12 && scheduledFrames.size > 0; index += 1) {
        const [id, callback] = scheduledFrames.entries().next().value!;
        scheduledFrames.delete(id);
        timestamp += 100;
        act(() => callback(timestamp));
      }
      await waitFor(() => expect(container.querySelector("main")).toHaveAttribute("data-motion-sequence", "idle"));
    };

    const initial = model();
    const { container, rerender, unmount } = render(<B2RoomView model={initial} />);
    expect(container.querySelector("main")).toHaveAttribute("data-motion-sequence", "idle");

    const remoteN1 = withRemoteSelection(initial, "n001");
    rerender(<B2RoomView model={remoteN1} />);
    await waitFor(() => expect(container.querySelector("main")).toHaveAttribute(
      "data-motion-event-key",
      "presence-selection:member_reviewer_demo:n001",
    ));
    const firstRequestCount = requestFrame.mock.calls.length;
    rerender(<B2RoomView model={{ ...remoteN1, presence: remoteN1.presence.map((member) => ({ ...member })) }} />);
    expect(container.querySelector("main")).toHaveAttribute(
      "data-motion-event-key",
      "presence-selection:member_reviewer_demo:n001",
    );
    expect(requestFrame).toHaveBeenCalledTimes(firstRequestCount);
    await finishAnimation(container);

    const remoteN2 = withRemoteSelection(remoteN1, "n002");
    rerender(<B2RoomView model={remoteN2} />);
    await waitFor(() => expect(container.querySelector("main")).toHaveAttribute(
      "data-motion-event-key",
      "presence-selection:member_reviewer_demo:n002",
    ));
    await finishAnimation(container);

    const frameRequestsBeforeRepeat = requestFrame.mock.calls.length;
    rerender(<B2RoomView model={withRemoteSelection(remoteN2, "n001")} />);
    await act(async () => Promise.resolve());
    expect(container.querySelector("main")).toHaveAttribute("data-motion-sequence", "idle");
    expect(requestFrame).toHaveBeenCalledTimes(frameRequestsBeforeRepeat);
    unmount();

    requestFrame.mockClear();
    scheduledFrames.clear();
    const reconnectSnapshot = withRemoteSelection(initial, "n002");
    const reconnected = render(<B2RoomView model={{ ...reconnectSnapshot, connection: "reconnecting" }} />);
    reconnected.rerender(<B2RoomView model={reconnectSnapshot} />);
    await act(async () => Promise.resolve());
    expect(reconnected.container.querySelector("main")).toHaveAttribute("data-motion-sequence", "idle");
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("keeps the selected-focus overlay attached to the dragged preview coordinate", async () => {
    const { container } = render(<B2RoomView model={model()} />);
    const graph = screen.getByRole("group", { name: "Live Relay decision constellation" });
    vi.spyOn(graph, "getBoundingClientRect").mockReturnValue(graphRect());
    const target = screen.getByRole("button", { name: /来源节点：How can personal AI work/ });

    fireEvent.pointerDown(target, { pointerId: 9, button: 0, clientX: 100, clientY: 120 });
    fireEvent.pointerMove(target, { pointerId: 9, button: 0, clientX: 180, clientY: 165 });
    await waitFor(() => expect(container.querySelector("main")).toHaveAttribute("data-motion-sequence", "selected-focus"));
    const focusCore = container.querySelector(".b2-live-motion__focus-core");
    expect(focusCore).toHaveAttribute("cx", "180");
    expect(focusCore).toHaveAttribute("cy", "165");
    fireEvent.pointerUp(target, { pointerId: 9, button: 0, clientX: 180, clientY: 165 });
  });

  it("does not replay an already-confirmed event on remount or reconnect", async () => {
    const historical = withNewTeamNode(model());
    const first = render(<B2RoomView model={historical} />);
    expect(first.container.querySelector("main")).toHaveAttribute("data-motion-sequence", "idle");
    expect(screen.getByRole("button", { name: /团队节点：New durable team insight/ })).toBeInTheDocument();
    first.unmount();

    const { container, rerender } = render(<B2RoomView model={{ ...historical, connection: "reconnecting" }} />);
    rerender(<B2RoomView model={historical} />);
    await act(async () => Promise.resolve());
    expect(container.querySelector("main")).toHaveAttribute("data-motion-sequence", "idle");
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("resolves reduced motion directly to the final static state without requesting a frame", async () => {
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
    mockMotionPreference(true);
    requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 17);
    cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const initial = model();
    const { container, rerender } = render(<B2RoomView model={initial} />);
    rerender(<B2RoomView model={withNewTeamNode(initial)} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /团队节点：New durable team insight/ })).toBeInTheDocument());
    expect(container.querySelector("main")).toHaveAttribute("data-motion-reduced", "true");
    expect(container.querySelector("main")).toHaveAttribute("data-motion-sequence", "idle");
    expect(container.querySelector('[data-motion-new-badge="team_node_live"]')).toBeInTheDocument();
    expect(screen.getByText("新增")).toBeInTheDocument();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("holds an explicit provider stale marker and clears it on a durable recovery without replaying motion", async () => {
    const initial = model();
    const stale = {
      ...initial,
      bundle: {
        ...initial.bundle,
        lastActivitySeq: 24,
        devinRuns: initial.bundle.devinRuns.map((run) => ({ ...run, providerHealth: "stale" as const })),
      },
      confirmedLiveActivity: [{ seq: 24, type: "devin_provider_health_stale", targetId: "devin_demo" }],
    } satisfies RelayReadyRoomModel;
    const recovered = {
      ...stale,
      bundle: {
        ...stale.bundle,
        lastActivitySeq: 25,
        devinRuns: stale.bundle.devinRuns.map((run) => ({ ...run, providerHealth: "healthy" as const })),
      },
      confirmedLiveActivity: [{ seq: 25, type: "devin_provider_health_recovered", targetId: "devin_demo" }],
    } satisfies RelayReadyRoomModel;

    const { container, rerender } = render(<B2RoomView model={initial} />);
    rerender(<B2RoomView model={stale} />);
    await waitFor(() => expect(container.querySelector('[data-motion-stale-target="n005"]')).toBeInTheDocument());
    rerender(<B2RoomView model={recovered} />);
    await waitFor(() => expect(container.querySelector('[data-motion-stale-target="n005"]')).not.toBeInTheDocument());
    expect(container.querySelector("main")).toHaveAttribute("data-motion-sequence", "idle");
    expect(container.querySelector("main")).not.toHaveAttribute("data-motion-event-key");
    expect(cancelFrame).toHaveBeenCalled();
  });
});

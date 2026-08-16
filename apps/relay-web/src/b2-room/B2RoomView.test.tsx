import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RelayReadyRoomModel } from "@dialogue-atlas/relay-room";
import { createRelayFixtureBundle, createRelayFixturePresence } from "../fixture";
import { B2RoomView } from "./B2RoomView";
import { buildB2RoomProjection } from "./b2-room-model";

vi.mock("../b2-visual/B2StarfieldCanvas", () => ({
  B2StarfieldCanvas: () => <canvas data-testid="local-starfield" />,
}));

function readyModel(overrides: Partial<RelayReadyRoomModel> = {}): RelayReadyRoomModel {
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

describe("B2 live Relay projection", () => {
  it("projects effective source and team graph into deterministic star families", () => {
    const projection = buildB2RoomProjection(readyModel());
    expect(projection.stars).toHaveLength(7);
    expect(projection.paths).toHaveLength(6);
    expect(projection.stars[0]?.optics.family).toBe("root");
    expect(projection.stars.filter((star) => star.node.origin === "team")).toHaveLength(1);
    expect(projection.stars.find((star) => star.node.id === "n005")?.presence.map((member) => member.displayName)).toContain("Mina");
    const repeated = buildB2RoomProjection(readyModel());
    expect(repeated.stars).toEqual(projection.stars);
    expect(repeated.paths).toEqual(projection.paths);
  });
});

describe("B2RoomView", () => {
  it("renders real room data and routes selection and stance through Relay callbacks", () => {
    const onSelectionChange = vi.fn();
    const onSetStance = vi.fn();
    render(<B2RoomView model={readyModel()} callbacks={{ onSelectionChange, onSetStance }} />);

    expect(screen.getByRole("heading", { name: "Dialogue Atlas" })).toBeInTheDocument();
    expect(screen.getByText("Relay launch decision")).toBeInTheDocument();
    expect(screen.getByLabelText("Members online")).toHaveTextContent("2 人在线");
    expect(screen.getByTestId("local-starfield")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /来源节点：How can personal AI work/ }));
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "node", id: "n001" });

    fireEvent.click(screen.getByRole("button", { name: "需要证据" }));
    expect(onSetStance).toHaveBeenCalledWith("n005", "needs_evidence");
  });

  it("keeps the complete structured collaboration surface reachable", () => {
    const onOpenStructuredView = vi.fn();
    render(<B2RoomView model={readyModel()} onOpenStructuredView={onOpenStructuredView} />);
    fireEvent.click(screen.getByRole("button", { name: "打开旧版完整面板（回退）" }));
    expect(onOpenStructuredView).toHaveBeenCalledOnce();
  });

  it("broadcasts a drag preview and persists only on pointer release", () => {
    const onPreviewNodePosition = vi.fn();
    const onSaveNodePosition = vi.fn();
    render(<B2RoomView model={readyModel()} callbacks={{ onPreviewNodePosition, onSaveNodePosition }} />);
    const node = screen.getByRole("button", { name: /来源节点：How can personal AI work/ });
    fireEvent.pointerDown(node, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(node, { pointerId: 1, clientX: 140, clientY: 120 });
    expect(onPreviewNodePosition).toHaveBeenCalledOnce();
    expect(onSaveNodePosition).not.toHaveBeenCalled();
    fireEvent.pointerUp(node, { pointerId: 1, clientX: 140, clientY: 120 });
    expect(onSaveNodePosition).toHaveBeenCalledOnce();
  });
});

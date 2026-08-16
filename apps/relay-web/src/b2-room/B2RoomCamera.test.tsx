import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RelayReadyRoomModel } from "@dialogue-atlas/relay-room";
import { createRelayFixtureBundle, createRelayFixturePresence } from "../fixture";
import {
  B2RoomView,
  fitB2Camera,
  screenPointToGraphPoint,
  zoomB2CameraAt,
} from "./B2RoomView";
import { buildB2RoomProjection } from "./b2-room-model";

vi.mock("../b2-visual/B2StarfieldCanvas", () => ({
  B2StarfieldCanvas: () => <canvas data-testid="local-starfield" />,
}));

function readyModel(): RelayReadyRoomModel {
  return {
    phase: "ready",
    bundle: createRelayFixtureBundle(),
    connection: "live",
    presence: createRelayFixturePresence(),
    selection: { kind: "node", id: "n005" },
    offline: { drafts: [] },
    devinEvents: {},
  };
}

function rect(width = 1096, height = 860): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    width,
    height,
    toJSON: () => ({}),
  };
}

describe("B2 live room camera math", () => {
  it("inverts screen coordinates through pan and zoom", () => {
    expect(screenPointToGraphPoint(
      { x: 260, y: 190 },
      { x: -100, y: 50, zoom: 2 },
    )).toEqual({ x: 180, y: 70 });
  });

  it("keeps the zoom focus anchored and fits bounded content", () => {
    const bounds = { minX: 100, minY: 140, maxX: 930, maxY: 740 };
    const focus = { x: 548, y: 430 };
    const zoomed = zoomB2CameraAt({ x: 0, y: 0, zoom: 1 }, 1.5, focus, bounds);
    const before = screenPointToGraphPoint(focus, { x: 0, y: 0, zoom: 1 });
    const after = screenPointToGraphPoint(focus, zoomed);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);

    const fitted = fitB2Camera(bounds);
    const visibleLeft = -fitted.x / fitted.zoom;
    const visibleTop = -fitted.y / fitted.zoom;
    expect(visibleLeft).toBeLessThan(bounds.minX);
    expect(visibleTop).toBeLessThan(bounds.minY);
    expect(visibleLeft + 1096 / fitted.zoom).toBeGreaterThan(bounds.maxX);
    expect(visibleTop + 860 / fitted.zoom).toBeGreaterThan(bounds.maxY);
  });
});

describe("B2 live room camera UI", () => {
  it("updates only the local camera through controls and MiniMap", () => {
    const onSaveNodePosition = vi.fn();
    const onPreviewNodePosition = vi.fn();
    render(<B2RoomView
      model={readyModel()}
      callbacks={{ onSaveNodePosition, onPreviewNodePosition }}
    />);

    const graph = screen.getByRole("group", { name: "Live Relay decision constellation" });
    const layer = screen.getByTestId("b2-camera-layer");
    expect(layer).toHaveAttribute("transform", "translate(0 0) scale(1)");

    fireEvent.click(screen.getByRole("button", { name: "放大星图" }));
    expect(graph).toHaveAttribute("data-camera-zoom", "1.200");
    expect(layer.getAttribute("transform")).toContain("scale(1.2)");

    fireEvent.click(screen.getByRole("button", { name: "适配全部节点" }));
    expect(Number(graph.getAttribute("data-camera-zoom"))).toBeGreaterThan(.55);

    const minimap = screen.getByRole("application", { name: /全局小地图/ });
    vi.spyOn(minimap, "getBoundingClientRect").mockReturnValue(rect());
    const before = layer.getAttribute("transform");
    fireEvent.pointerDown(minimap, { pointerId: 3, button: 0, clientX: 900, clientY: 650 });
    fireEvent.pointerUp(minimap, { pointerId: 3, button: 0, clientX: 900, clientY: 650 });
    expect(layer.getAttribute("transform")).not.toBe(before);
    expect(onSaveNodePosition).not.toHaveBeenCalled();
    expect(onPreviewNodePosition).not.toHaveBeenCalled();
  });

  it("uses inverse camera coordinates before broadcasting and saving a node drag", () => {
    const model = readyModel();
    const projection = buildB2RoomProjection(model);
    const star = projection.stars.find((entry) => entry.node.id === "n001")!;
    const onSaveNodePosition = vi.fn();
    const onPreviewNodePosition = vi.fn();
    render(<B2RoomView model={model} callbacks={{ onSaveNodePosition, onPreviewNodePosition }} />);

    const graph = screen.getByRole("group", { name: "Live Relay decision constellation" });
    vi.spyOn(graph, "getBoundingClientRect").mockReturnValue(rect());
    fireEvent.click(screen.getByRole("button", { name: "放大星图" }));
    const zoom = Number(graph.getAttribute("data-camera-zoom"));
    const cameraX = Number(graph.getAttribute("data-camera-x"));
    const cameraY = Number(graph.getAttribute("data-camera-y"));
    const node = screen.getByRole("button", { name: /来源节点：How can personal AI work/ });
    const start = {
      x: star.x * zoom + cameraX,
      y: star.y * zoom + cameraY,
    };
    const destination = { x: star.x + 100, y: star.y + 50 };
    const end = {
      x: destination.x * zoom + cameraX,
      y: destination.y * zoom + cameraY,
    };

    fireEvent.pointerDown(node, { pointerId: 7, button: 0, clientX: start.x, clientY: start.y });
    fireEvent.pointerMove(node, { pointerId: 7, button: 0, clientX: end.x, clientY: end.y });
    const expectedRoomPoint = projection.toRoomPoint(destination);
    expect(onPreviewNodePosition).toHaveBeenCalledWith("n001", expectedRoomPoint);
    fireEvent.pointerUp(node, { pointerId: 7, button: 0, clientX: end.x, clientY: end.y });
    expect(onSaveNodePosition).toHaveBeenCalledWith("n001", expectedRoomPoint);
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { B2VisualDemo } from "./B2VisualDemo";

const { decodeHaloAssetsMock } = vi.hoisted(() => ({
  decodeHaloAssetsMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("./halo-assets", async () => {
  const actual = await vi.importActual<typeof import("./halo-assets")>("./halo-assets");
  return { ...actual, decodeHaloAssets: decodeHaloAssetsMock };
});

function createDeterministicCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined } as CanvasGradient;
  const noop = () => undefined;

  return {
    canvas,
    arc: noop,
    beginPath: noop,
    clearRect: noop,
    closePath: noop,
    createRadialGradient: () => gradient,
    drawImage: noop,
    fill: noop,
    fillRect: noop,
    lineTo: noop,
    moveTo: noop,
    restore: noop,
    save: noop,
    setTransform: noop,
    stroke: noop,
    translate: noop,
  } as unknown as CanvasRenderingContext2D;
}

describe("B2VisualDemo", () => {
  beforeEach(() => {
    decodeHaloAssetsMock.mockReset();
    decodeHaloAssetsMock.mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext(this: HTMLCanvasElement) {
      return createDeterministicCanvasContext(this);
    } as unknown as HTMLCanvasElement["getContext"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the deterministic no-network constellation shell", () => {
    const { container } = render(<B2VisualDemo />);
    expect(screen.getByRole("heading", { name: "Dialogue Atlas" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "B2 shared constellation visual fixture" })).toBeInTheDocument();
    expect(screen.getByLabelText("Dialogue Atlas navigation")).toBeInTheDocument();
    expect(screen.getByLabelText("图例")).toBeInTheDocument();
    expect(screen.getByLabelText("全局小地图")).toBeInTheDocument();
    expect(screen.getByLabelText("协作工作台")).toBeInTheDocument();
    expect(screen.getByLabelText("LLM 房间共享对话")).toBeInTheDocument();
    expect(screen.getByLabelText("Devin 运行状态")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "对话" })).toHaveAttribute("aria-selected", "true");
    expect(container.querySelector('[data-runtime="deterministic-visual-fixture"]')).toBeInTheDocument();
    expect(container.querySelector('canvas[data-b2-starfield="true"]')).toHaveAttribute("data-animation-state", "static");
    expect(decodeHaloAssetsMock).toHaveBeenCalledTimes(1);
  });

  it("composes the approved full-graph optics in global pass order", () => {
    const { container } = render(<B2VisualDemo />);
    const passes = Array.from(container.querySelectorAll(".b2-graph__zoom > [data-b2-pass]"), (element) => element.getAttribute("data-b2-pass"));

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
    expect(container.querySelectorAll('[data-b2-pass="star-aura"] image')).toHaveLength(19);
    expect(container.querySelectorAll('[data-b2-pass="star-body"] [data-star-body-family]')).toHaveLength(20);
    expect(container.querySelectorAll('[data-b2-pass="star-body"] [data-star-energy="2"]')).toHaveLength(19);
    expect(container.querySelector('[data-star-body-family="devin"] rect')).not.toBeNull();
    expect(container.querySelector(".b2-star__halo, .b2-star__ring, .b2-star__core, .b2-star__hot-core")).toBeNull();
    expect(container.querySelector(".b2-minimap image")).toBeNull();
  });

  it("blocks visual readiness when a halo asset cannot decode", async () => {
    decodeHaloAssetsMock.mockRejectedValue(new Error("source-blue-v0 failed to decode"));
    const { container } = render(<B2VisualDemo />);

    await waitFor(() => {
      expect(container.querySelector(".b2-visual")).toHaveAttribute("data-b2-optics-error", "halo-assets-failed");
    });
    expect(container.querySelector(".b2-visual")).toHaveAttribute("data-b2-ready", "false");
  });

  it("moves node and execution detail into the fixed workbench", () => {
    render(<B2VisualDemo />);
    fireEvent.click(screen.getByRole("button", { name: "3.2 数据与隐私" }));
    expect(screen.getByRole("tab", { name: "节点" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("节点详情")).toHaveTextContent("3.2 数据与隐私");
    fireEvent.click(screen.getByRole("tab", { name: "执行" }));
    expect(screen.getByRole("tab", { name: "执行" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("执行详情")).toHaveTextContent("分析法规差异");
    fireEvent.click(screen.getByRole("tab", { name: "对话" }));
    expect(screen.getByLabelText("LLM 房间共享对话")).toBeInTheDocument();
  });

  it("keeps keyboard selection on the transparent interaction overlay", () => {
    const { container } = render(<B2VisualDemo />);
    fireEvent.keyDown(screen.getByRole("button", { name: "4 · 机会与风险" }), { key: "Enter" });
    expect(screen.getByRole("tab", { name: "节点" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("节点详情")).toHaveTextContent("4 · 机会与风险");
    expect(container.querySelector(".b2-star-body--risk")).toHaveAttribute("data-star-state", "selected");
  });

  it("keeps idle fully static and only replays a genuinely changed selection", () => {
    const requestFrame = vi.fn(() => 17);
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const { container } = render(<B2VisualDemo search="?demo=b2&motion=full" />);
    const root = container.querySelector(".b2-visual")!;

    expect(root).toHaveAttribute("data-motion-playback", "idle");
    expect(requestFrame).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "1 · 用户价值" }));
    const firstKey = root.getAttribute("data-motion-event-key");
    expect(firstKey).toMatch(/^selection:1:value$/);
    expect(requestFrame).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "1 · 用户价值" }));
    expect(root).toHaveAttribute("data-motion-event-key", firstKey);
    expect(requestFrame).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "2 · 核心体验" }));
    fireEvent.click(screen.getByRole("button", { name: "1 · 用户价值" }));
    expect(root).toHaveAttribute("data-motion-event-key", "selection:3:value");
    expect(container.querySelector('[data-motion-selection-departing="experience"]')).not.toBeNull();
  });

  it("exposes deterministic fixed full-demo frames with one packet and twelve condensation particles", () => {
    const requestFrame = vi.fn(() => 19);
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container } = render(
      <B2VisualDemo search="?demo=b2&motionDemo=1&motionTime=1000&motion=full" />,
    );
    const root = container.querySelector(".b2-visual")!;

    expect(root).toHaveAttribute("data-motion-demo", "true");
    expect(root).toHaveAttribute("data-motion-time-ms", "1000");
    expect(root).toHaveAttribute("data-motion-phase", "candidate");
    expect(root).toHaveAttribute("data-motion-playback", "paused");
    expect(root).toHaveAttribute("data-motion-reduced", "false");
    expect(root).toHaveAttribute("data-motion-event-key", "b2-demo:candidate-appearing:1");
    expect(container.querySelectorAll("[data-motion-particle]")).toHaveLength(12);
    expect(container.querySelectorAll("[data-motion-path-packet]").length).toBeLessThanOrEqual(1);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("maps the locked 5300ms script to Devin event and stale frames", () => {
    const { container, rerender } = render(
      <B2VisualDemo search="?demo=b2&motionDemo=1&motionTime=2700&motion=full" />,
    );
    let root = container.querySelector(".b2-visual")!;
    expect(root).toHaveAttribute("data-motion-phase", "devin-event");
    expect(root).toHaveAttribute("data-motion-event-key", "b2-demo:devin-event:2");
    expect(container.querySelectorAll('[data-motion-path-packet="devin-event"]')).toHaveLength(1);
    expect(root).toHaveAttribute("data-motion-played-events", "b2-demo:candidate-appearing:1");

    rerender(<B2VisualDemo search="?demo=b2&motionDemo=1&motionTime=4500&motion=full" />);
    root = container.querySelector(".b2-visual")!;
    expect(root).toHaveAttribute("data-motion-phase", "devin-stale");
    expect(root).toHaveAttribute("data-motion-event-key", "b2-demo:devin-stale:3");
    expect(container.querySelector('[data-motion-stale-ring="privacy"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-motion-path-packet]")).toHaveLength(0);
  });

  it("uses a final static semantic frame for reduced motion without starting a frame loop", () => {
    const requestFrame = vi.fn(() => 23);
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container } = render(
      <B2VisualDemo search="?demo=b2&motionDemo=1&motionTime=1000&motion=reduced" />,
    );
    const root = container.querySelector(".b2-visual")!;

    expect(root).toHaveAttribute("data-motion-time-ms", "5300");
    expect(root).toHaveAttribute("data-motion-phase", "finished");
    expect(root).toHaveAttribute("data-motion-playback", "finished");
    expect(root).toHaveAttribute("data-motion-reduced", "true");
    expect(root).toHaveAttribute(
      "data-motion-played-events",
      "b2-demo:candidate-appearing:1,b2-demo:devin-event:2,b2-demo:devin-stale:3",
    );
    expect(container.querySelector('[data-motion-static-new="candidate"]')).not.toBeNull();
    expect(container.querySelector('[data-motion-stale-ring="privacy"]')).not.toBeNull();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("keeps selection static while the full motion demo owns the only frame loop", () => {
    const requestFrame = vi.fn(() => 29);
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container } = render(<B2VisualDemo search="?demo=b2&motionDemo=1&motion=full" />);
    const callsBeforeSelection = requestFrame.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "4 · 机会与风险" }));

    expect(container.querySelector(".b2-star-body--risk")).toHaveAttribute("data-star-state", "selected");
    expect(container.querySelector(".b2-visual")).not.toHaveAttribute("data-motion-event-key", expect.stringContaining("selection:"));
    expect(requestFrame).toHaveBeenCalledTimes(callsBeforeSelection);
  });

  it("keeps canvas controls local and never calls a runtime adapter", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<B2VisualDemo />);
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(screen.getByLabelText("当前缩放")).toHaveTextContent("110%");
    fireEvent.click(screen.getByRole("button", { name: "缩小" }));
    expect(screen.getByLabelText("当前缩放")).toHaveTextContent("100%");
    fireEvent.click(screen.getByRole("button", { name: "3.2 数据与隐私" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

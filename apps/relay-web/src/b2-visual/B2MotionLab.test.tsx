import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { B2MotionLab, parseB2MotionLabQuery } from "./B2MotionLab";

const { decodeHaloAssetsMock } = vi.hoisted(() => ({
  decodeHaloAssetsMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("./halo-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./halo-assets")>();
  return { ...actual, decodeHaloAssets: decodeHaloAssetsMock };
});

function installMatchMedia(reduced = false) {
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
    matches: reduced,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

describe("B2MotionLab", () => {
  beforeEach(() => {
    decodeHaloAssetsMock.mockResolvedValue(undefined);
    installMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    decodeHaloAssetsMock.mockReset();
  });

  it("defaults to a fully static Idle frame without starting animation frames or network work", async () => {
    const requestFrame = vi.fn(() => 1);
    const fetchSpy = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("fetch", fetchSpy);

    const { container } = render(<B2MotionLab search="?demo=b2&motionLab=1" />);

    expect(screen.getByRole("heading", { name: "星图动效实验室" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Idle/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Devin Event/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Devin Stale/ })).toBeDisabled();

    await waitFor(() => {
      expect(container.querySelector('[data-motion-lab="true"]')).toHaveAttribute("data-b2-ready", "true");
    });
    const workbench = container.querySelector('[data-motion-sequence="idle"]');
    expect(workbench).toHaveAttribute("data-motion-time-ms", "0");
    expect(workbench).toHaveAttribute("data-motion-playback", "idle");
    expect(workbench).toHaveAttribute("data-motion-reduced", "false");
    expect(container.querySelectorAll("[data-motion-particle]")).toHaveLength(12);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the exact eight-pass order and clamps a query-selected frozen frame", async () => {
    const { container } = render(
      <B2MotionLab search="?demo=b2&motionLab=1&sequence=selected&time=9999&motion=full" />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-motion-sequence="selected-focus"]')).toHaveAttribute("data-motion-time-ms", "520");
    });

    const workbench = container.querySelector('[data-motion-sequence="selected-focus"]');
    expect(workbench).toHaveAttribute("data-motion-playback", "paused");
    expect(screen.getByText("固定帧")).toBeInTheDocument();
    const passOrder = Array.from(container.querySelectorAll(".motion-lab__stage-svg > [data-motion-pass]"), (node) => node.getAttribute("data-motion-pass"));
    expect(passOrder).toEqual([
      "path-atmosphere",
      "star-aura",
      "path-core",
      "motion-path-overlay",
      "path-particles",
      "star-body",
      "motion-star-overlay",
      "star-overlay",
    ]);
    expect(container.querySelectorAll("[data-motion-path-packet]")).toHaveLength(0);
  });

  it("uses the reduced-motion final New Node frame with a static badge and one path packet", async () => {
    const { container } = render(
      <B2MotionLab search="?demo=b2&motionLab=1&sequence=new-node&motion=reduced" />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-motion-sequence="node-appearing"]')).toHaveAttribute("data-motion-time-ms", "1450");
    });
    const workbench = container.querySelector('[data-motion-sequence="node-appearing"]');
    expect(workbench).toHaveAttribute("data-motion-playback", "finished");
    expect(workbench).toHaveAttribute("data-motion-reduced", "true");
    expect(container.querySelectorAll("[data-motion-particle]")).toHaveLength(12);
    expect(container.querySelectorAll("[data-motion-path-packet]")).toHaveLength(1);
    expect(container.querySelector('[data-motion-static-new="true"]')).toHaveTextContent("新增");
  });

  it("keeps a selected New Node sequence still until explicit replay, then exposes pause", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 7));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { container } = render(<B2MotionLab search="?demo=b2&motionLab=1&motion=full" />);

    await waitFor(() => {
      expect(container.querySelector('[data-motion-sequence="idle"]')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "新节点生成" }));
    await waitFor(() => {
      expect(container.querySelector('[data-motion-sequence="node-appearing"]')).toHaveAttribute("data-motion-playback", "idle");
    });
    fireEvent.click(screen.getByRole("button", { name: "Replay animation" }));
    await waitFor(() => {
      expect(container.querySelector('[data-motion-sequence="node-appearing"]')).toHaveAttribute("data-motion-playback", "playing");
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause animation" }));
    await waitFor(() => {
      expect(container.querySelector('[data-motion-sequence="node-appearing"]')).toHaveAttribute("data-motion-playback", "paused");
    });
  });

  it("fails closed before publishing readiness when a local halo cannot decode", async () => {
    decodeHaloAssetsMock.mockRejectedValue(new Error("source-blue-v0 decode failed"));
    const { container } = render(<B2MotionLab />);

    expect(await screen.findByRole("alert", { name: "Motion lab asset fatal error" })).toHaveTextContent("source-blue-v0 decode failed");
    expect(container.querySelector('[data-motion-lab="true"]')).not.toHaveAttribute("data-b2-ready");
    expect(container.querySelector("[data-motion-sequence]")).toBeNull();
  });
});

describe("parseB2MotionLabQuery", () => {
  it("maps public sequence names, clamps integer time, and fails invalid values to Idle", () => {
    expect(parseB2MotionLabQuery("?sequence=selected&time=-4&motion=full")).toEqual({
      sequence: "selected-focus",
      fixedTimeMs: 0,
      preference: "full",
    });
    expect(parseB2MotionLabQuery("?sequence=new-node&time=9000&motion=reduced")).toEqual({
      sequence: "node-appearing",
      fixedTimeMs: 1450,
      preference: "reduced",
    });
    expect(parseB2MotionLabQuery("?sequence=devin-event&time=100")).toEqual({
      sequence: "idle",
      fixedTimeMs: undefined,
      preference: "system",
    });
  });
});

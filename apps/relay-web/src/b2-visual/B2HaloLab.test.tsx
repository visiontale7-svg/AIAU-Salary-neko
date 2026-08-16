import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { B2HaloLab } from "./B2HaloLab";

const { decodeHaloAssetsMock } = vi.hoisted(() => ({
  decodeHaloAssetsMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("./halo-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./halo-assets")>();
  return { ...actual, decodeHaloAssets: decodeHaloAssetsMock };
});

describe("B2HaloLab", () => {
  beforeEach(() => {
    decodeHaloAssetsMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    decodeHaloAssetsMock.mockReset();
  });

  it("renders the deterministic material families and marks the canonical ROI", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = render(<B2HaloLab />);

    expect(screen.getByRole("heading", { name: "星体光晕实验室" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Source 能量校准" })).toBeInTheDocument();
    expect(screen.getByText("目标能量")).toBeInTheDocument();
    expect(screen.getByText("200% 光学检查")).toBeInTheDocument();
    expect(screen.getByText("Team · Violet")).toBeInTheDocument();
    expect(screen.getByText("Question")).toBeInTheDocument();
    expect(screen.getByText("Candidate")).toBeInTheDocument();

    const target = container.querySelector<HTMLElement>('[data-halo-sample="source-target-100"]');
    expect(target).toBeInTheDocument();
    expect(target).toHaveClass("halo-lab__sample--1x");
    expect(target?.querySelector("svg")).toHaveAttribute("viewBox", "0 0 96 96");

    await waitFor(() => {
      expect(container.querySelector('[data-halo-lab="true"]')).toHaveAttribute("data-b2-ready", "true");
    });
    expect(container.querySelector('[data-runtime="deterministic-visual-fixture"]')).toBeInTheDocument();
    expect(decodeHaloAssetsMock).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed when a halo texture cannot be decoded", async () => {
    decodeHaloAssetsMock.mockRejectedValue(new Error("source-blue-v0 failed to decode"));
    const { container } = render(<B2HaloLab />);

    expect(await screen.findByRole("alert", { name: "Halo asset fatal error" })).toHaveTextContent("source-blue-v0 failed to decode");
    expect(container.querySelector('[data-halo-lab="true"]')).not.toHaveAttribute("data-b2-ready");
    expect(screen.getByText(/未启用旧径向渐变回退/)).toBeInTheDocument();
  });
});

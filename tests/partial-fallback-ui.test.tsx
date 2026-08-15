import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModeDefinition, SemanticUnit } from "../src/domain";
import { B5_SNAPSHOT } from "../src/fixtures/b5";

vi.mock("@xyflow/react", () => ({
  ViewportPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../src/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ipc")>();
  return { ...actual, atlasIpc: { ...actual.atlasIpc, mode: "tauri" as const } };
});

import { Drawers } from "../src/components/Drawers";
import { ModeIslands } from "../src/components/ModeIslands";
import { useAtlasStore } from "../src/store";

const unit = (id: string, modeIds: string[]): SemanticUnit => ({
  id,
  turnId: `T-${id}`,
  turnOrdinal: 1,
  speaker: "assistant",
  kind: "card",
  label: `unit-${id}`,
  fullText: `unit-${id}`,
  acts: ["其他"],
  importance: 0.5,
  provenance: "fallback",
  sourceSpans: [],
  modeIds,
});

afterEach(() => {
  cleanup();
  useAtlasStore.setState({
    snapshot: structuredClone(B5_SNAPSHOT),
    drawer: "none",
    selection: null,
  });
});

describe("partial and fallback presentation", () => {
  it("does not draw zero-confidence or memberless modes", () => {
    const modes: ModeDefinition[] = [
      { id: "fallback", kind: "未分类", label: "待复核", color: "#a5a7af", confidence: 0, inferred: true },
      { id: "orphan", kind: "探索", label: "无归属", color: "#777777", confidence: 0.7, inferred: true },
      { id: "valid", kind: "证据核验", label: "有效模式", color: "#2d7ff0", confidence: 0.8, inferred: true },
    ];
    render(
      <ModeIslands
        modes={modes}
        units={[unit("fallback", ["fallback"]), unit("valid", ["valid"])]}
        positions={{ fallback: { x: 0, y: 0 }, valid: { x: 300, y: 120 } }}
      />,
    );

    expect(screen.queryByRole("region", { name: "AI 推断模式：待复核" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "AI 推断模式：无归属" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "AI 推断模式：有效模式" })).toBeVisible();
  });

  it("keeps every normal B5 mode renderable", () => {
    render(
      <ModeIslands
        modes={B5_SNAPSHOT.modes}
        units={B5_SNAPSHOT.units}
        positions={B5_SNAPSHOT.layout}
      />,
    );

    for (const mode of B5_SNAPSHOT.modes) {
      expect(screen.getAllByRole("region", { name: `AI 推断模式：${mode.label}` }).length).toBeGreaterThan(0);
    }
  });

  it("groups repeated item fallbacks while preserving root errors and expandable context", () => {
    const userFallback = "该用户轮次未获得可核验的模型切片，已保留为确定性锚点";
    const assistantFallback = "该 GPT 轮次未获得可核验的模型切片，已使用逐字回退单元";
    const rootError = "Codex app-server 协议错误";
    const linkingError = "语义切片完全失败，已跳过关系推断";
    const snapshot = structuredClone(B5_SNAPSHOT);
    snapshot.status = "partial";
    const userFallbackUnits = snapshot.units.slice(0, 16);
    const assistantFallbackUnits = snapshot.units.slice(16, 32);
    snapshot.validationIssues = [
      { stage: "segmenting", severity: "error", message: rootError },
      ...userFallbackUnits.map(({ id }) => (
        { stage: "segmenting", severity: "warning" as const, itemId: id, message: userFallback }
      )),
      ...assistantFallbackUnits.map(({ id }) => (
        { stage: "segmenting", severity: "warning" as const, itemId: id, message: assistantFallback }
      )),
      { stage: "linking", severity: "error", message: linkingError },
    ];
    useAtlasStore.setState({ snapshot, drawer: "review", selection: null });

    const { container } = render(<Drawers />);

    expect(screen.getByText(rootError)).toBeVisible();
    expect(screen.getByText(linkingError)).toBeVisible();
    expect(screen.getAllByText(userFallback)).toHaveLength(1);
    expect(screen.getAllByText(assistantFallback)).toHaveLength(1);
    expect(screen.getAllByText("提示 ×16")).toHaveLength(2);
    expect(container.querySelectorAll(".review-item")).toHaveLength(4);

    fireEvent.click(screen.getAllByText("展开 16 个受影响项目")[0]);
    const firstFallbackUnit = userFallbackUnits[0];
    const unitLabel = firstFallbackUnit.label;
    const contextButton = screen.getByRole("button", { name: new RegExp(unitLabel) });
    fireEvent.click(contextButton);
    expect(useAtlasStore.getState().selection).toEqual({ kind: "node", id: firstFallbackUnit.id });
  });
});

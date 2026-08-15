import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { B2VisualDemo } from "./B2VisualDemo";

describe("B2VisualDemo", () => {
  afterEach(() => {
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

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RelayReadyRoomModel } from "@dialogue-atlas/relay-room";
import { createRelayFixtureBundle, createRelayFixturePresence } from "../fixture";
import { B2RoomView } from "./B2RoomView";

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

describe("B2 real collaboration workbench", () => {
  it("uses honest discussion, node, and execution tabs without fake LLM copy", () => {
    render(<B2RoomView model={readyModel()} />);
    expect(screen.getByRole("tab", { name: /讨论/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("团队讨论")).toBeInTheDocument();
    expect(screen.queryByText(/LLM|正在生成回答|停止生成/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "节点" }));
    expect(screen.getByLabelText("节点工作台")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /执行/ }));
    expect(screen.getByLabelText("执行工作台")).toBeInTheDocument();
  });

  it("creates and edits the team layer through existing callbacks", async () => {
    const onCreateTeamNode = vi.fn(async () => true);
    const onCreateTeamEdge = vi.fn(async () => true);
    render(<B2RoomView model={readyModel()} callbacks={{ onCreateTeamNode, onCreateTeamEdge }} />);
    fireEvent.click(screen.getByRole("tab", { name: "节点" }));

    fireEvent.click(screen.getByRole("button", { name: "＋ 团队观点" }));
    const nodeEditor = screen.getByRole("form", { name: "新增团队观点" });
    fireEvent.change(within(nodeEditor).getByLabelText("标题"), { target: { value: "补充与 Miro 的定位差异" } });
    fireEvent.click(within(nodeEditor).getByRole("button", { name: "加入房间" }));
    await waitFor(() => expect(onCreateTeamNode).toHaveBeenCalledWith(expect.objectContaining({ label: "补充与 Miro 的定位差异", kind: "claim" })));

    fireEvent.click(screen.getByRole("button", { name: "连接节点" }));
    const edgeEditor = screen.getByRole("form", { name: "新增团队关系" });
    fireEvent.change(within(edgeEditor).getByLabelText("显示文字"), { target: { value: "补强" } });
    fireEvent.click(within(edgeEditor).getByRole("button", { name: "新增关系" }));
    await waitFor(() => expect(onCreateTeamEdge).toHaveBeenCalledWith(expect.objectContaining({ label: "补强" })));
  });

  it("submits a proposal, appends a comment, and lets only the owner decide", async () => {
    const onSubmitProposal = vi.fn(async () => true);
    const onAppendComment = vi.fn(async () => true);
    const onDecideProposal = vi.fn();
    const ownerView = render(<B2RoomView model={readyModel()} callbacks={{ onSubmitProposal, onAppendComment, onDecideProposal }} />);
    fireEvent.click(screen.getByRole("tab", { name: "节点" }));
    fireEvent.click(screen.getByText("提出语义修改提案"));
    fireEvent.change(screen.getByLabelText("建议值"), { target: { value: "新的来源节点标题" } });
    fireEvent.change(screen.getByLabelText("理由"), { target: { value: "让决定边界更明确" } });
    fireEvent.click(screen.getByRole("button", { name: "提交提案" }));
    await waitFor(() => expect(onSubmitProposal).toHaveBeenCalledWith(expect.objectContaining({ targetType: "source_node", targetId: "n005", rationale: "让决定边界更明确" })));

    fireEvent.click(screen.getByRole("tab", { name: /讨论/ }));
    fireEvent.change(screen.getByPlaceholderText("补充依据或提出具体问题"), { target: { value: "请补充一条证据" } });
    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    await waitFor(() => expect(onAppendComment).toHaveBeenCalledWith("proposal_open_demo", "请补充一条证据"));
    fireEvent.change(screen.getByLabelText("房主决定依据"), { target: { value: "提案已经足够具体" } });
    fireEvent.click(screen.getByRole("button", { name: "接受" }));
    expect(onDecideProposal).toHaveBeenCalledWith("proposal_open_demo", "accepted", "提案已经足够具体");

    ownerView.unmount();
    const memberBundle = createRelayFixtureBundle();
    memberBundle.member = memberBundle.members[1]!;
    const memberDecision = vi.fn();
    render(<B2RoomView model={readyModel({ bundle: memberBundle })} callbacks={{ onDecideProposal: memberDecision }} />);
    expect(screen.queryByLabelText("房主决定依据")).not.toBeInTheDocument();
  });

  it("creates an action brief and exposes owner-only Devin controls with real run metadata", async () => {
    const onCreateActionBrief = vi.fn(async () => true);
    const onStartDevin = vi.fn(async () => true);
    const model = readyModel({
      devinEvents: {
        devin_demo: [{ id: "event_demo", runId: "devin_demo", externalEventId: "provider_event_1", eventType: "provider_message", actorType: "devin", createdAt: "2026-08-15T03:21:00.000Z", text: "Repository context loaded" }],
      },
    });
    render(<B2RoomView model={model} callbacks={{ onCreateActionBrief, onStartDevin }} />);
    fireEvent.click(screen.getByRole("tab", { name: /执行/ }));
    fireEvent.click(screen.getByText("把已接受决定转成 Action Brief"));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "实现 B2 节点协作" } });
    fireEvent.change(screen.getByLabelText("目标"), { target: { value: "把已批准决定变成受限实现任务" } });
    fireEvent.change(screen.getByLabelText("Baseline SHA"), { target: { value: "abc123" } });
    expect(screen.getByLabelText("Baseline SHA")).toBeInvalid();
    const baselineSha = "dbee0babc7480f25205783a00d2fe96cb65d350d";
    fireEvent.change(screen.getByLabelText("Baseline SHA"), { target: { value: baselineSha } });
    expect(screen.getByLabelText("Baseline SHA")).toBeValid();
    fireEvent.click(screen.getByRole("button", { name: "创建 Brief" }));
    await waitFor(() => expect(onCreateActionBrief).toHaveBeenCalledWith(expect.objectContaining({ title: "实现 B2 节点协作", baselineSha })));
    expect(screen.getByText("Repository context loaded")).toBeInTheDocument();
    expect(screen.getByText("Provider 连接")).toBeInTheDocument();
    expect(screen.getByText("provider_message")).toBeInTheDocument();
    expect(screen.getByText("devin", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "启动新的 Devin 尝试" }));
    await waitFor(() => expect(onStartDevin).toHaveBeenCalledWith("brief_demo", expect.stringMatching(/^b2_devin_start_/)));
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RelayRoom } from "./RelayRoom";
import { readyModel, testBundle } from "./test-fixture";

describe("RelayRoom bootstrap", () => {
  it("joins with an anonymous display name and invite token", () => {
    const onJoin = vi.fn();
    render(<RelayRoom model={{ phase: "join_required", inviteToken: "invite_demo" }} callbacks={{ onJoin }} />);
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Join room" }));
    expect(onJoin).toHaveBeenCalledWith({ inviteToken: "invite_demo", displayName: "Reviewer" });
    expect(screen.getByText(/No email address/)).toBeInTheDocument();
  });

  it("shows retryable anonymous bootstrap failures", () => {
    const onRetry = vi.fn();
    render(<RelayRoom model={{ phase: "error", message: "Invite expired.", retryable: true }} callbacks={{ onRetry }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Invite expired.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("RelayRoom ready collaboration", () => {
  it("lets only the owner explicitly close an open room", () => {
    const onCloseRoom = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { rerender } = render(<RelayRoom model={readyModel()} callbacks={{ onCloseRoom }} />);
    fireEvent.click(screen.getByRole("button", { name: "Close room" }));
    expect(onCloseRoom).toHaveBeenCalledOnce();

    const memberBundle = { ...testBundle, member: { ...testBundle.member, userId: "user_reviewer", role: "member" as const } };
    rerender(<RelayRoom model={readyModel({ bundle: memberBundle })} callbacks={{ onCloseRoom }} />);
    expect(screen.queryByRole("button", { name: "Close room" })).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("keeps published meaning locked while sending stance changes through callbacks", () => {
    const onSetStance = vi.fn();
    render(<RelayRoom model={readyModel()} callbacks={{ onSetStance }} />);
    expect(screen.getByText("Meaning locked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit team node details" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Request more evidence" }));
    expect(onSetStance).toHaveBeenCalledWith("n001", "needs_evidence");
    expect(screen.getByText(/A small room can carry reviewed structure/)).toBeInTheDocument();
  });

  it("edits team nodes only through the update callback", () => {
    const onUpdateTeamNode = vi.fn();
    render(<RelayRoom model={readyModel({ selection: { kind: "node", id: "team_node_1" } })} callbacks={{ onUpdateTeamNode }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit team node details" }));
    const form = screen.getByRole("form", { name: "Edit team node" });
    fireEvent.change(within(form).getByLabelText("Label"), { target: { value: "Rehearse in two browsers" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save team node" }));
    expect(onUpdateTeamNode).toHaveBeenCalledWith(expect.objectContaining({ id: "team_node_1", expectedRevision: 1, label: "Rehearse in two browsers" }));
  });

  it("lets the owner comment and decide an open proposal", () => {
    const onAppendComment = vi.fn();
    const onDecideProposal = vi.fn();
    render(<RelayRoom model={readyModel()} callbacks={{ onAppendComment, onDecideProposal }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Proposals (1)" }));
    fireEvent.change(screen.getByPlaceholderText("Add context or ask a concrete question"), { target: { value: "Please keep the wording concise." } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(onAppendComment).toHaveBeenCalledWith("proposal_open", "Please keep the wording concise.");

    fireEvent.change(screen.getByLabelText("Owner rationale"), { target: { value: "This makes the boundary clearer." } });
    fireEvent.click(screen.getByRole("button", { name: "accepted" }));
    expect(onDecideProposal).toHaveBeenCalledWith("proposal_open", "accepted", "This makes the boundary clearer.");
  });

  it("displays retained conflicts, reconnect action, event log, and reported PR", () => {
    const onReconnect = vi.fn();
    const onResolveDraft = vi.fn();
    render(<RelayRoom model={readyModel({
      connection: "offline",
      offline: { drafts: [{ id: "draft_1", kind: "proposal", label: "Privacy wording", savedAt: "2026-08-15T03:30:00.000Z", status: "conflict", expectedRevision: 3, serverRevision: 4 }] },
    })} callbacks={{ onReconnect, onResolveDraft }} />);

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(screen.getByText(/Revision conflict/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use room version" }));
    expect(onResolveDraft).toHaveBeenCalledWith("draft_1", "accept_server");

    fireEvent.click(screen.getByRole("tab", { name: "Handoff" }));
    expect(screen.getByText("fixture_session_1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Devin session/ })).toHaveAttribute("href", "https://example.test/devin/session/1");
    expect(screen.getByRole("link", { name: /Open reported PR/ })).toHaveAttribute("href", "https://example.test/pull/12");
    fireEvent.click(screen.getByText(/Event log/));
    expect(screen.getByText(/policy test task started/)).toBeInTheDocument();
  });

  it("hides owner decision controls from room members", () => {
    const memberBundle = { ...testBundle, member: { ...testBundle.member, userId: "user_reviewer", role: "member" as const } };
    render(<RelayRoom model={readyModel({ bundle: memberBundle })} callbacks={{ onDecideProposal: vi.fn() }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Proposals (1)" }));
    expect(screen.queryByLabelText("Owner rationale")).not.toBeInTheDocument();
  });

  it("keeps proposal text when a durable submission is rejected", async () => {
    const onSubmitProposal = vi.fn(async () => false);
    render(<RelayRoom model={readyModel()} callbacks={{ onSubmitProposal }} />);
    fireEvent.click(screen.getByText("Suggest a semantic change"));
    fireEvent.change(screen.getByLabelText("Proposed value"), { target: { value: "Keep this exact draft" } });
    fireEvent.change(screen.getByLabelText("Rationale"), { target: { value: "The server may reject while this remains useful." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
    await waitFor(() => expect(onSubmitProposal).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Proposed value")).toHaveValue("Keep this exact draft");
    expect(screen.getByLabelText("Rationale")).toHaveValue("The server may reject while this remains useful.");
  });

  it("disables persistent forms while offline without clearing entered text", () => {
    const onSubmitProposal = vi.fn();
    const { rerender } = render(<RelayRoom model={readyModel()} callbacks={{ onSubmitProposal }} />);
    fireEvent.click(screen.getByText("Suggest a semantic change"));
    fireEvent.change(screen.getByLabelText("Rationale"), { target: { value: "Retain this while reconnecting." } });
    rerender(<RelayRoom model={readyModel({ connection: "reconnecting" })} callbacks={{ onSubmitProposal }} />);
    expect(screen.getByRole("button", { name: "Submit proposal" })).toBeDisabled();
    expect(screen.getByLabelText("Rationale")).toHaveValue("Retain this while reconnecting.");
    expect(screen.getByText(/Durable editing is paused/)).toBeInTheDocument();
  });

  it("retains a Devin message request id after an unknown result and rotates it after success", async () => {
    const onSendDevinMessage = vi.fn()
      .mockResolvedValueOnce("unknown")
      .mockResolvedValue("accepted");
    render(<RelayRoom model={readyModel()} callbacks={{ onSendDevinMessage }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Handoff" }));
    const message = screen.getByLabelText("Message to the approved run");
    fireEvent.change(message, { target: { value: "Continue with the approved scope." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSendDevinMessage).toHaveBeenCalledTimes(1));
    expect(message).toHaveValue("Continue with the approved scope.");

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSendDevinMessage).toHaveBeenCalledTimes(2));
    expect(onSendDevinMessage.mock.calls[0]?.[2]).toBe(onSendDevinMessage.mock.calls[1]?.[2]);
    expect(message).toHaveValue("");

    fireEvent.change(message, { target: { value: "Continue with the approved scope." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSendDevinMessage).toHaveBeenCalledTimes(3));
    expect(onSendDevinMessage.mock.calls[2]?.[2]).not.toBe(onSendDevinMessage.mock.calls[1]?.[2]);
  });

  it("rotates a definitively rejected Devin message id while preserving its text", async () => {
    const onSendDevinMessage = vi.fn()
      .mockResolvedValueOnce("rejected")
      .mockResolvedValue("accepted");
    render(<RelayRoom model={readyModel()} callbacks={{ onSendDevinMessage }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Handoff" }));
    const message = screen.getByLabelText("Message to the approved run");
    fireEvent.change(message, { target: { value: "Retry this bounded instruction." } });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSendDevinMessage).toHaveBeenCalledTimes(1));
    expect(message).toHaveValue("Retry this bounded instruction.");

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onSendDevinMessage).toHaveBeenCalledTimes(2));
    expect(onSendDevinMessage.mock.calls[1]?.[2]).not.toBe(onSendDevinMessage.mock.calls[0]?.[2]);
    expect(message).toHaveValue("");
  });
});

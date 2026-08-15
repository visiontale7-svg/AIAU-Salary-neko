import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AtlasGraphView } from "./AtlasGraphView";
import type { AtlasGraphModel } from "./types";

const graph: AtlasGraphModel = {
  nodes: [
    { id: "n001", origin: "source", label: "Published claim", kind: "claim", acts: ["propose"], modeIds: ["m001"], evidenceIds: [], importance: 0.8, primary: true },
    { id: "n900", origin: "team", label: "Team follow-up", kind: "action", acts: [], modeIds: ["m001"], evidenceIds: [], importance: 0.5, primary: false },
  ],
  edges: [{ id: "r001", origin: "source", source: "n001", target: "n900", type: "supports", label: "supports", evidenceIds: [] }],
  modes: [{ id: "m001", kind: "decide", label: "Decision", color: "#579", memberNodeIds: ["n001", "n900"] }],
  layout: { n001: { x: 60, y: 80 }, n900: { x: 380, y: 80 } },
};

describe("AtlasGraphView", () => {
  it("selects and keyboard-moves a node through callbacks", () => {
    const onSelectionChange = vi.fn();
    const onNodePositionChange = vi.fn();
    render(<AtlasGraphView graph={graph} callbacks={{ onSelectionChange, onNodePositionChange }} />);

    const source = screen.getByRole("button", { name: /Published source claim: Published claim/i });
    fireEvent.keyDown(source, { key: "Enter" });
    fireEvent.keyDown(source, { key: "ArrowRight" });

    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "node", id: "n001" });
    expect(onNodePositionChange).toHaveBeenCalledWith("n001", { x: 76, y: 80 });
  });

  it("only exposes semantic edit controls for team items", () => {
    const onEditTeamNode = vi.fn();
    const { rerender } = render(
      <AtlasGraphView graph={graph} selection={{ kind: "node", id: "n001" }} callbacks={{ onEditTeamNode }} />,
    );
    expect(screen.queryByRole("button", { name: "Edit selected team node" })).not.toBeInTheDocument();

    rerender(<AtlasGraphView graph={graph} selection={{ kind: "node", id: "n900" }} callbacks={{ onEditTeamNode }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit selected team node" }));
    expect(onEditTeamNode).toHaveBeenCalledWith("n900");
  });

  it("does not expose editing for a team item owned by another member", () => {
    const lockedGraph: AtlasGraphModel = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === "n900" ? { ...node, editable: false } : node),
    };
    render(<AtlasGraphView graph={lockedGraph} selection={{ kind: "node", id: "n900" }} callbacks={{ onEditTeamNode: vi.fn() }} />);
    expect(screen.queryByRole("button", { name: "Edit selected team node" })).not.toBeInTheDocument();
  });

  it("requests team creation without mutating the supplied graph", () => {
    const onCreateTeamNode = vi.fn();
    const before = JSON.stringify(graph);
    render(<AtlasGraphView graph={graph} callbacks={{ onCreateTeamNode }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add team node" }));
    expect(onCreateTeamNode).toHaveBeenCalledOnce();
    expect(JSON.stringify(graph)).toBe(before);
  });

  it("creates a team edge after two keyboard-selected endpoints", () => {
    const onCreateTeamEdge = vi.fn();
    render(<AtlasGraphView graph={graph} callbacks={{ onCreateTeamEdge }} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect nodes" }));
    fireEvent.keyDown(screen.getByRole("button", { name: /Published source claim: Published claim/i }), { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent("Select a second node");
    fireEvent.keyDown(screen.getByRole("button", { name: /Team action: Team follow-up/i }), { key: "Enter" });
    expect(onCreateTeamEdge).toHaveBeenCalledWith("n001", "n900");
  });
});

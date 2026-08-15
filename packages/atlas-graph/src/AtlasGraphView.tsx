import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PublicPoint } from "@dialogue-atlas/relay-contract";
import {
  ATLAS_NODE_HEIGHT,
  ATLAS_NODE_WIDTH,
  atlasViewBox,
  buildAtlasLayout,
  nextTeamNodePosition,
} from "./layout";
import type {
  AtlasGraphEdge,
  AtlasGraphNode,
  AtlasGraphViewProps,
  AtlasPresence,
  AtlasSelection,
} from "./types";
import "./atlas-graph.css";

interface DragState {
  nodeId: string;
  pointerId: number;
  startClient: PublicPoint;
  startGraph: PublicPoint;
  moved: boolean;
}

const NUDGE = 16;

function stableColor(seed: string): string {
  const palette = ["#6d5dd3", "#147d78", "#d05d35", "#4269a8", "#9b4d83", "#577236"];
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length] ?? palette[0]!;
}

function selected(selection: AtlasSelection | undefined, kind: "node" | "edge", id: string): boolean {
  return selection?.kind === kind && selection.id === id;
}

function edgePath(source: PublicPoint, target: PublicPoint): string {
  const sourceX = source.x + ATLAS_NODE_WIDTH;
  const sourceY = source.y + ATLAS_NODE_HEIGHT / 2;
  const targetX = target.x;
  const targetY = target.y + ATLAS_NODE_HEIGHT / 2;
  const direction = targetX >= sourceX ? 1 : -1;
  const bend = Math.max(64, Math.abs(targetX - sourceX) * 0.42);
  return `M ${sourceX} ${sourceY} C ${sourceX + bend * direction} ${sourceY}, ${targetX - bend * direction} ${targetY}, ${targetX} ${targetY}`;
}

function nodePresence(presence: readonly AtlasPresence[], nodeId: string): AtlasPresence[] {
  return presence.filter((member) => member.activeNodeId === nodeId || member.editingNodeId === nodeId);
}

function nodeAccessibleName(node: AtlasGraphNode, members: readonly AtlasPresence[]): string {
  const origin = node.origin === "source" ? "Published source" : "Team";
  const attention = members.length ? `. Active: ${members.map((member) => member.displayName).join(", ")}` : "";
  const review = node.review
    ? `. Reviews: ${node.review.confirm} confirm, ${node.review.challenge} challenge, ${node.review.needsEvidence} need evidence`
    : "";
  const accepted = node.acceptedProposal ? `. Owner accepted ${node.acceptedProposal.operation.replaceAll("_", " ")}` : "";
  return `${origin} ${node.kind}: ${node.label}${accepted}${review}${attention}`;
}

export function AtlasGraphView({ graph, selection = null, presence = [], callbacks = {} }: AtlasGraphViewProps) {
  const markerId = `atlas-arrow-${useId().replaceAll(":", "")}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const [preview, setPreview] = useState<Record<string, PublicPoint>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [edgeStart, setEdgeStart] = useState<string | null>(null);
  const layout = useMemo(() => ({ ...buildAtlasLayout(graph), ...preview }), [graph, preview]);
  const viewBox = useMemo(() => atlasViewBox(layout), [layout]);

  useEffect(() => {
    setPreview((current) => {
      const next: Record<string, PublicPoint> = {};
      for (const [nodeId, point] of Object.entries(current)) {
        const published = graph.layout[nodeId];
        if (!published || published.x !== point.x || published.y !== point.y) next[nodeId] = point;
      }
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [graph.layout]);

  function clientDelta(event: ReactPointerEvent<SVGGElement>, state: DragState): PublicPoint {
    const svg = svgRef.current;
    const bounds = svg?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return { x: event.clientX - state.startClient.x, y: event.clientY - state.startClient.y };
    }
    return {
      x: ((event.clientX - state.startClient.x) * viewBox.width) / bounds.width,
      y: ((event.clientY - state.startClient.y) * viewBox.height) / bounds.height,
    };
  }

  function selectNode(nodeId: string) {
    if (edgeStart !== null && callbacks.onCreateTeamEdge) {
      if (!edgeStart) {
        setEdgeStart(nodeId);
      } else {
        if (edgeStart !== nodeId) callbacks.onCreateTeamEdge(edgeStart, nodeId);
        setEdgeStart(null);
      }
    }
    callbacks.onSelectionChange?.({ kind: "node", id: nodeId });
  }

  function handleNodeKey(event: ReactKeyboardEvent<SVGGElement>, node: AtlasGraphNode) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectNode(node.id);
      return;
    }
    if (event.key.toLowerCase() === "e" && (node.editable ?? node.origin === "team") && callbacks.onEditTeamNode) {
      event.preventDefault();
      callbacks.onEditTeamNode(node.id);
      return;
    }
    const delta: PublicPoint | undefined =
      event.key === "ArrowLeft" ? { x: -NUDGE, y: 0 }
        : event.key === "ArrowRight" ? { x: NUDGE, y: 0 }
          : event.key === "ArrowUp" ? { x: 0, y: -NUDGE }
            : event.key === "ArrowDown" ? { x: 0, y: NUDGE }
              : undefined;
    if (!delta || !callbacks.onNodePositionChange) return;
    event.preventDefault();
    const current = layout[node.id] ?? { x: 0, y: 0 };
    const next = { x: current.x + delta.x, y: current.y + delta.y };
    setPreview((positions) => ({ ...positions, [node.id]: next }));
    callbacks.onNodePositionChange(node.id, next);
  }

  function handlePointerDown(event: ReactPointerEvent<SVGGElement>, nodeId: string) {
    if (event.button !== 0) return;
    const position = layout[nodeId];
    if (!position) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      nodeId,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startGraph: position,
      moved: false,
    });
  }

  function handlePointerMove(event: ReactPointerEvent<SVGGElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = clientDelta(event, drag);
    const moved = drag.moved || Math.abs(delta.x) + Math.abs(delta.y) > 4;
    const position = { x: drag.startGraph.x + delta.x, y: drag.startGraph.y + delta.y };
    setDrag({ ...drag, moved });
    setPreview((positions) => ({ ...positions, [drag.nodeId]: position }));
    callbacks.onNodeDragPreview?.(drag.nodeId, position);
  }

  function handlePointerUp(event: ReactPointerEvent<SVGGElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = layout[drag.nodeId] ?? drag.startGraph;
    if (drag.moved) callbacks.onNodePositionChange?.(drag.nodeId, position);
    else selectNode(drag.nodeId);
    setDrag(null);
  }

  const selectedNode = selection?.kind === "node" ? graph.nodes.find((node) => node.id === selection.id) : undefined;
  const selectedEdge = selection?.kind === "edge" ? graph.edges.find((edge) => edge.id === selection.id) : undefined;

  return (
    <section className="atlas-graph" aria-label="Relay decision graph">
      <div className="atlas-graph__toolbar" aria-label="Graph tools">
        <div className="atlas-graph__legend" aria-label="Graph legend">
          <span><i className="atlas-graph__legend-dot atlas-graph__legend-dot--source" />Published</span>
          <span><i className="atlas-graph__legend-dot atlas-graph__legend-dot--team" />Team</span>
        </div>
        <div className="atlas-graph__tools">
          {callbacks.onCreateTeamNode ? (
            <button type="button" onClick={() => callbacks.onCreateTeamNode?.(nextTeamNodePosition(layout))}>
              Add team node
            </button>
          ) : null}
          {callbacks.onCreateTeamEdge ? (
            <button
              type="button"
              className={edgeStart ? "is-active" : ""}
              aria-pressed={Boolean(edgeStart)}
              onClick={() => setEdgeStart((value) => value !== null ? null : selection?.kind === "node" ? selection.id : "")}
            >
              {edgeStart ? "Choose target" : "Connect nodes"}
            </button>
          ) : null}
        </div>
      </div>

      {edgeStart !== null ? (
        <p className="atlas-graph__hint" role="status">
          {edgeStart ? "Select a second node to create a team edge." : "Select the first node to connect."}
        </p>
      ) : null}

      <div className="atlas-graph__stage">
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          role="group"
          aria-label={`${graph.nodes.length} nodes and ${graph.edges.length} relationships`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>

          <g className="atlas-graph__edges" aria-label="Relationships">
            {graph.edges.map((edge) => {
              const source = layout[edge.source];
              const target = layout[edge.target];
              if (!source || !target) return null;
              const isSelected = selected(selection, "edge", edge.id);
              const editable = edge.editable ?? edge.origin === "team";
              return (
                <g key={edge.id}>
                  <path
                    className={`atlas-edge atlas-edge--${edge.origin}${isSelected ? " is-selected" : ""}`}
                    d={edgePath(source, target)}
                    markerEnd={`url(#${markerId})`}
                  />
                  <path
                    className="atlas-edge__hit"
                    d={edgePath(source, target)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${edge.acceptedProposal ? "Owner-accepted" : edge.origin === "source" ? "Published" : "Team"} relationship: ${edge.label || edge.type}`}
                    aria-pressed={isSelected}
                    onClick={() => callbacks.onSelectionChange?.({ kind: "edge", id: edge.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        callbacks.onSelectionChange?.({ kind: "edge", id: edge.id });
                      } else if (event.key.toLowerCase() === "e" && editable) {
                        event.preventDefault();
                        callbacks.onEditTeamEdge?.(edge.id);
                      }
                    }}
                  />
                  {edge.openProposals ? (
                    <text className="atlas-edge__proposal" x={(source.x + target.x) / 2} y={(source.y + target.y) / 2}>
                      {edge.openProposals} proposal{edge.openProposals === 1 ? "" : "s"}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g className="atlas-graph__nodes" aria-label="Graph nodes">
            {graph.nodes.map((node) => {
              const position = layout[node.id];
              if (!position) return null;
              const members = nodePresence(presence, node.id);
              const isSelected = selected(selection, "node", node.id);
              const needsAttention = Boolean(node.review?.challenge || node.review?.needsEvidence || node.review?.openProposals);
              return (
                <g
                  key={node.id}
                  className={`atlas-node atlas-node--${node.origin}${isSelected ? " is-selected" : ""}${needsAttention ? " needs-attention" : ""}`}
                  transform={`translate(${position.x} ${position.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={nodeAccessibleName(node, members)}
                  aria-pressed={isSelected}
                  onKeyDown={(event) => handleNodeKey(event, node)}
                  onPointerDown={(event) => handlePointerDown(event, node.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={() => setDrag(null)}
                >
                  <rect width={ATLAS_NODE_WIDTH} height={ATLAS_NODE_HEIGHT} rx="20" />
                  <text className="atlas-node__origin" x="18" y="25">
                    {node.acceptedProposal ? "OWNER ACCEPTED" : node.origin === "source" ? "PUBLISHED" : "TEAM"} · {node.kind.toUpperCase()}
                  </text>
                  <foreignObject x="18" y="35" width={ATLAS_NODE_WIDTH - 36} height="48">
                    <p className="atlas-node__label" title={node.label}>{node.label}</p>
                  </foreignObject>
                  <g className="atlas-node__review" transform="translate(18 94)">
                    {node.review ? (
                      <>
                        <text x="0">✓ {node.review.confirm}</text>
                        <text x="48">△ {node.review.challenge}</text>
                        <text x="98">? {node.review.needsEvidence}</text>
                      </>
                    ) : (
                      <text x="0">{node.acts.slice(0, 2).join(" · ") || "Ready for review"}</text>
                    )}
                  </g>
                  {members.slice(0, 3).map((member, index) => (
                    <circle
                      key={member.userId}
                      className="atlas-node__presence"
                      cx={ATLAS_NODE_WIDTH - 17 - index * 15}
                      cy="17"
                      r="7"
                      fill={member.color ?? stableColor(member.userId)}
                    >
                      <title>{member.displayName}{member.editingNodeId === node.id ? " is editing" : " is viewing"}</title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {selectedNode && (selectedNode.editable ?? selectedNode.origin === "team") && callbacks.onEditTeamNode ? (
        <div className="atlas-graph__selection-action">
          <span>Team node selected</span>
          <button type="button" aria-label="Edit selected team node" onClick={() => callbacks.onEditTeamNode?.(selectedNode.id)}>Edit team node</button>
        </div>
      ) : null}
      {selectedEdge && (selectedEdge.editable ?? selectedEdge.origin === "team") && callbacks.onEditTeamEdge ? (
        <div className="atlas-graph__selection-action">
          <span>Team relationship selected</span>
          <button type="button" aria-label="Edit selected team edge" onClick={() => callbacks.onEditTeamEdge?.(selectedEdge.id)}>Edit team edge</button>
        </div>
      ) : null}
      <p className="atlas-graph__sr-help">
        Use Tab to move between nodes and relationships. Enter selects. Arrow keys move a focused node. Press E to edit a team item.
      </p>
    </section>
  );
}

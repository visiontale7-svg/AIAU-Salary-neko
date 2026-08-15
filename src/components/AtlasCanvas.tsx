import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutItem, SemanticUnit } from "../domain";
import { MAX_VISIBLE_GRAPH_NODES, RELATION_COLORS } from "../domain";
import { nodeSize, type DialogueFlowNode, type RelationFlowEdge } from "../graph/graphTypes";
import { runElkLayout } from "../graph/layout";
import { atlasIpc, ipcErrorMessage } from "../ipc";
import { useAtlasStore } from "../store";
import { DialogueNode } from "./DialogueNode";
import { RelationEdge } from "./RelationEdge";
import { ModeIslands } from "./ModeIslands";
import { SearchIcon, SparkleIcon } from "./icons";

const nodeTypes = { dialogue: DialogueNode };
const edgeTypes = { relation: RelationEdge };

const secondaryPosition = (unit: SemanticUnit, index: number) => ({
  x: 70 + (index % 6) * 260,
  y: 1235 + Math.floor(index / 6) * 120,
});

function chooseHandles(
  source: LayoutItem | undefined,
  target: LayoutItem | undefined,
): { sourceHandle: string; targetHandle: string } {
  if (!source || !target) return { sourceHandle: "s-right", targetHandle: "t-left" };
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) > Math.abs(dy) * 0.7) {
    return dx >= 0
      ? { sourceHandle: "s-right", targetHandle: "t-left" }
      : { sourceHandle: "s-left", targetHandle: "t-right" };
  }
  return dy >= 0
    ? { sourceHandle: "s-bottom", targetHandle: "t-top" }
    : { sourceHandle: "s-top", targetHandle: "t-bottom" };
}

function AtlasCanvasInner() {
  const snapshot = useAtlasStore((state) => state.snapshot);
  const platform = useAtlasStore((state) => state.analysisSettings.capabilities.platform);
  const selection = useAtlasStore((state) => state.selection);
  const showModes = useAtlasStore((state) => state.showModes);
  const showSecondary = useAtlasStore((state) => state.showSecondary);
  const search = useAtlasStore((state) => state.search);
  const select = useAtlasStore((state) => state.select);
  const toggleSecondary = useAtlasStore((state) => state.toggleSecondary);
  const setSearch = useAtlasStore((state) => state.setSearch);
  const moveNode = useAtlasStore((state) => state.moveNode);
  const replaceLayout = useAtlasStore((state) => state.replaceLayout);
  const setViewportState = useAtlasStore((state) => state.setViewport);
  const setToast = useAtlasStore((state) => state.setToast);
  const setCorrection = useAtlasStore((state) => state.setCorrection);
  const { fitView, setViewport } = useReactFlow();
  const [relayouting, setRelayouting] = useState(false);
  const initializedSnapshot = useRef<string | null>(null);
  const autoLayoutSnapshot = useRef<string | null>(null);
  const relayoutRun = useRef(0);
  const fitViewTimer = useRef<number | null>(null);

  const visibleUnits = useMemo(() => {
    const candidates = snapshot.units.filter((unit) => showSecondary || !unit.secondary);
    return candidates.slice(0, MAX_VISIBLE_GRAPH_NODES);
  }, [showSecondary, snapshot.units]);
  const hiddenCount = snapshot.units.filter((unit) => unit.secondary).length;
  const visibleIds = useMemo(() => new Set(visibleUnits.map((unit) => unit.id)), [visibleUnits]);

  const activeIds = useMemo(() => {
    if (!selection) return new Set<string>();
    if (selection.kind === "edge") {
      const relation = snapshot.relations.find((item) => item.id === selection.id);
      return new Set(relation ? [relation.source, relation.target] : []);
    }
    const connected = snapshot.relations
      .filter((relation) => relation.source === selection.id || relation.target === selection.id)
      .flatMap((relation) => [relation.source, relation.target]);
    return new Set([selection.id, ...connected]);
  }, [selection, snapshot.relations]);

  const matchedIds = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return new Set<string>();
    return new Set(
      snapshot.units
        .filter((unit) =>
          [unit.label, unit.fullText, unit.turnId, ...unit.acts]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
        )
        .map((unit) => unit.id),
    );
  }, [search, snapshot.units]);

  const makeNodes = useCallback(
    (previous: DialogueFlowNode[] = []): DialogueFlowNode[] => {
      const previousById = new Map(previous.map((node) => [node.id, node]));
      let secondaryIndex = 0;
      return visibleUnits.map((unit) => {
        const size = nodeSize(unit);
        const old = previousById.get(unit.id);
        const savedPosition = snapshot.layout[unit.id];
        const position =
          savedPosition ?? old?.position ?? secondaryPosition(unit, secondaryIndex++);
        const hasFocus = selection !== null || search.trim().length > 0;
        const isActive = activeIds.has(unit.id) || matchedIds.has(unit.id);
        return {
          id: unit.id,
          type: "dialogue",
          position,
          width: size.width,
          height: size.height,
          style: { width: size.width, height: size.height },
          data: {
            unit,
            selected: selection?.kind === "node" && selection.id === unit.id,
            dimmed: hasFocus && !isActive,
            matched: matchedIds.has(unit.id),
          },
          draggable: unit.kind !== "unresolved",
          selectable: true,
          zIndex: unit.kind === "anchor" ? 3 : 2,
        } satisfies DialogueFlowNode;
      });
    }, [activeIds, matchedIds, search, selection, snapshot.layout, visibleUnits]);

  const [nodes, setNodes] = useState<DialogueFlowNode[]>(() => makeNodes());

  useEffect(() => {
    setNodes((previous) => makeNodes(previous));
  }, [makeNodes]);

  const positionMap = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node.position])),
    [nodes],
  );
  const nodesMatchVisibleUnits = useMemo(
    () => nodes.length === visibleUnits.length && nodes.every((node) => visibleIds.has(node.id)),
    [nodes, visibleIds, visibleUnits.length],
  );

  const edges = useMemo<RelationFlowEdge[]>(
    () =>
      snapshot.relations
        .filter((relation) => visibleIds.has(relation.source) && visibleIds.has(relation.target))
        .map((relation) => {
          const handles = chooseHandles(positionMap[relation.source], positionMap[relation.target]);
          const selected = selection?.kind === "edge" && selection.id === relation.id;
          const dimmed = selection
            ? selection.kind === "edge"
              ? !selected
              : relation.source !== selection.id && relation.target !== selection.id
            : false;
          return {
            id: relation.id,
            type: "relation",
            source: relation.source,
            target: relation.target,
            ...handles,
            data: { relation, selected, dimmed },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: RELATION_COLORS[relation.type],
              width: 15,
              height: 15,
            },
            interactionWidth: 18,
            zIndex: selected ? 4 : 1,
          };
        }),
    [positionMap, selection, snapshot.relations, visibleIds],
  );

  useEffect(() => {
    if (
      initializedSnapshot.current === snapshot.id
      || nodes.length === 0
      || !nodesMatchVisibleUnits
    ) return;
    const targetSnapshotId = snapshot.id;
    const timer = window.setTimeout(() => {
      if (useAtlasStore.getState().snapshot.id !== targetSnapshotId) return;
      initializedSnapshot.current = targetSnapshotId;
      if (snapshot.viewport) void setViewport(snapshot.viewport, { duration: 0 });
      else void fitView({ padding: 0.08, duration: 450 });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [fitView, nodes.length, nodesMatchVisibleUnits, setViewport, snapshot.id, snapshot.viewport]);

  useEffect(() => () => {
    if (fitViewTimer.current !== null) window.clearTimeout(fitViewTimer.current);
  }, [snapshot.id]);

  const onNodesChange = useCallback(
    (changes: NodeChange<DialogueFlowNode>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const onNodeClick: NodeMouseHandler<DialogueFlowNode> = useCallback(
    (_event, node) => select({ kind: "node", id: node.id }),
    [select],
  );

  const onNodeDragStop: OnNodeDrag<DialogueFlowNode> = useCallback(
    (_event, node) => {
      const active = useAtlasStore.getState();
      if (!active.snapshot.units.some((unit) => unit.id === node.id)) return;
      moveNode(node.id, node.position, true);
      const current = useAtlasStore.getState();
      void atlasIpc.saveLayout(
        current.snapshot.id,
        current.snapshot.layout,
        current.snapshot.viewport,
        current.showModes,
      ).catch(() => {
        setToast("节点已固定；桌面持久化暂不可用");
      });
    },
    [moveNode, setToast],
  );

  const relayout = useCallback(async () => {
    const targetSnapshotId = snapshot.id;
    const runId = ++relayoutRun.current;
    setRelayouting(true);
    try {
      const initialState = useAtlasStore.getState();
      const initialLayout = initialState.snapshot.id === targetSnapshotId
        ? initialState.snapshot.layout
        : snapshot.layout;
      const orderedUnits = [...visibleUnits].sort(
        (a, b) => a.turnOrdinal - b.turnOrdinal || a.id.localeCompare(b.id),
      );
      const flowEdges = orderedUnits.slice(1).map((unit, index) => ({
        id: `flow-${orderedUnits[index].id}-${unit.id}`,
        source: orderedUnits[index].id,
        target: unit.id,
      }));
      const layout = await runElkLayout(
        visibleUnits.map((unit) => {
          const size = nodeSize(unit);
          return {
            id: unit.id,
            width: size.width,
            height: size.height,
            ...initialLayout[unit.id],
          };
        }),
        [
          ...edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
          ...flowEdges,
        ],
      );
      const latestState = useAtlasStore.getState();
      if (latestState.snapshot.id !== targetSnapshotId) return;
      const merged = Object.fromEntries(
        Object.entries(layout).map(([id, position]) => [
          id,
          latestState.snapshot.layout[id]?.pinned
            ? latestState.snapshot.layout[id]
            : position,
        ]),
      );
      replaceLayout(merged);
      const current = useAtlasStore.getState();
      setNodes((current) =>
        current.map((node) => ({ ...node, position: merged[node.id] ?? node.position })),
      );
      await atlasIpc.saveLayout(
        current.snapshot.id,
        current.snapshot.layout,
        current.snapshot.viewport,
        current.showModes,
      );
      if (fitViewTimer.current !== null) window.clearTimeout(fitViewTimer.current);
      fitViewTimer.current = window.setTimeout(() => {
        fitViewTimer.current = null;
        if (useAtlasStore.getState().snapshot.id === targetSnapshotId) {
          void fitView({ padding: 0.09, duration: 400 });
        }
      }, 50);
      setToast("已整理布局；手动固定的节点保持原位");
    } catch (error) {
      setToast(ipcErrorMessage(error, "整理布局失败"));
    } finally {
      if (relayoutRun.current === runId) setRelayouting(false);
    }
  }, [edges, fitView, replaceLayout, setToast, snapshot.id, snapshot.layout, visibleUnits]);

  useEffect(() => {
    if (
      nodes.length === 0
      || !nodesMatchVisibleUnits
      || Object.keys(snapshot.layout).length > 0
    ) return;
    if (autoLayoutSnapshot.current === snapshot.id) return;
    autoLayoutSnapshot.current = snapshot.id;
    void relayout();
  }, [nodes.length, nodesMatchVisibleUnits, relayout, snapshot.id, snapshot.layout]);

  const searchCount = matchedIds.size;

  return (
    <section className="canvas-shell" aria-label="对话关系星图">
      <ReactFlow<DialogueFlowNode, RelationFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={(_event, edge) => select({ kind: "edge", id: edge.id })}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={(_event, viewport) => {
          setViewportState(viewport);
        }}
        onPaneClick={() => select(null)}
        minZoom={0.22}
        maxZoom={1.8}
        defaultViewport={snapshot.viewport ?? { x: 40, y: 30, zoom: 0.72 }}
        selectionOnDrag
        panOnScroll
        nodesFocusable
        edgesFocusable
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#d6deea" />
        {showModes ? <ModeIslands modes={snapshot.modes} units={visibleUnits} positions={positionMap} source={snapshot.provider === "fixture" ? "fixture" : "ai"} /> : null}
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeStrokeWidth={3}
          nodeColor={(node) => {
            const unit = (node.data as unknown as { unit: SemanticUnit }).unit;
            if (unit.kind === "anchor") return "#153a86";
            if (unit.kind === "operation") return "#9aa5b5";
            if (unit.kind === "unresolved") return "#ffffff";
            return "#dbe7f7";
          }}
          maskColor="rgba(241,245,250,.72)"
        />
        <div className="canvas-toolbar top-left panel-shadow">
          <SearchIcon size={17} />
          <input
            aria-label="搜索原文"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索原文、标签或轮次"
          />
          {search ? <span className="search-count">{searchCount}</span> : <kbd>{platform === "macos" ? "⌘K" : "Ctrl+K"}</kbd>}
        </div>
        <div className="canvas-toolbar top-right panel-shadow">
          <button type="button" className="toolbar-button quiet" onClick={() => { select(null); setCorrection(true); }}>
            ＋ 关系
          </button>
          <button type="button" className="toolbar-button" onClick={() => void relayout()} disabled={relayouting}>
            <SparkleIcon size={16} /> {relayouting ? "整理中…" : "整理布局"}
          </button>
          <button type="button" className="toolbar-button quiet" onClick={() => void fitView({ padding: 0.08, duration: 350 })}>
            适配全图
          </button>
        </div>
        {!showSecondary && hiddenCount > 0 ? (
          <button
            type="button"
            className="secondary-expander panel-shadow"
            onClick={toggleSecondary}
          >
            ＋ 展开 {hiddenCount} 个次级片段
          </button>
        ) : showSecondary && hiddenCount > 0 ? (
          <button
            type="button"
            className="secondary-expander panel-shadow is-open"
            onClick={toggleSecondary}
          >
            收起 {hiddenCount} 个次级片段
          </button>
        ) : null}
      </ReactFlow>
      <div className="graph-legend" aria-label="关系图例">
        <span className="legend-note">粗框＝结构影响力 · 节点面积≠文字长度 · 柔色岛＝可关闭的 {snapshot.provider === "fixture" ? "示例模式" : "AI 推断"}</span>
        <span className="legend-divider" />
        {(["回应", "依据", "反证", "条件", "修正", "撤回", "未解决"] as const).map((label) => {
          const type = label === "依据" ? "理由" : label;
          return (
            <span className="legend-item" key={label}>
              <i style={{ backgroundColor: RELATION_COLORS[type] }} /> {label}
            </span>
          );
        })}
      </div>
    </section>
  );
}

export function AtlasCanvas() {
  return (
    <ReactFlowProvider>
      <AtlasCanvasInner />
    </ReactFlowProvider>
  );
}

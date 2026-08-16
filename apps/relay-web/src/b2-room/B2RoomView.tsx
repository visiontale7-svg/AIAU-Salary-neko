import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { RelayReadyRoomModel, RelayRoomCallbacks } from "@dialogue-atlas/relay-room";
import { B2StarfieldCanvas } from "../b2-visual/B2StarfieldCanvas";
import { StarAura, StarBody } from "../b2-visual/StarOptics";
import { buildB2RoomProjection, type B2RoomStar } from "./b2-room-model";
import "./b2-room.css";

export interface B2RoomViewProps {
  model: RelayReadyRoomModel;
  callbacks?: RelayRoomCallbacks;
  onOpenStructuredView?(): void;
}

interface DragState {
  nodeId: string;
  x: number;
  y: number;
  moved: boolean;
}

const TONE_COLOR = {
  blue: "#5ca5ff",
  violet: "#a17aff",
  cyan: "#5ad6dc",
  green: "#a9d692",
  orange: "#f0ae59",
  red: "#e87870",
  silver: "#d7e2ee",
} as const;

function initials(name: string): string {
  return [...name.trim()].slice(0, 2).join("").toUpperCase() || "?";
}

function displayTime(value: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  } catch {
    return "";
  }
}

function pointInGraph(event: ReactPointerEvent<SVGCircleElement>): { x: number; y: number } {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 1096,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * 860,
  };
}

function compactLabel(label: string): string {
  const characters = [...label];
  return characters.length > 34 ? `${characters.slice(0, 33).join("")}…` : label;
}

export function B2RoomView({ model, callbacks = {}, onOpenStructuredView }: B2RoomViewProps) {
  const projection = useMemo(() => buildB2RoomProjection(model), [model]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const selectedId = model.selection?.kind === "node" ? model.selection.id : undefined;
  const selected = projection.stars.find((star) => star.node.id === selectedId);
  const selectedEvidence = selected?.node.evidenceIds.flatMap((id) => {
    const evidence = model.bundle.atlas.evidence[id];
    return evidence ? [{ id, ...evidence }] : [];
  }) ?? [];
  const selectedStance = selected
    ? model.bundle.stances.find((stance) => stance.nodeId === selected.node.id && stance.userId === model.bundle.member.userId)?.stance
    : undefined;

  function visibleStar(star: B2RoomStar): B2RoomStar {
    return drag?.nodeId === star.node.id ? { ...star, x: drag.x, y: drag.y } : star;
  }

  function visiblePath(edge: { source: string; target: string }, fallback: string): string {
    const sourceEntry = projection.stars.find((star) => star.node.id === edge.source);
    const targetEntry = projection.stars.find((star) => star.node.id === edge.target);
    if (!sourceEntry || !targetEntry) return fallback;
    const source = visibleStar(sourceEntry);
    const target = visibleStar(targetEntry);
    const dx = target.x - source.x;
    return `M ${source.x} ${source.y} C ${source.x + dx * .36} ${source.y}, ${target.x - dx * .36} ${target.y}, ${target.x} ${target.y}`;
  }

  function select(star: B2RoomStar): void {
    callbacks.onSelectionChange?.({ kind: "node", id: star.node.id });
  }

  function startDrag(event: ReactPointerEvent<SVGCircleElement>, star: B2RoomStar): void {
    if (model.connection !== "live" || model.bundle.room.status !== "open") return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const next = { nodeId: star.node.id, ...pointInGraph(event), moved: false };
    dragRef.current = next;
    setDrag(next);
    select(star);
  }

  function moveDrag(event: ReactPointerEvent<SVGCircleElement>): void {
    const current = dragRef.current;
    if (!current) return;
    const point = pointInGraph(event);
    const next = { ...current, ...point, moved: true };
    dragRef.current = next;
    setDrag(next);
    callbacks.onPreviewNodePosition?.(current.nodeId, projection.toRoomPoint(point));
  }

  function finishDrag(): void {
    const current = dragRef.current;
    if (!current) return;
    dragRef.current = null;
    setDrag(null);
    if (current.moved) callbacks.onSaveNodePosition?.(current.nodeId, projection.toRoomPoint(current));
  }

  return (
    <main className="b2-live" data-relay-view="b2-room" data-connection={model.connection}>
      <nav className="b2-live__rail" aria-label="Dialogue Atlas navigation">
        <div className="b2-live__mark" aria-hidden="true">◇</div>
        <button type="button" aria-label="星图" className="is-active">✦</button>
        <button type="button" aria-label="探索">⌕</button>
        <button type="button" aria-label="时间线">◷</button>
        <span className="b2-live__self" title={model.bundle.member.displayName}>{initials(model.bundle.member.displayName)}</span>
      </nav>

      <section className="b2-live__canvas" aria-label="Relay constellation room">
        <B2StarfieldCanvas staticMode className="b2-live__starfield" />
        <header className="b2-live__topbar">
          <h1>Dialogue Atlas</h1>
          <div className="b2-live__room-title">
            <span>协作星图</span>
            <strong>{model.bundle.room.title}</strong>
          </div>
          <div className="b2-live__presence" aria-label="Members online">
            <span className={`b2-live__connection is-${model.connection}`} />
            <b>{model.presence.length} 人在线</b>
            {model.presence.slice(0, 4).map((member) => (
              <i key={member.userId} title={member.displayName}>{initials(member.displayName)}</i>
            ))}
          </div>
        </header>

        <svg className="b2-live__graph" viewBox="0 0 1096 860" role="group" aria-label="Live Relay decision constellation">
          <defs>
            <filter id="b2-live-path-glow" x="-20%" y="-80%" width="140%" height="260%">
              <feGaussianBlur stdDeviation="3.4" />
            </filter>
          </defs>
          <g data-b2-live-pass="path-atmosphere">
            {projection.paths.map((path) => (
              <path key={path.edge.id} d={visiblePath(path.edge, path.d)} fill="none" stroke={TONE_COLOR[path.tone]} strokeWidth="11" opacity=".12" filter="url(#b2-live-path-glow)" />
            ))}
          </g>
          <g data-b2-live-pass="star-aura">
            {projection.stars.map((entry) => {
              const star = visibleStar(entry);
              return <StarAura key={star.node.id} spec={star.optics} x={star.x} y={star.y} />;
            })}
          </g>
          <g data-b2-live-pass="path-core">
            {projection.paths.map((path) => (
              <path key={path.edge.id} d={visiblePath(path.edge, path.d)} fill="none" stroke={TONE_COLOR[path.tone]} strokeWidth={path.edge.origin === "source" ? 1.6 : 1.1} opacity=".9" />
            ))}
          </g>
          <g data-b2-live-pass="star-body">
            {projection.stars.map((entry) => {
              const star = visibleStar(entry);
              return <StarBody key={star.node.id} spec={star.optics} state={star.node.id === selectedId ? "selected" : "idle"} x={star.x} y={star.y} />;
            })}
          </g>
          <g data-b2-live-pass="presence">
            {projection.stars.flatMap((entry) => {
              const star = visibleStar(entry);
              return star.presence.map((member, index) => (
                <circle key={`${star.node.id}:${member.userId}`} cx={star.x} cy={star.y} r={star.optics.shellRadius + 11 + index * 3} fill="none" stroke={member.color} strokeWidth="1.5" strokeDasharray="7 4" opacity=".9">
                  <title>{member.displayName} 正在查看</title>
                </circle>
              ));
            })}
          </g>
          <g data-b2-live-pass="interaction">
            {projection.stars.map((entry) => {
              const star = visibleStar(entry);
              return (
                <g key={star.node.id} className="b2-live-node" data-origin={star.node.origin}>
                  <circle
                    cx={star.x}
                    cy={star.y}
                    r="25"
                    fill="transparent"
                    role="button"
                    tabIndex={0}
                    aria-label={`${star.node.origin === "source" ? "来源" : "团队"}节点：${star.node.label}`}
                    aria-pressed={star.node.id === selectedId}
                    onClick={() => select(star)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        select(star);
                      }
                    }}
                    onPointerDown={(event) => startDrag(event, star)}
                    onPointerMove={moveDrag}
                    onPointerUp={finishDrag}
                    onPointerCancel={finishDrag}
                  />
                  <text x={star.x + 20} y={star.y - 3} className="b2-live-node__label"><title>{star.node.label}</title>{compactLabel(star.node.label)}</text>
                  <text x={star.x + 20} y={star.y + 17} className="b2-live-node__meta">
                    {star.node.origin === "source" ? "已发布来源" : "团队观点"}
                    {star.node.review?.openProposals ? ` · ${star.node.review.openProposals} 个提案` : ""}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <aside className="b2-live__legend" aria-label="协作图例">
          <span><i className="source" />来源节点</span>
          <span><i className="team" />团队节点</span>
          <span><i className="presence" />成员正在查看</span>
        </aside>
        <p className="b2-live__hint">拖动预览通过 Realtime 广播，松手后持久化 · 来源语义保持锁定</p>
      </section>

      <aside className="b2-live__workbench">
        <div className="b2-live__tabs"><b>对话</b><span>节点</span><span>执行</span></div>
        <section className="b2-live__room-status">
          <div><span className={`b2-live__connection is-${model.connection}`} /><strong>{model.connection === "live" ? "实时协作中" : model.connection}</strong></div>
          <small>revision {model.bundle.room.revision} · seq {model.bundle.lastActivitySeq}</small>
        </section>
        <section className="b2-live__selection" aria-live="polite">
          {selected ? (
            <>
              <p className="b2-live__eyebrow">{selected.node.origin === "source" ? "发布来源 · 不可改写" : "团队新增 · 可协作"}</p>
              <h2>{selected.node.label}</h2>
              <div className="b2-live__stats">
                <span>确认 {selected.node.review?.confirm ?? 0}</span>
                <span>质疑 {selected.node.review?.challenge ?? 0}</span>
                <span>待证据 {selected.node.review?.needsEvidence ?? 0}</span>
              </div>
              {selectedEvidence.map((evidence) => <blockquote key={evidence.id}>{evidence.excerpt}</blockquote>)}
              <div className="b2-live__stance" aria-label="对节点表态">
                <button type="button" aria-pressed={selectedStance === "confirm"} disabled={model.connection !== "live"} onClick={() => callbacks.onSetStance?.(selected.node.id, "confirm")}>确认</button>
                <button type="button" aria-pressed={selectedStance === "challenge"} disabled={model.connection !== "live"} onClick={() => callbacks.onSetStance?.(selected.node.id, "challenge")}>质疑</button>
                <button type="button" aria-pressed={selectedStance === "needs_evidence"} disabled={model.connection !== "live"} onClick={() => callbacks.onSetStance?.(selected.node.id, "needs_evidence")}>需要证据</button>
              </div>
            </>
          ) : <p className="b2-live__empty">选择一颗星，查看它在团队推理中的位置。</p>}
        </section>
        <section className="b2-live__members">
          <h3>房间成员</h3>
          {model.presence.map((member) => (
            <div key={member.userId}><i>{initials(member.displayName)}</i><span>{member.displayName}<small>{member.role === "owner" ? "房主" : "成员"} · {displayTime(member.onlineAt)}</small></span></div>
          ))}
        </section>
        {model.notice ? <p className="b2-live__notice">{model.notice}</p> : null}
        <button type="button" className="b2-live__structured" onClick={onOpenStructuredView}>打开完整协作面板</button>
      </aside>
    </main>
  );
}

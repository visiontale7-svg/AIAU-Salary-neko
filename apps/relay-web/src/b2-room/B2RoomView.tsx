import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { RelayReadyRoomModel, RelayRoomCallbacks } from "@dialogue-atlas/relay-room";
import { B2StarfieldCanvas } from "../b2-visual/B2StarfieldCanvas";
import { StarAura, StarBody } from "../b2-visual/StarOptics";
import {
  NODE_APPEARANCE_PARTICLES,
  sampleB2Motion,
  useB2MotionTimeline,
} from "../b2-visual/b2-motion";
import {
  clearActiveB2MotionTrigger,
  completeActiveB2MotionTrigger,
  createB2MotionRuntimeState,
  enqueueB2MotionTrigger,
  type B2MotionTrigger,
} from "../b2-visual/b2-motion-runtime";
import { buildB2RoomProjection, stableIndex, type B2RoomStar } from "./b2-room-model";
import {
  deriveStaleDevinNodeTargets,
  mapConfirmedActivityToB2Motion,
  mapSelectionToB2Motion,
} from "./b2-activity-motion";
import { B2Workbench, type B2WorkbenchTab } from "./B2Workbench";
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

export interface B2CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PanState {
  pointerId: number;
  clientX: number;
  clientY: number;
  camera: B2CameraState;
}

const GRAPH_WIDTH = 1096;
const GRAPH_HEIGHT = 860;
const MIN_ZOOM = .55;
const MAX_ZOOM = 2.4;
const DEFAULT_CAMERA: B2CameraState = { x: 0, y: 0, zoom: 1 };
const REDUCED_NEW_BADGE_MS = 2_400;

const TONE_COLOR = {
  blue: "#5ca5ff",
  violet: "#a17aff",
  cyan: "#5ad6dc",
  green: "#a9d692",
  orange: "#f0ae59",
  red: "#e87870",
  silver: "#d7e2ee",
} as const;

const MEMBER_COLORS = ["#ff9f8f", "#8ed2aa", "#83b8ff", "#cf9cff", "#ffd078"] as const;

function memberColor(colorKey: string): string {
  return MEMBER_COLORS[stableIndex(colorKey, MEMBER_COLORS.length)]!;
}

function initials(name: string): string {
  return [...name.trim()].slice(0, 2).join("").toUpperCase() || "?";
}

function pointInViewport(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * GRAPH_WIDTH,
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * GRAPH_HEIGHT,
  };
}

export function screenPointToGraphPoint(point: { x: number; y: number }, camera: B2CameraState): { x: number; y: number } {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}

function pointInGraph(
  event: ReactPointerEvent<SVGCircleElement>,
  camera: B2CameraState,
): { x: number; y: number } {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) return { x: 0, y: 0 };
  return screenPointToGraphPoint(pointInViewport(svg, event.clientX, event.clientY), camera);
}

function projectionBounds(stars: readonly B2RoomStar[]): GraphBounds {
  if (stars.length === 0) return { minX: 0, minY: 0, maxX: GRAPH_WIDTH, maxY: GRAPH_HEIGHT };
  return {
    minX: Math.min(...stars.map((star) => star.x)) - 90,
    minY: Math.min(...stars.map((star) => star.y)) - 90,
    maxX: Math.max(...stars.map((star) => star.x)) + 240,
    maxY: Math.max(...stars.map((star) => star.y)) + 90,
  };
}

export function clampB2Camera(camera: B2CameraState, bounds: GraphBounds): B2CameraState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom));
  const centerX = (GRAPH_WIDTH / 2 - camera.x) / zoom;
  const centerY = (GRAPH_HEIGHT / 2 - camera.y) / zoom;
  const clampedCenterX = Math.min(bounds.maxX + 80, Math.max(bounds.minX - 80, centerX));
  const clampedCenterY = Math.min(bounds.maxY + 80, Math.max(bounds.minY - 80, centerY));
  return {
    x: GRAPH_WIDTH / 2 - clampedCenterX * zoom,
    y: GRAPH_HEIGHT / 2 - clampedCenterY * zoom,
    zoom,
  };
}

export function zoomB2CameraAt(
  camera: B2CameraState,
  nextZoom: number,
  focus: { x: number; y: number },
  bounds: GraphBounds,
): B2CameraState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const ratio = zoom / camera.zoom;
  return clampB2Camera({
    x: focus.x - (focus.x - camera.x) * ratio,
    y: focus.y - (focus.y - camera.y) * ratio,
    zoom,
  }, bounds);
}

export function fitB2Camera(bounds: GraphBounds): B2CameraState {
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = Math.min(1.65, Math.max(MIN_ZOOM, Math.min(
    (GRAPH_WIDTH - 170) / contentWidth,
    (GRAPH_HEIGHT - 180) / contentHeight,
  )));
  return clampB2Camera({
    x: GRAPH_WIDTH / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
    y: GRAPH_HEIGHT / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
    zoom,
  }, bounds);
}

function compactLabel(label: string): string {
  const characters = [...label];
  return characters.length > 34 ? `${characters.slice(0, 33).join("")}…` : label;
}

function remoteSelectionSnapshot(model: RelayReadyRoomModel): Map<string, string | undefined> {
  return new Map(model.presence
    .filter((member) => member.userId !== model.bundle.member.userId)
    .map((member) => [member.userId, member.activeNodeId]));
}

function useReducedMotionPreference(): boolean {
  const readPreference = () => typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [reducedMotion, setReducedMotion] = useState(readPreference);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return reducedMotion;
}

function particlePosition(
  particle: (typeof NODE_APPEARANCE_PARTICLES)[number],
  elapsedMs: number,
): { x: number; y: number; opacity: number } {
  const local = Math.min(1, Math.max(0, (elapsedMs - (280 + particle.delayMs)) / particle.durationMs));
  const eased = local * local * (3 - 2 * local);
  return {
    x: particle.startX + (particle.endX - particle.startX) * eased,
    y: particle.startY + (particle.endY - particle.startY) * eased,
    opacity: local <= 0 || local >= 1 ? 0 : Math.sin(local * Math.PI),
  };
}

export function B2RoomView({ model, callbacks = {}, onOpenStructuredView }: B2RoomViewProps) {
  const projection = useMemo(() => buildB2RoomProjection(model), [model]);
  const bounds = useMemo(() => projectionBounds(projection.stars), [projection.stars]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [camera, setCamera] = useState<B2CameraState>(DEFAULT_CAMERA);
  const [workbenchTab, setWorkbenchTab] = useState<B2WorkbenchTab>("discussion");
  const [motionRuntime, setMotionRuntime] = useState(() => createB2MotionRuntimeState({
    lastActivitySeq: model.bundle.lastActivitySeq,
  }));
  const [armedMotionKey, setArmedMotionKey] = useState<string | null>(null);
  const settledStaleTargets = useMemo(
    () => deriveStaleDevinNodeTargets(model.bundle),
    [model.bundle],
  );
  const [reducedNewBadges, setReducedNewBadges] = useState<ReadonlySet<string>>(() => new Set());
  const dragRef = useRef<DragState | null>(null);
  const cameraRef = useRef<B2CameraState>(DEFAULT_CAMERA);
  const panRef = useRef<PanState | null>(null);
  const minimapPanRef = useRef<number | null>(null);
  const previousBundleRef = useRef(model.bundle);
  const previousRemoteSelectionsRef = useRef(remoteSelectionSnapshot(model));
  const previousPresenceConnectionRef = useRef(model.connection);
  const seenRemoteSelectionKeysRef = useRef(new Set<string>());
  const reducedBadgeTimersRef = useRef(new Map<string, number>());
  const lastSelectionMotionIdRef = useRef<string | undefined>(
    model.selection?.kind === "node" ? model.selection.id : undefined,
  );
  const selectionRevisionRef = useRef(0);
  const reducedMotion = useReducedMotionPreference();
  const activeMotion = motionRuntime.active;
  const motionTimeline = useB2MotionTimeline({
    sequence: activeMotion?.sequence ?? "selected-focus",
    reducedMotion,
    autoPlay: false,
  });
  const motionSnapshot = activeMotion && armedMotionKey !== activeMotion.eventKey
    ? sampleB2Motion(activeMotion.sequence, 0, reducedMotion)
    : motionTimeline.snapshot;
  const selectedId = model.selection?.kind === "node" ? model.selection.id : undefined;
  const selected = projection.stars.find((star) => star.node.id === selectedId);
  const activeMotionStar = activeMotion
    ? projection.stars.find((star) => star.node.id === activeMotion.targetId)
    : undefined;
  const activeMotionPath = activeMotion?.pathId
    ? projection.paths.find((path) => path.edge.id === activeMotion.pathId)
    : undefined;
  const activeMotionSource = activeMotionPath
    ? projection.stars.find((star) => star.node.id === activeMotionPath.edge.source)
    : undefined;
  const activeMotionVisualStar = activeMotionStar ? visibleStar(activeMotionStar) : undefined;
  const activeMotionVisualSource = activeMotionSource ? visibleStar(activeMotionSource) : undefined;
  const condensationAngle = activeMotionVisualStar && activeMotionVisualSource
    ? Math.atan2(activeMotionVisualStar.y - activeMotionVisualSource.y, activeMotionVisualStar.x - activeMotionVisualSource.x) * 180 / Math.PI
    : 0;
  const appearingTargetId = activeMotion?.sequence === "node-appearing" ? activeMotion.targetId : undefined;
  const minimapViewport = {
    x: -camera.x / camera.zoom,
    y: -camera.y / camera.zoom,
    width: GRAPH_WIDTH / camera.zoom,
    height: GRAPH_HEIGHT / camera.zoom,
  };

  function enqueueMotion(trigger: B2MotionTrigger | null): void {
    if (!trigger) return;
    setMotionRuntime((current) => enqueueB2MotionTrigger(current, trigger).state);
  }

  useLayoutEffect(() => {
    const previous = previousBundleRef.current;
    for (const activity of model.confirmedLiveActivity ?? []) {
      const context = {
        connection: model.connection,
        delivery: "live",
        current: model.bundle,
        previous,
      } as const;
      const trigger = mapConfirmedActivityToB2Motion(activity, context);
      enqueueMotion(trigger);
    }
    previousBundleRef.current = model.bundle;
  }, [model.bundle, model.confirmedLiveActivity, model.connection]);

  useEffect(() => {
    const currentSelectionId = model.selection?.kind === "node" ? model.selection.id : undefined;
    if (!currentSelectionId || currentSelectionId === lastSelectionMotionIdRef.current) return;
    lastSelectionMotionIdRef.current = currentSelectionId;
    selectionRevisionRef.current += 1;
    enqueueMotion(mapSelectionToB2Motion(currentSelectionId, selectionRevisionRef.current));
  }, [model.selection]);

  useEffect(() => {
    const previous = previousRemoteSelectionsRef.current;
    const next = remoteSelectionSnapshot(model);
    const remainedLive = previousPresenceConnectionRef.current === "live" && model.connection === "live";

    if (remainedLive) {
      for (const [userId, nodeId] of next) {
        if (!nodeId || previous.get(userId) === nodeId) continue;
        if (!projection.stars.some((star) => star.node.id === nodeId)) continue;
        const eventKey = `presence-selection:${userId}:${nodeId}`;
        if (seenRemoteSelectionKeysRef.current.has(eventKey)) continue;
        seenRemoteSelectionKeysRef.current.add(eventKey);
        enqueueMotion({
          eventKey,
          sequence: "selected-focus",
          targetId: nodeId,
        });
      }
    }

    previousRemoteSelectionsRef.current = next;
    previousPresenceConnectionRef.current = model.connection;
  }, [model.connection, model.presence, model.bundle.member.userId, projection.stars]);

  useEffect(() => {
    if (!activeMotion) {
      setArmedMotionKey(null);
      return;
    }
    let cancelled = false;
    setArmedMotionKey(null);
    motionTimeline.replay();
    queueMicrotask(() => {
      if (!cancelled) setArmedMotionKey(activeMotion.eventKey);
    });
    return () => {
      cancelled = true;
    };
  }, [activeMotion?.eventKey]);

  useEffect(() => {
    if (!reducedMotion || activeMotion?.sequence !== "node-appearing") return;
    const targetId = activeMotion.targetId;
    setReducedNewBadges((current) => new Set([...current, targetId]));
    const previousTimer = reducedBadgeTimersRef.current.get(targetId);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
      reducedBadgeTimersRef.current.delete(targetId);
      setReducedNewBadges((current) => {
        const next = new Set(current);
        next.delete(targetId);
        return next;
      });
    }, REDUCED_NEW_BADGE_MS);
    reducedBadgeTimersRef.current.set(targetId, timer);
  }, [activeMotion?.eventKey, reducedMotion]);

  useEffect(() => () => {
    for (const timer of reducedBadgeTimersRef.current.values()) window.clearTimeout(timer);
    reducedBadgeTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!activeMotion || armedMotionKey !== activeMotion.eventKey) return;
    if (motionSnapshot.sequence !== activeMotion.sequence || motionSnapshot.playback !== "finished") return;
    setMotionRuntime((current) => completeActiveB2MotionTrigger(current, activeMotion.eventKey));
    setArmedMotionKey(null);
  }, [activeMotion, armedMotionKey, motionSnapshot.playback, motionSnapshot.sequence]);

  useLayoutEffect(() => {
    if (activeMotion?.sequence !== "devin-stale") return;
    if (settledStaleTargets.has(activeMotion.targetId)) return;
    setMotionRuntime((current) => clearActiveB2MotionTrigger(current, activeMotion.eventKey));
    setArmedMotionKey(null);
  }, [activeMotion, settledStaleTargets]);

  function updateCamera(
    updater: B2CameraState | ((current: B2CameraState) => B2CameraState),
  ): void {
    setCamera((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      cameraRef.current = next;
      return next;
    });
  }

  function zoomAtCenter(multiplier: number): void {
    updateCamera((current) => zoomB2CameraAt(
      current,
      current.zoom * multiplier,
      { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 },
      bounds,
    ));
  }

  function startCanvasPan(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.button !== 0 || dragRef.current) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      camera: cameraRef.current,
    };
  }

  function moveCanvasPan(event: ReactPointerEvent<SVGSVGElement>): void {
    const active = panRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - active.clientX) / Math.max(1, rect.width)) * GRAPH_WIDTH;
    const dy = ((event.clientY - active.clientY) / Math.max(1, rect.height)) * GRAPH_HEIGHT;
    updateCamera(clampB2Camera({
      ...active.camera,
      x: active.camera.x + dx,
      y: active.camera.y + dy,
    }, bounds));
  }

  function finishCanvasPan(event: ReactPointerEvent<SVGSVGElement>): void {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>): void {
    event.preventDefault();
    const focus = pointInViewport(event.currentTarget, event.clientX, event.clientY);
    const factor = Math.exp(-event.deltaY * .0014);
    updateCamera((current) => zoomB2CameraAt(current, current.zoom * factor, focus, bounds));
  }

  function centerCameraFromMinimap(event: ReactPointerEvent<SVGSVGElement>): void {
    const point = pointInViewport(event.currentTarget, event.clientX, event.clientY);
    updateCamera((current) => clampB2Camera({
      ...current,
      x: GRAPH_WIDTH / 2 - point.x * current.zoom,
      y: GRAPH_HEIGHT / 2 - point.y * current.zoom,
    }, bounds));
  }

  function startMinimapPan(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    minimapPanRef.current = event.pointerId;
    centerCameraFromMinimap(event);
  }

  function moveMinimapPan(event: ReactPointerEvent<SVGSVGElement>): void {
    if (minimapPanRef.current !== event.pointerId) return;
    centerCameraFromMinimap(event);
  }

  function finishMinimapPan(event: ReactPointerEvent<SVGSVGElement>): void {
    if (minimapPanRef.current !== event.pointerId) return;
    minimapPanRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleMinimapKey(event: React.KeyboardEvent<SVGSVGElement>): void {
    const step = event.shiftKey ? 90 : 42;
    const delta = event.key === "ArrowLeft" ? { x: step, y: 0 }
      : event.key === "ArrowRight" ? { x: -step, y: 0 }
        : event.key === "ArrowUp" ? { x: 0, y: step }
          : event.key === "ArrowDown" ? { x: 0, y: -step }
            : undefined;
    if (!delta) return;
    event.preventDefault();
    updateCamera((current) => clampB2Camera({
      ...current,
      x: current.x + delta.x,
      y: current.y + delta.y,
    }, bounds));
  }

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
    if (star.node.id !== lastSelectionMotionIdRef.current) {
      lastSelectionMotionIdRef.current = star.node.id;
      selectionRevisionRef.current += 1;
      enqueueMotion(mapSelectionToB2Motion(star.node.id, selectionRevisionRef.current));
    }
    callbacks.onSelectionChange?.({ kind: "node", id: star.node.id });
    setWorkbenchTab("node");
  }

  function startDrag(event: ReactPointerEvent<SVGCircleElement>, star: B2RoomStar): void {
    if (model.connection !== "live" || model.bundle.room.status !== "open") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const next = { nodeId: star.node.id, ...pointInGraph(event, cameraRef.current), moved: false };
    dragRef.current = next;
    setDrag(next);
    select(star);
  }

  function moveDrag(event: ReactPointerEvent<SVGCircleElement>): void {
    const current = dragRef.current;
    if (!current) return;
    const point = pointInGraph(event, cameraRef.current);
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
    <main
      className="b2-live"
      data-relay-view="b2-room"
      data-connection={model.connection}
      data-motion-sequence={activeMotion?.sequence ?? "idle"}
      data-motion-playback={activeMotion ? motionSnapshot.playback : "idle"}
      data-motion-event-key={activeMotion?.eventKey}
      data-motion-reduced={reducedMotion ? "true" : "false"}
    >
      <nav className="b2-live__rail" aria-label="Dialogue Atlas navigation">
        <div className="b2-live__mark" aria-hidden="true">◇</div>
        <button type="button" aria-label="星图" className="is-active">✦</button>
        <button type="button" aria-label="探索（核心闭环后开放）" title="核心闭环后开放" disabled>⌕</button>
        <button type="button" aria-label="时间线（核心闭环后开放）" title="原始对话时间线尚未进入公开契约" disabled>◷</button>
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
              <i key={member.userId} title={member.displayName} style={{ "--member-color": memberColor(member.colorKey) } as CSSProperties}>{initials(member.displayName)}</i>
            ))}
          </div>
        </header>

        <svg
          className="b2-live__graph"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          role="group"
          aria-label="Live Relay decision constellation"
          data-camera-x={camera.x.toFixed(2)}
          data-camera-y={camera.y.toFixed(2)}
          data-camera-zoom={camera.zoom.toFixed(3)}
          onPointerDown={startCanvasPan}
          onPointerMove={moveCanvasPan}
          onPointerUp={finishCanvasPan}
          onPointerCancel={finishCanvasPan}
          onWheel={handleWheel}
        >
          <defs>
            <filter id="b2-live-path-glow" x="-20%" y="-80%" width="140%" height="260%">
              <feGaussianBlur stdDeviation="3.4" />
            </filter>
          </defs>
          <g
            className="b2-live__camera-layer"
            data-testid="b2-camera-layer"
            transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}
          >
            <g data-b2-live-pass="path-atmosphere">
              {projection.paths.map((path) => (
                <path key={path.edge.id} d={visiblePath(path.edge, path.d)} fill="none" stroke={TONE_COLOR[path.tone]} strokeWidth="11" opacity=".12" filter="url(#b2-live-path-glow)" />
              ))}
            </g>
            <g data-b2-live-pass="star-aura">
              {projection.stars.map((entry) => {
                const star = visibleStar(entry);
                const opacity = star.node.id === appearingTargetId ? motionSnapshot.channels.auraOpacity : 1;
                return (
                  <g key={star.node.id} opacity={opacity}>
                    <StarAura spec={star.optics} x={star.x} y={star.y} />
                  </g>
                );
              })}
            </g>
            <g data-b2-live-pass="path-core">
              {projection.paths.map((path) => (
                <path
                  key={path.edge.id}
                  d={visiblePath(path.edge, path.d)}
                  fill="none"
                  stroke={TONE_COLOR[path.tone]}
                  strokeWidth={path.edge.origin === "source" ? 1.6 : 1.1}
                  opacity={activeMotion?.sequence === "node-appearing" && activeMotion.pathId === path.edge.id ? 0 : .9}
                />
              ))}
            </g>
            <g data-b2-live-pass="motion-path-overlay">
              {activeMotionPath && activeMotion?.sequence === "node-appearing" ? (
                <g data-motion-path={activeMotionPath.edge.id}>
                  <path
                    className="b2-live-motion__path-reveal"
                    d={visiblePath(activeMotionPath.edge, activeMotionPath.d)}
                    pathLength="1"
                    strokeDasharray={`${motionSnapshot.channels.pathProgress} ${Math.max(0, 1 - motionSnapshot.channels.pathProgress)}`}
                  />
                  {motionSnapshot.channels.pathPacketOpacity > 0 ? (
                    <path
                      className="b2-live-motion__path-packet"
                      data-motion-packet="node-appearing"
                      d={visiblePath(activeMotionPath.edge, activeMotionPath.d)}
                      pathLength="1"
                      opacity={motionSnapshot.channels.pathPacketOpacity}
                      strokeDasharray=".022 .978"
                      strokeDashoffset={1 - motionSnapshot.channels.pathProgress}
                    />
                  ) : null}
                </g>
              ) : activeMotionPath && activeMotion?.sequence === "devin-event" && motionSnapshot.channels.pathPacketOpacity > 0 ? (
                <path
                  className="b2-live-motion__path-packet"
                  data-motion-packet="devin-event"
                  d={visiblePath(activeMotionPath.edge, activeMotionPath.d)}
                  pathLength="1"
                  opacity={motionSnapshot.channels.pathPacketOpacity}
                  strokeDasharray=".022 .978"
                  strokeDashoffset={1 - motionSnapshot.channels.pathProgress}
                />
              ) : null}
            </g>
            <g data-b2-live-pass="path-particles">
              {activeMotion?.sequence === "node-appearing" && activeMotionVisualStar ? (
                <g
                  className="b2-live-motion__condensation"
                  data-motion-particle-count={NODE_APPEARANCE_PARTICLES.length}
                  transform={`translate(${activeMotionVisualStar.x} ${activeMotionVisualStar.y}) rotate(${condensationAngle})`}
                >
                  {NODE_APPEARANCE_PARTICLES.map((particle) => {
                    const position = particlePosition(particle, motionSnapshot.elapsedMs);
                    return (
                      <circle
                        key={particle.id}
                        data-motion-particle={particle.id}
                        cx={position.x}
                        cy={position.y}
                        r={particle.size}
                        opacity={position.opacity * motionSnapshot.channels.particleOpacity}
                      />
                    );
                  })}
                </g>
              ) : null}
            </g>
            <g data-b2-live-pass="star-body">
              {projection.stars.map((entry) => {
                const star = visibleStar(entry);
                const appearingOpacity = star.node.id === appearingTargetId
                  ? Math.max(motionSnapshot.channels.coreOpacity, motionSnapshot.channels.shellOpacity)
                  : 1;
                const staleOpacity = activeMotion?.sequence === "devin-stale" && star.node.id === activeMotion.targetId
                  ? motionSnapshot.channels.devinBodyOpacity
                  : settledStaleTargets.has(star.node.id) ? .82 : 1;
                const selectedState = star.node.id === selectedId
                  && !(activeMotion?.sequence === "selected-focus" && activeMotion.targetId === star.node.id && motionSnapshot.channels.selectedHandoff < .99);
                return (
                  <g key={star.node.id} opacity={appearingOpacity * staleOpacity}>
                    <StarBody spec={star.optics} state={selectedState ? "selected" : "idle"} x={star.x} y={star.y} />
                  </g>
                );
              })}
            </g>
            <g data-b2-live-pass="motion-star-overlay">
              {activeMotion?.sequence === "selected-focus" && activeMotionVisualStar ? (
                <g data-motion-selected-target={activeMotionVisualStar.node.id}>
                  <g opacity={motionSnapshot.channels.auraBoost * .12}>
                    <StarAura spec={activeMotionVisualStar.optics} x={activeMotionVisualStar.x} y={activeMotionVisualStar.y} />
                  </g>
                  <g
                    className="b2-live-motion__focus-ring"
                    opacity={motionSnapshot.channels.focusRingOpacity}
                    transform={`translate(${activeMotionVisualStar.x} ${activeMotionVisualStar.y}) scale(${motionSnapshot.channels.focusRingScale}) translate(${-activeMotionVisualStar.x} ${-activeMotionVisualStar.y})`}
                  >
                    <circle className="b2-live-motion__focus-air" cx={activeMotionVisualStar.x} cy={activeMotionVisualStar.y} r={activeMotionVisualStar.optics.shellRadius + 15} />
                    <circle className="b2-live-motion__focus-core" cx={activeMotionVisualStar.x} cy={activeMotionVisualStar.y} r={activeMotionVisualStar.optics.shellRadius + 15} />
                  </g>
                </g>
              ) : null}
              {activeMotion?.sequence === "devin-event" && activeMotionVisualStar ? (
                <g
                  className="b2-live-motion__event-lift"
                  data-motion-event-lift={activeMotionVisualStar.node.id}
                  opacity={motionSnapshot.channels.devinHazeBoost}
                  transform={`translate(${activeMotionVisualStar.x} ${activeMotionVisualStar.y})`}
                >
                  <circle r="30" />
                  <circle r={activeMotionVisualStar.optics.shellRadius + 4} />
                </g>
              ) : null}
              {projection.stars.filter((star) => settledStaleTargets.has(star.node.id) || (activeMotion?.sequence === "devin-stale" && activeMotion.targetId === star.node.id)).map((star) => (
                <circle
                  key={star.node.id}
                  className="b2-live-motion__stale-ring"
                  data-motion-stale-target={star.node.id}
                  cx={star.x}
                  cy={star.y}
                  r={star.optics.shellRadius + 13}
                  opacity={activeMotion?.sequence === "devin-stale" && activeMotion.targetId === star.node.id ? motionSnapshot.channels.staleRingOpacity : 1}
                  pathLength="1"
                  strokeDasharray=".09 .055 .025 .07 .13 .08 .045 .505"
                />
              ))}
            </g>
            <g data-b2-live-pass="star-overlay">
              {projection.stars.flatMap((entry) => {
                const star = visibleStar(entry);
                return star.presence.map((member, index) => (
                  <circle key={`${star.node.id}:${member.userId}`} cx={star.x} cy={star.y} r={star.optics.shellRadius + 11 + index * 3} fill="none" stroke={member.color} strokeWidth="1.5" strokeDasharray="7 4" opacity=".9">
                    <title>{member.displayName} 正在查看</title>
                  </circle>
                ));
              })}
              {projection.stars.map((entry) => {
                const star = visibleStar(entry);
                const appearing = star.node.id === appearingTargetId;
                const presentationOpacity = appearing ? motionSnapshot.channels.labelOpacity : 1;
                return (
                  <g key={star.node.id} className="b2-live-node" data-origin={star.node.origin} opacity={presentationOpacity}>
                    {!appearing ? (
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
                    ) : null}
                    <text x={star.x + 20} y={star.y - 3} className="b2-live-node__label"><title>{star.node.label}</title>{compactLabel(star.node.label)}</text>
                    <text x={star.x + 20} y={star.y + 17} className="b2-live-node__meta">
                      {star.node.origin === "source" ? "已发布来源" : `团队观点${star.author ? ` · ${star.author.displayName}` : ""}`}
                      {star.node.review?.openProposals ? ` · ${star.node.review.openProposals} 个提案` : ""}
                    </text>
                    {reducedMotion && (appearing || reducedNewBadges.has(star.node.id)) ? (
                      <g
                        className="b2-live-motion__new-badge"
                        data-motion-new-badge={star.node.id}
                        transform={`translate(${star.x + 17} ${star.y - 36})`}
                      >
                        <rect width="34" height="16" rx="8" />
                        <text x="17" y="11" textAnchor="middle">新增</text>
                      </g>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        <aside className="b2-live__legend" aria-label="协作图例">
          <span><i className="source" />来源节点</span>
          <span><i className="team" />团队节点</span>
          <span><i className="presence" />成员正在查看</span>
        </aside>
        <aside className="b2-live__minimap" aria-label="全局小地图">
          <header>
            <span>全局小地图</span>
            <small>{Math.round(camera.zoom * 100)}%</small>
          </header>
          <svg
            viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
            role="application"
            aria-label="全局小地图，可点击或拖动定位视角，方向键微调"
            tabIndex={0}
            onPointerDown={startMinimapPan}
            onPointerMove={moveMinimapPan}
            onPointerUp={finishMinimapPan}
            onPointerCancel={finishMinimapPan}
            onKeyDown={handleMinimapKey}
          >
            <rect className="b2-live__minimap-bg" width={GRAPH_WIDTH} height={GRAPH_HEIGHT} />
            {projection.paths.map((path) => (
              <path
                key={path.edge.id}
                d={visiblePath(path.edge, path.d)}
                fill="none"
                stroke={TONE_COLOR[path.tone]}
                strokeWidth="7"
                opacity=".64"
              />
            ))}
            {projection.stars.map((entry) => {
              const star = visibleStar(entry);
              return (
                <circle
                  key={star.node.id}
                  cx={star.x}
                  cy={star.y}
                  r={star.node.origin === "source" ? 10 : 8}
                  fill="#eaf5ff"
                  stroke={TONE_COLOR[star.optics.tone]}
                  strokeWidth="6"
                />
              );
            })}
            <rect
              className="b2-live__minimap-viewport"
              data-testid="b2-minimap-viewport"
              x={minimapViewport.x}
              y={minimapViewport.y}
              width={minimapViewport.width}
              height={minimapViewport.height}
            />
          </svg>
        </aside>
        <div className="b2-live__camera-controls" role="group" aria-label="星图视角控制">
          <button type="button" aria-label="缩小星图" onClick={() => zoomAtCenter(1 / 1.2)}>−</button>
          <button type="button" aria-label="适配全部节点" onClick={() => updateCamera(fitB2Camera(bounds))}>适配</button>
          <output aria-label="当前缩放比例">{Math.round(camera.zoom * 100)}%</output>
          <button type="button" aria-label="放大星图" onClick={() => zoomAtCenter(1.2)}>＋</button>
        </div>
        <p className="b2-live__hint">拖动预览通过 Realtime 广播，松手后持久化 · 来源语义保持锁定</p>
      </section>

      <B2Workbench
        model={model}
        callbacks={callbacks}
        stars={projection.stars}
        paths={projection.paths}
        selected={selected}
        activeTab={workbenchTab}
        onTabChange={setWorkbenchTab}
        onOpenStructuredView={onOpenStructuredView}
      />
    </main>
  );
}

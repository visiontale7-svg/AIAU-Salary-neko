import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { decodeHaloAssets } from "./halo-assets";
import {
  B2_MOTION_DURATIONS,
  NODE_APPEARANCE_PARTICLES,
  sampleB2Motion,
  useB2MotionTimeline,
  type B2MotionChannels,
  type B2MotionSequence,
  type MotionPlayback,
} from "./b2-motion";
import { StarAura, StarBody, type StarOpticsSpec } from "./StarOptics";
import "./b2-motion-lab.css";

type LabStatus = "loading" | "ready" | "fatal";
type LabSequence = "idle" | B2MotionSequence;
type MotionPreference = "system" | "full" | "reduced";
type InspectionScale = 1 | 2;

interface MotionLabQuery {
  sequence: LabSequence;
  fixedTimeMs?: number;
  preference: MotionPreference;
}

export interface B2MotionLabProps {
  /** Test and embed seam. The normal route reads window.location.search. */
  search?: string;
}

type MotionVars = CSSProperties & {
  "--motion-core-opacity"?: number;
  "--motion-shell-opacity"?: number;
  "--motion-selected-handoff"?: number;
};

const SOURCE_SPEC: StarOpticsSpec = {
  family: "source",
  tone: "blue",
  assetKey: "source-blue-v0",
  energy: 2,
  shellRadius: 12.5,
  coreSize: 6.8,
};

const PARENT_SPEC: StarOpticsSpec = {
  ...SOURCE_SPEC,
  assetKey: "source-blue-v1",
};

const DEVIN_SPEC: StarOpticsSpec = {
  family: "devin",
  tone: "silver",
  energy: 2,
  shellRadius: 8,
  coreSize: 6.2,
};

const STAGE_PATH = "M 174 231 C 296 206, 458 208, 666 222";
const PARENT = { x: 174, y: 231 } as const;
const TARGET = { x: 666, y: 222 } as const;

const SEQUENCE_OPTIONS: ReadonlyArray<{
  id: LabSequence | "devin-event" | "devin-stale";
  eyebrow: string;
  label: string;
  disabled?: boolean;
}> = [
  { id: "idle", eyebrow: "SETTLED", label: "Idle" },
  { id: "selected-focus", eyebrow: "520 MS", label: "Selected" },
  { id: "node-appearing", eyebrow: "1450 MS", label: "新节点生成" },
  { id: "devin-event", eyebrow: "850 MS", label: "Devin Event" },
  { id: "devin-stale", eyebrow: "1600 MS", label: "Devin Stale" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseInteger(value: string | null): number | undefined {
  if (value === null || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseB2MotionLabQuery(search: string): MotionLabQuery {
  const query = new URLSearchParams(search);
  const publicSequence = query.get("sequence");
  const sequence: LabSequence = publicSequence === "selected"
    ? "selected-focus"
    : publicSequence === "new-node"
      ? "node-appearing"
      : publicSequence === "devin-event"
        ? "devin-event"
        : publicSequence === "devin-stale"
          ? "devin-stale"
      : "idle";

  const preference: MotionPreference = query.get("motion") === "reduced"
    ? "reduced"
    : query.get("motion") === "full"
      ? "full"
      : "system";

  const requestedTime = parseInteger(query.get("time"));
  const fixedTimeMs = sequence !== "idle" && requestedTime !== undefined
    ? clamp(requestedTime, 0, B2_MOTION_DURATIONS[sequence])
    : undefined;

  return { sequence, fixedTimeMs, preference };
}

function useSystemReducedMotion(): boolean {
  const getValue = () => typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [reduced, setReduced] = useState(getValue);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}

function sequenceTitle(sequence: LabSequence): string {
  if (sequence === "selected-focus") return "Selected · 一次聚焦";
  if (sequence === "node-appearing") return "New Node · 定向凝结";
  if (sequence === "devin-event") return "Devin Event · 真实事件抵达";
  if (sequence === "devin-stale") return "Devin Stale · 能量静默衰减";
  return "Idle · 稳定静止";
}

function sequenceDescription(sequence: LabSequence): string {
  if (sequence === "selected-focus") {
    return "空气光轻抬，聚焦环收束，再交给静态双环；白核保持稳定。";
  }
  if (sequence === "node-appearing") {
    return "路径前锋先抵达，12 个固定微粒向连接方向凝结，最后建立星体与标签。";
  }
  if (sequence === "devin-event") {
    return "单个事件包沿关系抵达 Devin 节点，菱形核心与近场 haze 只短促提亮一次。";
  }
  if (sequence === "devin-stale") {
    return "没有新事件包；临时能量缓慢退至 40%，暖灰断环出现后保持静止。";
  }
  return "正式节点没有统一呼吸。只有明确的用户动作或真实事件才触发动效。";
}

function phaseLabel(sequence: LabSequence, elapsedMs: number): string {
  if (sequence === "selected-focus") {
    if (elapsedMs < 180) return "能量包络聚焦";
    if (elapsedMs < 520) return "交接静态选中态";
    return "Selected steady";
  }
  if (sequence === "node-appearing") {
    if (elapsedMs < 280) return "路径前锋";
    if (elapsedMs < 620) return "粒子凝结";
    if (elapsedMs < 1050) return "核心与能量壳建立";
    if (elapsedMs < 1450) return "标签显现";
    return "New node settled";
  }
  if (sequence === "devin-event") {
    if (elapsedMs < 580) return "事件包沿关系传播";
    if (elapsedMs < 700) return "事件抵达 · 核心提亮";
    if (elapsedMs < 850) return "近场能量回落";
    return "Event settled";
  }
  if (sequence === "devin-stale") {
    if (elapsedMs < 360) return "等待新事件";
    if (elapsedMs < 1400) return "能量衰减 · 断环建立";
    if (elapsedMs < 1600) return "进入静默状态";
    return "Stale steady";
  }
  return "完全静止";
}

function playbackLabel(playback: MotionPlayback): string {
  if (playback === "playing") return "播放中";
  if (playback === "paused") return "已暂停";
  if (playback === "finished") return "静态终帧";
  return "Idle";
}

function particlePosition(
  particle: (typeof NODE_APPEARANCE_PARTICLES)[number],
  elapsedMs: number,
): { x: number; y: number; opacity: number } {
  const local = clamp((elapsedMs - (280 + particle.delayMs)) / particle.durationMs, 0, 1);
  const eased = local * local * (3 - 2 * local);
  const visibility = local <= 0 || local >= 1 ? 0 : Math.sin(local * Math.PI);
  return {
    x: TARGET.x + particle.startX + (particle.endX - particle.startX) * eased,
    y: TARGET.y + particle.startY + (particle.endY - particle.startY) * eased,
    opacity: visibility,
  };
}

function devinPacketPoint(progress: number): { x: number; y: number } {
  const t = clamp(progress, 0, 1);
  const u = 1 - t;
  return {
    x: u ** 3 * 174 + 3 * u ** 2 * t * 296 + 3 * u * t ** 2 * 458 + t ** 3 * 666,
    y: u ** 3 * 231 + 3 * u ** 2 * t * 206 + 3 * u * t ** 2 * 208 + t ** 3 * 222,
  };
}

function MotionStage({
  sequence,
  channels,
  elapsedMs,
  reducedMotion,
  scale,
}: {
  sequence: LabSequence;
  channels: B2MotionChannels;
  elapsedMs: number;
  reducedMotion: boolean;
  scale: InspectionScale;
}) {
  const isSelected = sequence === "selected-focus";
  const isAppearing = sequence === "node-appearing";
  const isDevinEvent = sequence === "devin-event";
  const isDevinStale = sequence === "devin-stale";
  const isDevinSequence = isDevinEvent || isDevinStale;
  const eventPacketPoint = devinPacketPoint(channels.pathProgress);
  const selectedState = isSelected ? "selected" : "idle";
  const bodyStyle: MotionVars = isAppearing
    ? {
        "--motion-core-opacity": channels.coreOpacity,
        "--motion-shell-opacity": channels.shellOpacity,
      }
    : isSelected
      ? { "--motion-selected-handoff": channels.selectedHandoff }
      : {};
  const viewBox = scale === 2 ? "426 102 480 230" : "0 0 960 460";

  return (
    <div className={`motion-lab__stage-frame motion-lab__stage-frame--${scale}x`}>
      <svg
        className="motion-lab__stage-svg"
        viewBox={viewBox}
        role="img"
        aria-label="Motion stage"
        data-motion-stage-state={sequence}
        data-motion-stage-scale={scale}
      >
        <defs>
          <linearGradient id="motion-lab-path-core" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#4c93ef" stopOpacity=".62" />
            <stop offset=".78" stopColor="#9bc9ff" stopOpacity=".96" />
            <stop offset="1" stopColor="#ecf7ff" stopOpacity="1" />
          </linearGradient>
          <radialGradient id="motion-lab-focus-glow">
            <stop offset="0" stopColor="#e8f6ff" stopOpacity=".32" />
            <stop offset=".45" stopColor="#76b7ff" stopOpacity=".12" />
            <stop offset="1" stopColor="#4b9cff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="motion-lab-devin-event-glow">
            <stop offset="0" stopColor="#f4fbff" stopOpacity=".26" />
            <stop offset=".35" stopColor="#b9ddff" stopOpacity=".13" />
            <stop offset=".72" stopColor="#6996c3" stopOpacity=".045" />
            <stop offset="1" stopColor="#466680" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="motion-lab-devin-energy-glow">
            <stop offset="0" stopColor="#e8eef3" stopOpacity=".2" />
            <stop offset=".42" stopColor="#a9b6c1" stopOpacity=".085" />
            <stop offset="1" stopColor="#727b82" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g data-motion-pass="path-atmosphere" className="motion-lab__pass motion-lab__path-atmosphere">
          <path d={STAGE_PATH} />
        </g>

        <g data-motion-pass="star-aura" className="motion-lab__pass">
          <StarAura x={PARENT.x} y={PARENT.y} spec={PARENT_SPEC} />
          {!isDevinSequence ? (
            <g opacity={isAppearing ? channels.auraOpacity : 1}>
              <StarAura x={TARGET.x} y={TARGET.y} spec={SOURCE_SPEC} />
            </g>
          ) : null}
        </g>

        <g data-motion-pass="path-core" className="motion-lab__pass motion-lab__path-core">
          <path
            d={STAGE_PATH}
            pathLength="1"
            opacity={isAppearing ? Math.max(0.08, channels.pathProgress * 0.9) : 1}
            strokeDasharray={isAppearing ? `${channels.pathProgress} ${1 - channels.pathProgress}` : undefined}
          />
        </g>

        <g data-motion-pass="motion-path-overlay" className="motion-lab__pass motion-lab__motion-path">
          {isAppearing ? (
            <>
              <path
                className="motion-lab__path-reveal"
                data-motion-path-reveal="true"
                d={STAGE_PATH}
                pathLength="1"
                strokeDasharray={`${channels.pathProgress} ${1 - channels.pathProgress}`}
              />
              <path
                className="motion-lab__path-packet motion-lab__path-packet--air"
                data-motion-path-packet="true"
                d={STAGE_PATH}
                pathLength="1"
                opacity={channels.pathPacketOpacity}
                strokeDasharray=".045 .955"
                strokeDashoffset={1 - channels.pathProgress}
              />
              <path
                className="motion-lab__path-packet motion-lab__path-packet--core"
                d={STAGE_PATH}
                pathLength="1"
                opacity={channels.pathPacketOpacity}
                strokeDasharray=".018 .982"
                strokeDashoffset={1 - channels.pathProgress}
              />
            </>
          ) : isDevinEvent && channels.pathPacketOpacity > 0 ? (
            <g
              className="motion-lab__devin-event-packet"
              data-motion-event-packet="true"
              data-motion-path-packet="devin-event"
              opacity={channels.pathPacketOpacity}
              transform={`translate(${eventPacketPoint.x} ${eventPacketPoint.y})`}
            >
              <circle className="motion-lab__devin-event-packet-air" r="9" />
              <circle className="motion-lab__devin-event-packet-shell" r="3.4" />
              <rect className="motion-lab__devin-event-packet-core" x="-1.8" y="-1.8" width="3.6" height="3.6" rx=".5" transform="rotate(45)" />
            </g>
          ) : null}
        </g>

        <g data-motion-pass="path-particles" className="motion-lab__pass motion-lab__particles">
          {NODE_APPEARANCE_PARTICLES.map((particle) => {
            const position = particlePosition(particle, elapsedMs);
            return (
              <circle
                key={particle.id}
                data-motion-particle={particle.id}
                cx={position.x}
                cy={position.y}
                r={particle.size}
                opacity={isAppearing ? position.opacity * channels.particleOpacity : 0}
              />
            );
          })}
        </g>

        <g data-motion-pass="star-body" className="motion-lab__pass">
          <StarBody x={PARENT.x} y={PARENT.y} spec={PARENT_SPEC} />
          {isDevinSequence ? (
            <g
              data-motion-devin-body="true"
              opacity={isDevinStale ? channels.devinBodyOpacity : 1}
            >
              <StarBody x={TARGET.x} y={TARGET.y} spec={DEVIN_SPEC} />
            </g>
          ) : (
            <g
              className={isAppearing ? "motion-lab__body--appearing" : isSelected ? "motion-lab__body--selected" : undefined}
              style={bodyStyle}
            >
              <StarBody x={TARGET.x} y={TARGET.y} spec={SOURCE_SPEC} state={selectedState} />
            </g>
          )}
        </g>

        <g data-motion-pass="motion-star-overlay" className="motion-lab__pass motion-lab__motion-star">
          {isSelected ? (
            <>
              <g opacity={channels.auraBoost * 0.12}>
                <StarAura x={TARGET.x} y={TARGET.y} spec={SOURCE_SPEC} />
              </g>
              <g
                className="motion-lab__focus-ring"
                opacity={channels.focusRingOpacity}
                transform={`translate(${TARGET.x} ${TARGET.y}) scale(${channels.focusRingScale}) translate(${-TARGET.x} ${-TARGET.y})`}
              >
                <circle className="motion-lab__focus-ring-air" cx={TARGET.x} cy={TARGET.y} r="27.5" />
                <circle className="motion-lab__focus-ring-core" cx={TARGET.x} cy={TARGET.y} r="27.5" />
              </g>
            </>
          ) : isDevinEvent ? (
            <g
              className="motion-lab__devin-event-lift"
              data-motion-devin-event-lift="true"
              opacity={channels.devinHazeBoost}
              transform={`translate(${TARGET.x} ${TARGET.y})`}
            >
              <circle className="motion-lab__devin-event-haze" r="31" />
              <rect className="motion-lab__devin-event-shell" x="-10" y="-10" width="20" height="20" rx="2" transform="rotate(45)" />
              <rect className="motion-lab__devin-event-core" x="-4" y="-4" width="8" height="8" rx="1" transform="rotate(45)" />
            </g>
          ) : isDevinStale ? (
            <g data-motion-devin-stale="true" transform={`translate(${TARGET.x} ${TARGET.y})`}>
              <g
                className="motion-lab__devin-energy"
                data-motion-devin-energy="true"
                opacity={channels.devinEnergyOpacity}
              >
                <circle className="motion-lab__devin-energy-air" r="28" />
                <rect className="motion-lab__devin-energy-shell" x="-9" y="-9" width="18" height="18" rx="2" transform="rotate(45)" />
              </g>
              <circle
                className="motion-lab__devin-stale-ring"
                data-motion-stale-ring="true"
                r="25"
                opacity={channels.staleRingOpacity}
                pathLength="1"
                strokeDasharray=".09 .055 .025 .07 .13 .08 .045 .505"
              />
            </g>
          ) : null}
        </g>

        <g data-motion-pass="star-overlay" className="motion-lab__pass motion-lab__labels">
          <g transform={`translate(${PARENT.x - 16} ${PARENT.y + 50})`}>
            <text className="motion-lab__node-index">2</text>
            <text className="motion-lab__node-title" x="20">核心体验</text>
            <text className="motion-lab__node-meta" x="20" y="19">08-10 11:20 · 已确认来源</text>
          </g>
          <g
            transform={`translate(${TARGET.x - 16} ${TARGET.y + 50})`}
            opacity={isAppearing ? channels.labelOpacity : 1}
          >
            <text className="motion-lab__node-index">{isDevinSequence ? "3.2" : "2.3"}</text>
            <text className="motion-lab__node-title" x="30">{isDevinSequence ? "数据与隐私" : "协作结论"}</text>
            <text className="motion-lab__node-meta" x="30" y="19">
              {isDevinSequence ? "Devin 输出 · 确定性视觉 Fixture" : "刚刚 · 团队新增"}
            </text>
          </g>
          {isDevinSequence ? (
            <g
              className="motion-lab__fixture-badge"
              data-motion-devin-fixture="true"
              transform={`translate(${TARGET.x + 34} ${TARGET.y - 43})`}
            >
              <rect x="0" y="0" width="116" height="19" rx="9.5" />
              <circle cx="10" cy="9.5" r="2.3" />
              <text x="18" y="12.7">视觉 Fixture · 非实时状态</text>
            </g>
          ) : null}
          {isAppearing && reducedMotion ? (
            <g className="motion-lab__new-badge" data-motion-static-new="true" transform={`translate(${TARGET.x + 24} ${TARGET.y - 31})`}>
              <rect x="0" y="0" width="41" height="18" rx="9" />
              <text x="20.5" y="12.2" textAnchor="middle">新增</text>
            </g>
          ) : null}
        </g>
      </svg>
    </div>
  );
}

function TimelineLegend({ sequence, elapsedMs }: { sequence: LabSequence; elapsedMs: number }) {
  if (sequence === "idle") {
    return <div className="motion-lab__timeline-empty">Idle 没有时间轴，也不会启动 animation frame。</div>;
  }
  const duration = B2_MOTION_DURATIONS[sequence];
  const markers = sequence === "selected-focus"
    ? [{ at: 0, label: "触发" }, { at: 180, label: "聚焦" }, { at: 520, label: "交接" }]
    : sequence === "node-appearing"
      ? [{ at: 0, label: "路径" }, { at: 280, label: "凝结" }, { at: 620, label: "点亮" }, { at: 1050, label: "标签" }, { at: 1450, label: "完成" }]
      : sequence === "devin-event"
        ? [{ at: 0, label: "事件" }, { at: 580, label: "抵达" }, { at: 700, label: "回落" }, { at: 850, label: "完成" }]
        : [{ at: 0, label: "等待" }, { at: 360, label: "断环" }, { at: 1400, label: "静默" }, { at: 1600, label: "保持" }];
  return (
    <div className="motion-lab__timeline-legend" aria-hidden="true">
      <div className="motion-lab__timeline-progress" style={{ width: `${(elapsedMs / duration) * 100}%` }} />
      {markers.map((marker) => (
        <span key={marker.at} style={{ left: `${(marker.at / duration) * 100}%` }}>
          <i />
          <b>{marker.label}</b>
        </span>
      ))}
    </div>
  );
}

function MotionWorkbench({
  sequence,
  reducedMotion,
  fixedTimeMs,
  scale,
  status,
}: {
  sequence: LabSequence;
  reducedMotion: boolean;
  fixedTimeMs?: number;
  scale: InspectionScale;
  status: LabStatus;
}) {
  const kernelSequence: B2MotionSequence = sequence === "idle"
    ? "selected-focus"
    : sequence;
  const frozen = status !== "ready" || sequence === "idle" || fixedTimeMs !== undefined;
  const timeline = useB2MotionTimeline({
    sequence: kernelSequence,
    initialTimeMs: fixedTimeMs ?? 0,
    reducedMotion,
    frozen,
    autoPlay: false,
  });
  const idleSnapshot = useMemo(() => sampleB2Motion("selected-focus", 0), []);
  const snapshot = sequence === "idle"
    ? { ...idleSnapshot, elapsedMs: 0, playback: "idle" as const, reducedMotion }
    : timeline.snapshot;
  const playback: MotionPlayback = fixedTimeMs !== undefined ? "paused" : snapshot.playback;
  const controlsLocked = sequence === "idle" || reducedMotion || fixedTimeMs !== undefined || status !== "ready";

  return (
    <section
      className="motion-lab__workbench"
      aria-labelledby="motion-stage-title"
      data-motion-sequence={status === "ready" ? sequence : undefined}
      data-motion-time-ms={status === "ready" ? String(Math.round(snapshot.elapsedMs)) : undefined}
      data-motion-playback={status === "ready" ? playback : undefined}
      data-motion-reduced={status === "ready" ? String(reducedMotion) : undefined}
    >
      <div className="motion-lab__stage-heading">
        <div>
          <p>SEMANTIC MOTION STAGE</p>
          <h2 id="motion-stage-title">{sequenceTitle(sequence)}</h2>
          <span>{sequenceDescription(sequence)}</span>
        </div>
        <div className="motion-lab__readout" aria-live="polite">
          <span>{phaseLabel(sequence, snapshot.elapsedMs)}</span>
          <strong>{Math.round(snapshot.elapsedMs)} / {sequence === "idle" ? 0 : snapshot.durationMs} ms</strong>
        </div>
      </div>

      <MotionStage
        sequence={sequence}
        channels={snapshot.channels}
        elapsedMs={snapshot.elapsedMs}
        reducedMotion={reducedMotion}
        scale={scale}
      />

      <TimelineLegend sequence={sequence} elapsedMs={snapshot.elapsedMs} />

      <div className="motion-lab__transport" aria-label="Motion playback controls">
        <button type="button" onClick={timeline.replay} disabled={controlsLocked} aria-label="Replay animation">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.7 6.2A5.5 5.5 0 1 1 4.5 11M5.7 6.2V2.7M5.7 6.2H2.2" /></svg>
          Replay
        </button>
        <button
          type="button"
          onClick={playback === "playing" ? timeline.pause : timeline.resume}
          disabled={controlsLocked || playback === "finished"}
          aria-label={playback === "playing" ? "Pause animation" : "Resume animation"}
        >
          {playback === "playing" ? "Pause" : "Resume"}
        </button>
        <label className="motion-lab__range">
          <span className="sr-only">Timeline position</span>
          <input
            aria-label="Motion timeline"
            type="range"
            min="0"
            max={sequence === "idle" ? 0 : snapshot.durationMs}
            step="1"
            value={Math.round(snapshot.elapsedMs)}
            disabled={controlsLocked}
            onChange={(event) => timeline.seek(Number(event.currentTarget.value))}
          />
        </label>
        <output>{playbackLabel(playback)}</output>
        {fixedTimeMs !== undefined ? <span className="motion-lab__locked-frame">固定帧</span> : null}
      </div>
    </section>
  );
}

export function B2MotionLab({ search }: B2MotionLabProps) {
  const initialQuery = useMemo(
    () => parseB2MotionLabQuery(search ?? (typeof window === "undefined" ? "" : window.location.search)),
    [search],
  );
  const [status, setStatus] = useState<LabStatus>("loading");
  const [fatalMessage, setFatalMessage] = useState("");
  const [sequence, setSequence] = useState<LabSequence>(initialQuery.sequence);
  const [preference, setPreference] = useState<MotionPreference>(initialQuery.preference);
  const [scale, setScale] = useState<InspectionScale>(1);
  const systemReducedMotion = useSystemReducedMotion();
  const reducedMotion = preference === "reduced"
    || (preference === "system" && systemReducedMotion);

  useEffect(() => {
    let active = true;
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    Promise.all([fontsReady, decodeHaloAssets()])
      .then(() => {
        if (active) setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFatalMessage(error instanceof Error ? error.message : "Unknown motion lab asset error");
        setStatus("fatal");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main
      className="motion-lab"
      data-motion-lab="true"
      data-runtime="deterministic-visual-fixture"
      data-b2-ready={status === "ready" ? "true" : undefined}
    >
      <header className="motion-lab__header">
        <div>
          <p className="motion-lab__eyebrow">DIALOGUE ATLAS · MOTION LANGUAGE STUDY</p>
          <h1>星图动效实验室</h1>
          <p>只让明确的选择、生成与真实事件运动；静止仍是整个星图的默认状态。</p>
        </div>
        <div className={`motion-lab__asset-status motion-lab__asset-status--${status}`} role="status">
          <i />
          {status === "loading" ? "正在解码本地光学资产" : status === "ready" ? "字体与光晕已就绪" : "视觉验收已阻止"}
        </div>
      </header>

      {status === "fatal" ? (
        <section className="motion-lab__fatal" role="alert" aria-label="Motion lab asset fatal error">
          <h2>无法启动确定性动效实验室</h2>
          <p>{fatalMessage}</p>
          <p>页面没有启用网络或旧光晕回退；请先修复本地资源。</p>
        </section>
      ) : (
        <div className="motion-lab__layout" aria-busy={status !== "ready"}>
          <aside className="motion-lab__controls" aria-label="Motion lab settings">
            <section>
              <p className="motion-lab__control-kicker">SEQUENCE</p>
              <h2>语义状态</h2>
              <div className="motion-lab__sequence-list">
                {SEQUENCE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={sequence === option.id ? "is-active" : undefined}
                    aria-label={option.label}
                    aria-pressed={sequence === option.id}
                    disabled={option.disabled || status !== "ready" || initialQuery.fixedTimeMs !== undefined}
                    onClick={() => setSequence(option.id)}
                  >
                    <span>{option.label}</span>
                    <small>{option.eyebrow}</small>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <p className="motion-lab__control-kicker">ACCESSIBILITY</p>
              <h2>运动偏好</h2>
              <div className="motion-lab__segmented" role="group" aria-label="Motion preference">
                {(["system", "full", "reduced"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={mode}
                    aria-pressed={preference === mode}
                    className={preference === mode ? "is-active" : undefined}
                    onClick={() => setPreference(mode)}
                  >
                    {mode === "system" ? "系统" : mode === "full" ? "完整" : "减少"}
                  </button>
                ))}
              </div>
              <p className="motion-lab__control-note">
                {reducedMotion ? "最终静态语义帧；不位移、不脉冲。" : "使用一次性、可暂停的语义转场。"}
              </p>
            </section>

            <section>
              <p className="motion-lab__control-kicker">OPTICAL INSPECTION</p>
              <h2>检查倍率</h2>
              <div className="motion-lab__segmented" role="group" aria-label="Inspection scale">
                {([1, 2] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value * 100}% inspection`}
                    aria-pressed={scale === value}
                    className={scale === value ? "is-active" : undefined}
                    onClick={() => setScale(value)}
                  >
                    {value * 100}%
                  </button>
                ))}
              </div>
            </section>

            <div className="motion-lab__constraint">
              <span>STATIC BY DEFAULT</span>
              <p>不做全图同步呼吸，不持续放大白核，也不使用循环跑马灯。</p>
            </div>
          </aside>

          <MotionWorkbench
            key={`${reducedMotion}-${initialQuery.fixedTimeMs ?? "live"}`}
            sequence={sequence}
            reducedMotion={reducedMotion}
            fixedTimeMs={initialQuery.fixedTimeMs}
            scale={scale}
            status={status}
          />
        </div>
      )}
    </main>
  );
}

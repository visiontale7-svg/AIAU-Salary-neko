import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./b2-visual.css";
import avatarOne from "./assets/b2-avatar-1.png";
import avatarTwo from "./assets/b2-avatar-2.png";
import avatarThree from "./assets/b2-avatar-3.png";
import { B2StarfieldCanvas } from "./B2StarfieldCanvas";
import { decodeHaloAssets, type HaloAssetKey } from "./halo-assets";
import {
  B2_MOTION_DURATIONS,
  NODE_APPEARANCE_PARTICLES,
  sampleB2Motion,
  useB2MotionTimeline,
  type B2MotionSnapshot,
} from "./b2-motion";
import {
  completeActiveB2MotionTrigger,
  createB2MotionRuntimeState,
  enqueueB2MotionTrigger,
  type B2MotionRuntimeState,
  type B2MotionTrigger,
} from "./b2-motion-runtime";
import { StarAura, StarBody, type StarOpticsSpec } from "./StarOptics";

type Tone = "blue" | "violet" | "cyan" | "green" | "orange" | "red" | "silver";
type NodeKind = "source" | "team" | "question" | "candidate" | "devin";
type WorkbenchTab = "conversation" | "node" | "execution";

interface VisualStar {
  id: string;
  x: number;
  y: number;
  tone: Tone;
  level: 1 | 2 | 3;
  kind: NodeKind;
  label?: string;
  time?: string;
  detail?: string;
  author?: string;
  labelDx?: number;
  labelDy?: number;
  labelAnchor?: "start" | "middle" | "end";
}

interface GraphSpark {
  x: number;
  y: number;
  size?: number;
  shape?: "dot" | "diamond";
}

interface GraphPathSpec {
  id: string;
  d: string;
  tone: Tone;
  main?: boolean;
  dashed?: boolean;
  sparks?: readonly GraphSpark[];
}

interface FullGraphMotionState {
  selectionTargetId: string;
  departingSelectionId: string;
  selectionSnapshot: B2MotionSnapshot;
  demoActive: B2MotionTrigger | null;
  demoSnapshot: B2MotionSnapshot;
  demoPlayedEventKeys: readonly string[];
  reducedMotion: boolean;
  motionDemo: boolean;
}

type MotionStyle = CSSProperties & {
  "--b2-motion-core-opacity"?: number;
  "--b2-motion-shell-opacity"?: number;
  "--b2-motion-selected-handoff"?: number;
};

const TONES: Record<Tone, string> = {
  blue: "#3f8ff8",
  violet: "#8e5be8",
  cyan: "#36bac0",
  green: "#8fbd71",
  orange: "#e39a3f",
  red: "#df655a",
  silver: "#dbe5f1",
};

const DIAMOND_POINTS = "0,-1 1,0 0,1 -1,0";

const AUTHOR_AVATARS: Record<string, string> = {
  "张明 远程编辑": avatarOne,
  "李想 远程查看": avatarTwo,
  "王颖 远程编辑": avatarThree,
};

const STARS: VisualStar[] = [
  { id: "root", x: 80, y: 488, tone: "blue", level: 3, kind: "source", label: "0 · 起点", time: "08-10 10:15", detail: "问题定义与范围", labelDx: -16, labelDy: 48 },
  { id: "value", x: 213, y: 432, tone: "blue", level: 2, kind: "source", label: "1 · 用户价值", time: "08-10 10:42", author: "张明 远程编辑", labelDx: 0, labelDy: 58 },
  { id: "experience", x: 381, y: 434, tone: "blue", level: 2, kind: "source", label: "2 · 核心体验", time: "08-10 11:20", author: "李想 远程查看", labelDx: 0, labelDy: 58 },
  { id: "feasibility", x: 539, y: 449, tone: "blue", level: 2, kind: "source", label: "3 · 技术可行性", time: "08-10 12:05", labelDx: -8, labelDy: 58 },
  { id: "risk", x: 688, y: 461, tone: "blue", level: 2, kind: "source", label: "4 · 机会与风险", time: "08-10 13:15", author: "王颖 远程编辑", labelDx: -6, labelDy: 58 },
  { id: "next", x: 967, y: 543, tone: "blue", level: 2, kind: "source", label: "5 · 下一步计划", time: "08-10 14:20", labelDx: 0, labelDy: 52 },
  { id: "spine-mid", x: 837, y: 511, tone: "blue", level: 2, kind: "source" },

  { id: "portrait", x: 301, y: 203, tone: "violet", level: 1, kind: "team", label: "1.1 用户画像", time: "08-10 10:58", labelDx: 22, labelDy: 0 },
  { id: "pain", x: 289, y: 288, tone: "violet", level: 1, kind: "team", label: "1.2 场景与痛点", time: "08-10 11:05", labelDx: 22, labelDy: 0 },
  { id: "violet-leaf", x: 226, y: 358, tone: "violet", level: 1, kind: "team" },

  { id: "cyan-junction", x: 349, y: 523, tone: "cyan", level: 1, kind: "team" },
  { id: "interaction", x: 272, y: 607, tone: "cyan", level: 1, kind: "team", label: "2.1 交互流程", time: "08-10 11:35", author: "张明 远程编辑", labelDx: -40, labelDy: 42 },
  { id: "emotion", x: 408, y: 640, tone: "cyan", level: 1, kind: "team", label: "2.2 情感化体验", time: "08-10 11:50", labelDx: -30, labelDy: 44 },

  { id: "stack", x: 540, y: 155, tone: "green", level: 1, kind: "team", label: "3.1 技术选型", time: "08-10 12:15", labelDx: 22, labelDy: 0 },
  { id: "privacy", x: 585, y: 244, tone: "silver", level: 1, kind: "devin", label: "3.2 数据与隐私", time: "08-10 12:30", detail: "Devin 输出 · 最后更新 2 分钟前", labelDx: 24, labelDy: 0 },
  { id: "cost", x: 565, y: 332, tone: "green", level: 1, kind: "team", label: "3.3 成本评估", time: "08-10 12:50", labelDx: 22, labelDy: 0 },

  { id: "orange-junction", x: 649, y: 542, tone: "orange", level: 1, kind: "team" },
  { id: "market", x: 685, y: 625, tone: "orange", level: 1, kind: "team", label: "4.1 市场机会", time: "08-10 13:25", labelDx: 24, labelDy: 0 },
  { id: "challenge", x: 731, y: 726, tone: "red", level: 1, kind: "question", label: "4.2 风险与挑战", time: "08-10 13:40", labelDx: 30, labelDy: 0 },

  { id: "candidate", x: 942, y: 225, tone: "silver", level: 1, kind: "candidate", label: "候选观点", time: "居中设计可能降低\n新用户认知负荷", detail: "正在归位", labelDx: 22, labelDy: -8 },
];

const STAR_HALO_ASSET_KEYS: Readonly<Record<string, HaloAssetKey>> = {
  root: "root-blue-v0",
  value: "source-blue-v1",
  experience: "source-blue-v0",
  feasibility: "source-blue-v2",
  risk: "source-blue-v1",
  next: "source-blue-v2",
  "spine-mid": "source-blue-v0",
  portrait: "team-violet-v0",
  pain: "team-violet-v1",
  "violet-leaf": "team-violet-v0",
  "cyan-junction": "team-cyan-v0",
  interaction: "team-cyan-v1",
  emotion: "team-cyan-v0",
  stack: "team-green-v0",
  cost: "team-green-v1",
  "orange-junction": "team-orange-v0",
  market: "team-orange-v1",
  challenge: "question-red-v0",
  candidate: "candidate-silver-v0",
};

function buildStarOpticsSpec(star: VisualStar): StarOpticsSpec {
  if (star.kind === "devin") {
    return {
      family: "devin",
      tone: "silver",
      energy: 2,
      shellRadius: 10,
      coreSize: 5,
    };
  }

  const assetKey = STAR_HALO_ASSET_KEYS[star.id];
  if (!assetKey) {
    throw new Error(`Missing deterministic full-graph halo assignment for "${star.id}".`);
  }

  if (star.id === "root") {
    return { family: "root", tone: "blue", assetKey, energy: 2, shellRadius: 13.5, coreSize: 7 };
  }
  if (star.kind === "source") {
    return { family: "source", tone: star.tone, assetKey, energy: 2, shellRadius: 12.5, coreSize: 6 };
  }
  if (star.kind === "team") {
    return { family: "team", tone: star.tone, assetKey, energy: 2, shellRadius: 8, coreSize: 4.5 };
  }
  if (star.kind === "question") {
    return { family: "question", tone: "red", assetKey, energy: 2, shellRadius: 9, coreSize: 4.8 };
  }
  return { family: "candidate", tone: "silver", assetKey, energy: 2, shellRadius: 9, coreSize: 4.8 };
}

const STAR_OPTICS_BY_ID = new Map(STARS.map((star) => [star.id, buildStarOpticsSpec(star)]));

function opticsFor(star: VisualStar): StarOpticsSpec {
  const spec = STAR_OPTICS_BY_ID.get(star.id);
  if (!spec) throw new Error(`Missing star optics spec for "${star.id}".`);
  return spec;
}

const MAIN_PATH = "M 0 548 C 28 521 58 496 80 488 C 125 471 171 442 213 432 C 274 418 333 420 381 434 C 440 442 491 448 539 449 C 594 447 642 448 688 461 C 739 467 790 488 837 511 C 887 518 928 539 967 543";

const GRAPH_PATHS: readonly GraphPathSpec[] = [
  {
    id: "main",
    d: MAIN_PATH,
    tone: "blue",
    main: true,
    sparks: [
      { x: 34, y: 521, size: 1.2 }, { x: 58, y: 499, size: 1.7, shape: "diamond" },
      { x: 111, y: 476 }, { x: 158, y: 452, size: 1.35 }, { x: 260, y: 423, size: 1.6, shape: "diamond" },
      { x: 316, y: 423 }, { x: 425, y: 439, size: 1.45 }, { x: 485, y: 447 },
      { x: 591, y: 447, size: 1.55, shape: "diamond" }, { x: 635, y: 451 },
      { x: 735, y: 470, size: 1.25 }, { x: 785, y: 488 }, { x: 880, y: 520, size: 1.5, shape: "diamond" },
      { x: 918, y: 533 },
    ],
  },
  {
    id: "violet-upper",
    d: "M213 431 C210 404 211 379 226 358 C245 333 270 307 289 288",
    tone: "violet",
    sparks: [{ x: 213, y: 394 }, { x: 245, y: 333, size: 1.15 }],
  },
  {
    id: "violet-lower",
    d: "M289 288 C292 255 297 226 301 203",
    tone: "violet",
    sparks: [{ x: 294, y: 242, shape: "diamond" }],
  },
  {
    id: "cyan",
    d: "M381 434 C369 466 360 492 349 523 C317 553 291 582 272 607 M349 523 C370 563 390 606 408 640",
    tone: "cyan",
    sparks: [{ x: 365, y: 474 }, { x: 332, y: 539, shape: "diamond" }, { x: 296, y: 577 }, { x: 378, y: 584, size: 1.15 }],
  },
  {
    id: "green",
    d: "M539 449 C541 409 551 370 565 332 C573 302 578 268 585 244 C562 225 545 190 540 155",
    tone: "green",
    sparks: [{ x: 542, y: 408 }, { x: 553, y: 365, shape: "diamond" }, { x: 566, y: 286 }, { x: 548, y: 195, size: 1.2 }],
  },
  {
    id: "orange",
    d: "M688 461 C682 499 668 526 649 542 C660 575 671 603 685 625 C705 664 719 698 731 726",
    tone: "orange",
    sparks: [{ x: 677, y: 500 }, { x: 651, y: 550, shape: "diamond" }, { x: 669, y: 597 }, { x: 707, y: 675, size: 1.2 }],
  },
  {
    id: "candidate",
    d: "M540 595 C682 582 797 515 874 384 C900 337 919 282 939 226",
    tone: "silver",
    dashed: true,
  },
];

const CANDIDATE_PATH = GRAPH_PATHS.find((path) => path.id === "candidate")!;
const DEVIN_EVENT_PATH = "M540 155 C545 190 562 225 585 244";
const DEMO_EVENT_KEYS = {
  candidate: "b2-demo:candidate-appearing:1",
  devinEvent: "b2-demo:devin-event:2",
  devinStale: "b2-demo:devin-stale:3",
} as const;
const DEMO_TRIGGERS: readonly B2MotionTrigger[] = [
  {
    eventKey: DEMO_EVENT_KEYS.candidate,
    sequence: "node-appearing",
    targetId: "candidate",
    pathId: "candidate",
    activitySeq: 1,
  },
  {
    eventKey: DEMO_EVENT_KEYS.devinEvent,
    sequence: "devin-event",
    targetId: "privacy",
    pathId: "stack-to-privacy",
    activitySeq: 2,
  },
  {
    eventKey: DEMO_EVENT_KEYS.devinStale,
    sequence: "devin-stale",
    targetId: "privacy",
    activitySeq: 3,
  },
];

const FULL_DEMO_DURATION_MS = 5300;

type FullDemoPhase =
  | "idle"
  | "prepare"
  | "candidate"
  | "candidate-settled"
  | "devin-event"
  | "event-settled"
  | "devin-stale"
  | "finished";

interface FullDemoFrame {
  phase: FullDemoPhase;
  active: B2MotionTrigger | null;
  snapshot: B2MotionSnapshot;
}

function createMotionDemoRuntime(enabled: boolean): B2MotionRuntimeState {
  let state = createB2MotionRuntimeState();
  if (!enabled) return state;
  for (const trigger of DEMO_TRIGGERS) {
    state = enqueueB2MotionTrigger(state, trigger).state;
  }
  return state;
}

function runtimeAtDemoTime(elapsedMs: number): B2MotionRuntimeState {
  let state = createMotionDemoRuntime(true);
  if (elapsedMs >= 1850) state = completeActiveB2MotionTrigger(state, DEMO_EVENT_KEYS.candidate);
  if (elapsedMs >= 3200) state = completeActiveB2MotionTrigger(state, DEMO_EVENT_KEYS.devinEvent);
  if (elapsedMs >= FULL_DEMO_DURATION_MS) state = completeActiveB2MotionTrigger(state, DEMO_EVENT_KEYS.devinStale);
  return state;
}

function fullDemoFrameAt(elapsedMs: number, reducedMotion: boolean): FullDemoFrame {
  const idle = sampleB2Motion("selected-focus", 0, false);
  if (reducedMotion || elapsedMs >= FULL_DEMO_DURATION_MS) {
    return { phase: "finished", active: null, snapshot: idle };
  }
  if (elapsedMs < 400) return { phase: "prepare", active: null, snapshot: idle };
  if (elapsedMs < 1850) {
    return {
      phase: "candidate",
      active: DEMO_TRIGGERS[0],
      snapshot: sampleB2Motion("node-appearing", elapsedMs - 400),
    };
  }
  if (elapsedMs < 2350) return { phase: "candidate-settled", active: null, snapshot: idle };
  if (elapsedMs < 3200) {
    return {
      phase: "devin-event",
      active: DEMO_TRIGGERS[1],
      snapshot: sampleB2Motion("devin-event", elapsedMs - 2350),
    };
  }
  if (elapsedMs < 3700) return { phase: "event-settled", active: null, snapshot: idle };
  return {
    phase: "devin-stale",
    active: DEMO_TRIGGERS[2],
    snapshot: sampleB2Motion("devin-stale", elapsedMs - 3700),
  };
}

function parseMotionTime(search: string): number | undefined {
  const value = new URLSearchParams(search).get("motionTime");
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return undefined;
  return Math.min(FULL_DEMO_DURATION_MS, Math.max(0, parsed));
}

function useFullDemoClock({
  enabled,
  fixedTimeMs,
  reducedMotion,
}: {
  enabled: boolean;
  fixedTimeMs?: number;
  reducedMotion: boolean;
}): { elapsedMs: number; playback: "idle" | "playing" | "paused" | "finished" } {
  const initial = reducedMotion ? FULL_DEMO_DURATION_MS : fixedTimeMs ?? 0;
  const [elapsedMs, setElapsedMs] = useState(initial);
  const elapsedRef = useRef(initial);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const next = reducedMotion ? FULL_DEMO_DURATION_MS : fixedTimeMs ?? 0;
    elapsedRef.current = next;
    setElapsedMs(next);
  }, [fixedTimeMs, reducedMotion]);

  useEffect(() => {
    if (!enabled || fixedTimeMs !== undefined || reducedMotion || !visible || elapsedRef.current >= FULL_DEMO_DURATION_MS) return;
    let frameId = 0;
    let active = true;
    let previous: number | undefined;
    const tick = (timestamp: number) => {
      if (!active) return;
      if (previous === undefined) {
        previous = timestamp;
        frameId = window.requestAnimationFrame(tick);
        return;
      }
      const delta = Math.min(100, Math.max(0, timestamp - previous));
      previous = timestamp;
      const next = Math.min(FULL_DEMO_DURATION_MS, elapsedRef.current + delta);
      elapsedRef.current = next;
      setElapsedMs(next);
      if (next < FULL_DEMO_DURATION_MS) frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
    };
  }, [enabled, fixedTimeMs, reducedMotion, visible]);

  const playback = !enabled
    ? "idle"
    : reducedMotion || elapsedMs >= FULL_DEMO_DURATION_MS
        ? "finished"
        : fixedTimeMs !== undefined || !visible
          ? "paused"
          : "playing";
  return { elapsedMs, playback };
}

function useSystemReducedMotion(): boolean {
  const readPreference = () => typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [reducedMotion, setReducedMotion] = useState(readPreference);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
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
  const target = STAR_BY_ID.get("candidate")!;
  const local = Math.min(1, Math.max(0, (elapsedMs - (280 + particle.delayMs)) / particle.durationMs));
  const eased = local * local * (3 - 2 * local);
  const visibility = local <= 0 || local >= 1 ? 0 : Math.sin(local * Math.PI);
  return {
    x: target.x + particle.startX + (particle.endX - particle.startX) * eased,
    y: target.y + particle.startY + (particle.endY - particle.startY) * eased,
    opacity: visibility,
  };
}

function cubicPoint(progress: number): { x: number; y: number } {
  const t = Math.min(1, Math.max(0, progress));
  const u = 1 - t;
  return {
    x: u ** 3 * 540 + 3 * u ** 2 * t * 545 + 3 * u * t ** 2 * 562 + t ** 3 * 585,
    y: u ** 3 * 155 + 3 * u ** 2 * t * 190 + 3 * u * t ** 2 * 225 + t ** 3 * 244,
  };
}

const STAR_BY_ID = new Map(STARS.map((star) => [star.id, star]));

const NODE_COPY: Record<string, { title: string; summary: string; status: string }> = {
  root: { title: "0 · 起点", summary: "生成式 AI 产品体验研究的起始问题与共享范围。", status: "来源节点" },
  value: { title: "1 · 用户价值", summary: "聚焦用户愿意持续使用、理解并信任产品的核心价值。", status: "团队确认" },
  experience: { title: "2 · 核心体验", summary: "定义生成式体验中的关键触点、反馈节奏与认知负荷。", status: "团队确认" },
  feasibility: { title: "3 · 技术可行性", summary: "比较技术选型、隐私边界与成本约束。", status: "来源节点" },
  privacy: { title: "3.2 数据与隐私", summary: "Devin 正在梳理隐私法规差异与可执行合规建议。", status: "可能中断" },
  risk: { title: "4 · 机会与风险", summary: "同时保留市场机会、设计风险与尚未解决的争议。", status: "团队确认" },
  next: { title: "5 · 下一步计划", summary: "把已经确认的观点转成下一轮协作行动。", status: "来源节点" },
};

type ControlGlyphKind =
  | "pan"
  | "focus"
  | "zoom-in"
  | "zoom-out"
  | "fit"
  | "chevron-down"
  | "chevrons-right"
  | "search"
  | "help"
  | "settings"
  | "sparkle"
  | "diamond"
  | "more";

function ControlGlyph({ kind, size = 18 }: { kind: ControlGlyphKind; size?: number }) {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.45,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {kind === "pan" ? <path {...line} d="M8.2 11.1V7.7a1.35 1.35 0 0 1 2.7 0v2.2-4a1.35 1.35 0 0 1 2.7 0v4-2.7a1.35 1.35 0 0 1 2.7 0v3.1-1.4a1.35 1.35 0 0 1 2.7 0v4.5c0 4.4-2.8 7.1-7 7.1-2.5 0-4.1-1.1-5.5-3.1L4.3 14a1.55 1.55 0 0 1 2.4-1.9l1.5 1.5v-2.5Z" /> : null}
      {kind === "focus" ? <><circle {...line} cx="12" cy="12" r="3.2" /><path {...line} d="M12 3v3M12 18v3M3 12h3M18 12h3" /></> : null}
      {kind === "zoom-in" ? <path {...line} d="M12 5v14M5 12h14" /> : null}
      {kind === "zoom-out" ? <path {...line} d="M5 12h14" /> : null}
      {kind === "fit" ? <path {...line} d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /> : null}
      {kind === "chevron-down" ? <path {...line} d="m7 9.5 5 5 5-5" /> : null}
      {kind === "chevrons-right" ? <><path {...line} d="m7 6 6 6-6 6" /><path {...line} d="m12 6 6 6-6 6" /></> : null}
      {kind === "search" ? <><circle {...line} cx="10.5" cy="10.5" r="6" /><path {...line} d="m15 15 4.5 4.5" /></> : null}
      {kind === "help" ? <><circle {...line} cx="12" cy="12" r="8" /><path {...line} d="M9.7 9.5a2.4 2.4 0 1 1 3.6 2.1c-.9.5-1.3 1-1.3 2M12 17h.01" /></> : null}
      {kind === "settings" ? <><circle {...line} cx="12" cy="12" r="2.7" /><path {...line} d="M19.3 13.6v-3.2l-2-.5a6.3 6.3 0 0 0-.7-1.6l1.1-1.8-2.2-2.2-1.8 1.1a6.3 6.3 0 0 0-1.6-.7l-.5-2H8.4l-.5 2a6.3 6.3 0 0 0-1.6.7L4.5 4.3 2.3 6.5l1.1 1.8a6.3 6.3 0 0 0-.7 1.6l-2 .5v3.2l2 .5a6.3 6.3 0 0 0 .7 1.6l-1.1 1.8 2.2 2.2 1.8-1.1a6.3 6.3 0 0 0 1.6.7l.5 2h3.2l.5-2a6.3 6.3 0 0 0 1.6-.7l1.8 1.1 2.2-2.2-1.1-1.8a6.3 6.3 0 0 0 .7-1.6l2-.5Z" transform="translate(1.25 1.25) scale(.89)" /></> : null}
      {kind === "sparkle" ? <><path {...line} d="M12 3c.45 4.55 2.45 6.55 7 7-4.55.45-6.55 2.45-7 7-.45-4.55-2.45-6.55-7-7 4.55-.45 6.55-2.45 7-7Z" /><path {...line} d="M18.5 15.5c.17 1.67.83 2.33 2.5 2.5-1.67.17-2.33.83-2.5 2.5-.17-1.67-.83-2.33-2.5-2.5 1.67-.17 2.33-.83 2.5-2.5Z" /></> : null}
      {kind === "diamond" ? <path {...line} d="m12 4 8 8-8 8-8-8 8-8Z" /> : null}
      {kind === "more" ? <><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></> : null}
    </svg>
  );
}

function NavGlyph({ kind }: { kind: "plus" | "search" | "stars" | "clock" | "stack" | "pen" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.45, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {kind === "plus" ? <path {...common} d="M12 5v14M5 12h14" /> : null}
      {kind === "search" ? <><circle {...common} cx="10.5" cy="10.5" r="6" /><path {...common} d="m15 15 4.5 4.5" /></> : null}
      {kind === "stars" ? <><path {...common} d="m4 8 8-4 8 4-8 4-8-4Z" /><path {...common} d="m4 12 8 4 8-4M4 16l8 4 8-4" /></> : null}
      {kind === "clock" ? <><circle {...common} cx="12" cy="12" r="8" /><path {...common} d="M12 7v5l3 2" /></> : null}
      {kind === "stack" ? <><path {...common} d="m4 9 8-4 8 4-8 4-8-4Z" /><path {...common} d="m4 14 8 4 8-4" /></> : null}
      {kind === "pen" ? <><path {...common} d="m5 17-1 3 3-1L18 8l-2-2L5 17Z" /><path {...common} d="m14.5 7.5 2 2" /></> : null}
    </svg>
  );
}

function BrandMark() {
  return (
    <svg viewBox="0 0 38 38" aria-hidden="true">
      <path d="m19 3.5 12 7v15l-12 7-12-7v-15l12-7Z" fill="none" stroke="currentColor" strokeWidth="1.15" />
      <path d="m11.5 12 7.5 4.3 7.5-4.3M19 16.3v9M11.5 12v8.6l7.5 4.4 7.5-4.4V12" fill="none" stroke="currentColor" strokeWidth=".9" opacity=".82" />
      <path d="m15.2 10 3.8-2.2 3.8 2.2-3.8 2.2-3.8-2.2Z" fill="none" stroke="currentColor" strokeWidth=".8" opacity=".55" />
    </svg>
  );
}

function Avatar({ name, tone, src }: { name: string; tone: Tone; src?: string }) {
  return (
    <span className="b2-avatar" style={{ "--avatar-tone": TONES[tone] } as CSSProperties} title={name}>
      {src ? <img src={src} alt="" width="28" height="28" /> : <span>{name.slice(0, 1)}</span>}
    </span>
  );
}

function StarOverlay({
  star,
  selected,
  presentationOpacity = 1,
  onSelect,
}: {
  star: VisualStar;
  selected: boolean;
  presentationOpacity?: number;
  onSelect(id: string): void;
}) {
  const radius = star.level === 3 ? 15 : star.level === 2 ? 10.5 : 7;
  const interactive = Boolean(star.label);
  const interactiveNow = interactive && presentationOpacity > .98;
  const labelX = star.x + (star.labelDx ?? 18);
  const labelY = star.y + (star.labelDy ?? -8);
  const labelAnchor = star.labelAnchor ?? "start";
  const lines = star.time?.split("\n") ?? [];

  return (
    <g
      className={`b2-star b2-star--${star.kind}${selected ? " is-selected" : ""}${presentationOpacity > .98 ? "" : " is-presentation-hidden"}`}
      data-b2-star-id={star.id}
      role={interactiveNow ? "button" : undefined}
      tabIndex={interactiveNow ? 0 : undefined}
      aria-label={interactiveNow ? star.label : undefined}
      aria-hidden={interactiveNow ? undefined : true}
      opacity={presentationOpacity}
      onClick={interactiveNow ? () => onSelect(star.id) : undefined}
      onKeyDown={interactiveNow ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(star.id);
        }
      } : undefined}
    >
      {interactive ? (
        <circle
          data-b2-star-hit={star.id}
          cx={star.x}
          cy={star.y}
          r={Math.max(12, radius + 5)}
          fill="transparent"
          pointerEvents={interactiveNow ? "all" : "none"}
        />
      ) : null}

      {star.author && star.kind === "source" ? (
        <g transform={`translate(${star.x + 16} ${star.y + 25})`}>
          <circle r="9.4" fill="#0d1724" stroke="#79a6da" strokeWidth="1" />
          <image href={AUTHOR_AVATARS[star.author] ?? avatarOne} x="-8.5" y="-8.5" width="17" height="17" clipPath="url(#b2-author-clip)" preserveAspectRatio="xMidYMid slice" />
        </g>
      ) : null}

      {star.label ? (
        <text className="b2-star__label" x={labelX} y={labelY} textAnchor={labelAnchor}>
          <tspan className="b2-star__title" x={labelX}>{star.label}</tspan>
          {lines.map((line, index) => <tspan key={line + index} className="b2-star__time" x={labelX} dy={index === 0 ? 19 : 17}>{line}</tspan>)}
          {star.detail ? <tspan className="b2-star__detail" x={labelX} dy="19">{star.detail}</tspan> : null}
          {star.author ? <tspan className="b2-star__author" x={labelX} dy="19">@{star.author}</tspan> : null}
          {star.kind === "devin" ? <tspan className="b2-star__warning" x={labelX} dy="19">可能中断</tspan> : null}
        </text>
      ) : null}
    </g>
  );
}

function StarAuraPass({ star, opacity = 1 }: { star: VisualStar; opacity?: number }) {
  return (
    <g opacity={opacity} data-b2-motion-aura={star.id}>
      <StarAura spec={opticsFor(star)} x={star.x} y={star.y} className={`b2-star-aura--${star.id}`} />
    </g>
  );
}

function StarBodyPass({
  star,
  selected,
  selectedHandoff = 1,
  appearingSnapshot,
  opacity = 1,
}: {
  star: VisualStar;
  selected: boolean;
  selectedHandoff?: number;
  appearingSnapshot?: B2MotionSnapshot;
  opacity?: number;
}) {
  const style: MotionStyle = selected
    ? { "--b2-motion-selected-handoff": selectedHandoff }
    : appearingSnapshot
      ? {
          "--b2-motion-core-opacity": appearingSnapshot.channels.coreOpacity,
          "--b2-motion-shell-opacity": appearingSnapshot.channels.shellOpacity,
        }
      : {};
  return (
    <g
      className={`${selected ? "b2-motion-body--selected " : ""}${appearingSnapshot ? "b2-motion-body--appearing" : ""}`.trim() || undefined}
      data-b2-motion-body={star.id}
      opacity={opacity}
      style={style}
    >
      <StarBody spec={opticsFor(star)} x={star.x} y={star.y} state={selected ? "selected" : "idle"} className={`b2-star-body--${star.id}`} />
    </g>
  );
}

function SparkPath({
  d,
  tone,
  main = false,
  dashed = false,
  pass,
}: {
  d: string;
  tone: Tone;
  main?: boolean;
  dashed?: boolean;
  pass: "atmosphere" | "core";
}) {
  const color = TONES[tone];
  const dash = dashed ? "5 7" : undefined;

  if (pass === "atmosphere") {
    return (
      <g className={`b2-path${main ? " b2-path--main" : ""}${dashed ? " is-dashed" : ""}`} data-b2-path-pass="atmosphere">
        <path d={d} fill="none" stroke={color} strokeWidth={main ? 17 : 9} strokeDasharray={dash} style={{ opacity: dashed ? .04 : main ? .32 : .13 }} filter="url(#b2-line-soften)" />
        <path d={d} fill="none" stroke={color} strokeWidth={main ? 5 : 2.2} strokeDasharray={dash} style={{ opacity: dashed ? .12 : main ? .6 : .32 }} />
      </g>
    );
  }

  return (
    <g className={`b2-path${main ? " b2-path--main" : ""}${dashed ? " is-dashed" : ""}`} data-b2-path-pass="core">
      <path d={d} fill="none" stroke={main ? "url(#b2-main-gradient)" : color} strokeWidth={main ? 1.35 : 1} strokeDasharray={dash} style={{ opacity: dashed ? .7 : main ? .98 : .86 }} />
      {!dashed ? <path d={d} fill="none" stroke={main ? "#d8ebff" : color} strokeWidth={main ? .4 : .34} style={{ opacity: main ? .6 : .48 }} /> : null}
    </g>
  );
}

function PathParticles({ path }: { path: GraphPathSpec }) {
  const color = TONES[path.tone];
  if (!path.sparks?.length || path.dashed) return null;

  return (
    <g className={`b2-path-particles${path.main ? " b2-path-particles--main" : ""}`} aria-hidden="true">
      {path.sparks.map((spark, index) => {
        const size = spark.size ?? .85;
        if (spark.shape === "diamond") {
          return <polygon key={`${path.id}-${index}`} points={DIAMOND_POINTS} fill={path.main ? "#eef7ff" : color} opacity={path.main ? .82 : .7} transform={`translate(${spark.x} ${spark.y}) scale(${size * 1.35} ${size * 1.55})`} />;
        }
        return <circle key={`${path.id}-${index}`} cx={spark.x} cy={spark.y} r={size} fill={path.main ? "#e9f5ff" : color} opacity={path.main ? .7 : .62} />;
      })}
    </g>
  );
}

function MotionPathOverlay({ motion }: { motion: FullGraphMotionState }) {
  const { demoActive, demoSnapshot } = motion;
  if (!demoActive) return null;

  if (demoActive.sequence === "node-appearing") {
    const { pathProgress, pathPacketOpacity } = demoSnapshot.channels;
    return (
      <g data-b2-motion-sequence="node-appearing">
        <path
          className="b2-motion-path-reveal"
          data-motion-path-reveal="candidate"
          d={CANDIDATE_PATH.d}
          pathLength="1"
          strokeDasharray={`${pathProgress} ${Math.max(0, 1 - pathProgress)}`}
        />
        {pathPacketOpacity > 0 ? (
          <path
            className="b2-motion-path-packet"
            data-motion-path-packet="candidate"
            d={CANDIDATE_PATH.d}
            pathLength="1"
            opacity={pathPacketOpacity}
            strokeDasharray=".022 .978"
            strokeDashoffset={1 - pathProgress}
          />
        ) : null}
      </g>
    );
  }

  if (demoActive.sequence === "devin-event" && demoSnapshot.channels.pathPacketOpacity > 0) {
    const point = cubicPoint(demoSnapshot.channels.pathProgress);
    return (
      <g
        className="b2-motion-devin-packet"
        data-motion-path-packet="devin-event"
        opacity={demoSnapshot.channels.pathPacketOpacity}
        transform={`translate(${point.x} ${point.y})`}
      >
        <circle className="b2-motion-devin-packet__air" r="9" />
        <circle className="b2-motion-devin-packet__shell" r="3.4" />
        <rect className="b2-motion-devin-packet__core" x="-1.8" y="-1.8" width="3.6" height="3.6" rx=".5" transform="rotate(45)" />
      </g>
    );
  }

  return null;
}

function MotionParticles({ motion }: { motion: FullGraphMotionState }) {
  if (motion.demoActive?.sequence !== "node-appearing") return null;
  return (
    <g className="b2-motion-condensation" data-motion-particle-count={NODE_APPEARANCE_PARTICLES.length}>
      {NODE_APPEARANCE_PARTICLES.map((particle) => {
        const position = particlePosition(particle, motion.demoSnapshot.elapsedMs);
        return (
          <circle
            key={particle.id}
            data-motion-particle={particle.id}
            cx={position.x}
            cy={position.y}
            r={particle.size}
            opacity={position.opacity * motion.demoSnapshot.channels.particleOpacity}
          />
        );
      })}
    </g>
  );
}

function MotionStarOverlay({ motion }: { motion: FullGraphMotionState }) {
  const selectedStar = STAR_BY_ID.get(motion.selectionTargetId);
  const departingStar = STAR_BY_ID.get(motion.departingSelectionId);
  const selectionChannels = motion.selectionSnapshot.channels;
  const departureOpacity = motion.selectionSnapshot.playback === "idle"
    ? 0
    : Math.max(0, 1 - motion.selectionSnapshot.elapsedMs / 180);
  const demoChannels = motion.demoSnapshot.channels;
  const staleSettled = motion.demoPlayedEventKeys.includes(DEMO_EVENT_KEYS.devinStale);
  const staleSnapshot = staleSettled
    ? sampleB2Motion("devin-stale", B2_MOTION_DURATIONS["devin-stale"], true)
    : motion.demoSnapshot;
  const showStale = motion.demoActive?.sequence === "devin-stale" || staleSettled;

  return (
    <>
      {selectedStar && motion.selectionSnapshot.playback !== "idle" ? (
        <g data-motion-selected-target={selectedStar.id}>
          {selectedStar.kind !== "devin" ? (
            <g opacity={selectionChannels.auraBoost * .12}>
              <StarAura spec={opticsFor(selectedStar)} x={selectedStar.x} y={selectedStar.y} />
            </g>
          ) : null}
          <g
            className="b2-motion-focus-ring"
            opacity={selectionChannels.focusRingOpacity}
            transform={`translate(${selectedStar.x} ${selectedStar.y}) scale(${selectionChannels.focusRingScale}) translate(${-selectedStar.x} ${-selectedStar.y})`}
          >
            <circle className="b2-motion-focus-ring__air" cx={selectedStar.x} cy={selectedStar.y} r={opticsFor(selectedStar).shellRadius + 15} />
            <circle className="b2-motion-focus-ring__core" cx={selectedStar.x} cy={selectedStar.y} r={opticsFor(selectedStar).shellRadius + 15} />
          </g>
        </g>
      ) : null}

      {departingStar && departureOpacity > 0 ? (
        <g data-motion-selection-departing={departingStar.id} opacity={departureOpacity}>
          <circle className="b2-motion-departing-ring__air" cx={departingStar.x} cy={departingStar.y} r={opticsFor(departingStar).shellRadius + 7} />
          <circle className="b2-motion-departing-ring__core" cx={departingStar.x} cy={departingStar.y} r={opticsFor(departingStar).shellRadius + 7} />
        </g>
      ) : null}

      {motion.demoActive?.sequence === "devin-event" ? (
        <g
          className="b2-motion-devin-event-lift"
          data-motion-devin-event-lift="privacy"
          opacity={demoChannels.devinHazeBoost}
          transform="translate(585 244)"
        >
          <circle className="b2-motion-devin-event-lift__haze" r="31" />
          <rect className="b2-motion-devin-event-lift__shell" x="-10" y="-10" width="20" height="20" rx="2" transform="rotate(45)" />
          <rect className="b2-motion-devin-event-lift__core" x="-4" y="-4" width="8" height="8" rx="1" transform="rotate(45)" />
        </g>
      ) : null}

      {showStale ? (
        <g data-motion-devin-stale="privacy" transform="translate(585 244)">
          <g className="b2-motion-devin-energy" opacity={staleSnapshot.channels.devinEnergyOpacity}>
            <circle className="b2-motion-devin-energy__air" r="28" />
            <rect className="b2-motion-devin-energy__shell" x="-9" y="-9" width="18" height="18" rx="2" transform="rotate(45)" />
          </g>
          <circle
            className="b2-motion-devin-stale-ring"
            data-motion-stale-ring="privacy"
            r="25"
            opacity={staleSnapshot.channels.staleRingOpacity}
            pathLength="1"
            strokeDasharray=".09 .055 .025 .07 .13 .08 .045 .505"
          />
        </g>
      ) : null}
    </>
  );
}

function ConstellationGraph({
  selectedId,
  zoom,
  motion,
  onSelect,
}: {
  selectedId: string;
  zoom: number;
  motion: FullGraphMotionState;
  onSelect(id: string): void;
}) {
  const scale = zoom / 100;
  const candidateActive = motion.demoActive?.sequence === "node-appearing";
  const candidateSettled = !motion.motionDemo
    || motion.demoPlayedEventKeys.includes(DEMO_EVENT_KEYS.candidate);
  const candidateAuraOpacity = candidateActive ? motion.demoSnapshot.channels.auraOpacity : candidateSettled ? 1 : 0;
  const candidateLabelOpacity = candidateActive ? motion.demoSnapshot.channels.labelOpacity : candidateSettled ? 1 : 0;
  const selectionHandoff = motion.selectionTargetId === selectedId
    ? motion.selectionSnapshot.channels.selectedHandoff
    : 1;
  const staleSettled = motion.demoPlayedEventKeys.includes(DEMO_EVENT_KEYS.devinStale);
  const privacyOpacity = motion.demoActive?.sequence === "devin-stale"
    ? motion.demoSnapshot.channels.devinBodyOpacity
    : staleSettled
      ? .82
      : 1;

  return (
    <svg className="b2-graph" viewBox="0 0 1096 992" preserveAspectRatio="xMidYMid meet" role="group" aria-label="B2 shared constellation visual fixture">
      <defs>
        <clipPath id="b2-author-clip">
          <circle cx="0" cy="0" r="8.5" />
        </clipPath>
        <linearGradient id="b2-main-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2d76e4" stopOpacity=".66" />
          <stop offset=".18" stopColor="#4b98f9" />
          <stop offset=".72" stopColor="#3487f1" />
          <stop offset="1" stopColor="#4b94ef" stopOpacity=".56" />
        </linearGradient>
        <filter id="b2-line-soften" x="-20%" y="-80%" width="140%" height="260%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
      </defs>

      <rect width="1100" height="992" fill="transparent" pointerEvents="none" />

      <g className="b2-graph__zoom" style={{ transform: `scale(${scale})`, transformOrigin: "550px 496px" }}>
        <g data-b2-pass="path-atmosphere">
          {GRAPH_PATHS.map((path) => <SparkPath key={path.id} d={path.d} tone={path.tone} main={path.main} dashed={path.dashed} pass="atmosphere" />)}
        </g>
        <g data-b2-pass="star-aura">
          {STARS.map((star) => <StarAuraPass key={star.id} star={star} opacity={star.id === "candidate" ? candidateAuraOpacity : 1} />)}
        </g>
        <g data-b2-pass="path-core">
          {GRAPH_PATHS.map((path) => path.id === "candidate" && !candidateSettled
            ? null
            : <SparkPath key={path.id} d={path.d} tone={path.tone} main={path.main} dashed={path.dashed} pass="core" />)}
        </g>
        <g data-b2-pass="motion-path-overlay">
          <MotionPathOverlay motion={motion} />
        </g>
        <g data-b2-pass="path-particles">
          {GRAPH_PATHS.map((path) => <PathParticles key={`${path.id}-sparks`} path={path} />)}
          <MotionParticles motion={motion} />
        </g>
        <g data-b2-pass="star-body">
          {STARS.map((star) => (
            <StarBodyPass
              key={star.id}
              star={star}
              selected={selectedId === star.id}
              selectedHandoff={selectedId === star.id ? selectionHandoff : 1}
              appearingSnapshot={star.id === "candidate" && candidateActive ? motion.demoSnapshot : undefined}
              opacity={star.id === "candidate" && !candidateActive && !candidateSettled ? 0 : star.id === "privacy" ? privacyOpacity : 1}
            />
          ))}
        </g>
        <g data-b2-pass="motion-star-overlay">
          <MotionStarOverlay motion={motion} />
        </g>
        <g data-b2-pass="star-overlay">
          {STARS.map((star) => (
            <StarOverlay
              key={star.id}
              star={star}
              selected={selectedId === star.id}
              presentationOpacity={star.id === "candidate" ? candidateLabelOpacity : 1}
              onSelect={onSelect}
            />
          ))}
          {motion.motionDemo && motion.reducedMotion && candidateSettled ? (
            <g className="b2-motion-new-badge" data-motion-static-new="candidate" transform="translate(961 190)">
              <rect width="41" height="18" rx="9" />
              <text x="20.5" y="12.2" textAnchor="middle">新增</text>
            </g>
          ) : null}
        </g>
      </g>
    </svg>
  );
}

function TopLevelAnswerLink() {
  return (
    <svg
      className="b2-answer-link"
      viewBox="0 0 1586 992"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      style={{ position: "fixed", inset: 0, zIndex: 15, width: "100vw", height: "100dvh", pointerEvents: "none" }}
    >
      <defs>
        <marker id="b2-answer-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M1 1 7 4 1 7" fill="none" stroke="#5ca5ff" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      <path
        d="M1027 543 C1082 535 1103 494 1127 449 C1148 410 1165 392 1196 399"
        fill="none"
        stroke="#4b9cff"
        strokeWidth="1.25"
        strokeDasharray="5 6"
        strokeLinecap="round"
        markerEnd="url(#b2-answer-arrow)"
        opacity=".9"
        vectorEffect="non-scaling-stroke"
        style={{ filter: "drop-shadow(0 0 3px rgba(66, 145, 242, .28))" }}
      />
    </svg>
  );
}

function LeftRail() {
  const items = [
    ["plus", "新建"], ["search", "探索"], ["stars", "星图"], ["clock", "时间线"], ["stack", "图谱"], ["pen", "标注"],
  ] as const;
  return (
    <nav className="b2-rail" aria-label="Dialogue Atlas navigation">
      <div className="b2-rail__brand"><BrandMark /></div>
      <div className="b2-rail__items">
        {items.map(([kind, label], index) => (
          <button key={label} type="button" className={index === 0 ? "is-active" : ""} aria-label={label}>
            <NavGlyph kind={kind} />
            {index === 0 ? null : <span>{label}</span>}
          </button>
        ))}
      </div>
      <div className="b2-rail__profile"><Avatar name="你" tone="blue" src={avatarThree} /><span><ControlGlyph kind="chevrons-right" size={17} /></span></div>
    </nav>
  );
}

function Legend() {
  return (
    <aside className="b2-panel b2-legend" aria-label="图例">
      <h2>图例</h2>
      <div className="b2-legend__section">
        <p><i className="b2-key b2-key--source" />源节点</p>
        <p><i className="b2-key b2-key--team" />团队节点</p>
        <p><i className="b2-key b2-key--question">?</i>未解问题</p>
        <p><i className="b2-key b2-key--candidate" />候选观点</p>
        <p><i className="b2-key b2-key--devin" />Devin 输出</p>
      </div>
      <div className="b2-legend__section b2-legend__edges">
        <p><i className="is-blue" />核心推理（主干）</p>
        <p><i className="is-cyan" />支持论据</p>
        <p><i className="is-orange" />反驳或分歧</p>
        <p><i className="is-violet" />探索延伸</p>
        <p><i className="is-dashed" />因果链路</p>
        <p><i className="is-dotted" />引用支持</p>
      </div>
    </aside>
  );
}

function MiniMap() {
  const minimapPaths = GRAPH_PATHS.filter((path) => !path.dashed);
  const minimapStars = STARS.filter((star) => star.kind !== "candidate");

  return (
    <aside className="b2-panel b2-minimap" aria-label="全局小地图">
      <h2>全局小地图</h2>
      <svg viewBox="-6 128 1048 735" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="b2-minimap-main" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#4d91f2" stopOpacity=".55" />
            <stop offset=".2" stopColor="#74b7ff" />
            <stop offset=".78" stopColor="#4d9dfd" />
            <stop offset="1" stopColor="#5ca5ff" stopOpacity=".5" />
          </linearGradient>
          <filter id="b2-minimap-blur" x="-30%" y="-80%" width="160%" height="260%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        {minimapPaths.map((path) => (
          <g key={path.id}>
            <path
              d={path.d}
              fill="none"
              stroke={path.main ? "#63a8ff" : TONES[path.tone]}
              strokeWidth={path.main ? 18 : 14}
              strokeDasharray={path.dashed ? "12 16" : undefined}
              opacity={path.main ? .22 : .2}
              filter="url(#b2-minimap-blur)"
            />
            <path
              d={path.d}
              fill="none"
              stroke={path.main ? "url(#b2-minimap-main)" : TONES[path.tone]}
              strokeWidth={path.main ? 4.5 : 3}
              strokeDasharray={path.dashed ? "12 16" : undefined}
              opacity={path.main ? .95 : .85}
            />
          </g>
        ))}
        {minimapStars.map((star) => (
          <g key={star.id}>
            <circle cx={star.x} cy={star.y} r={star.id === "root" ? 28 : star.kind === "source" ? 20 : 14} fill={TONES[star.tone]} opacity=".14" filter="url(#b2-minimap-blur)" />
            <circle cx={star.x} cy={star.y} r={star.id === "root" ? 13 : star.kind === "source" ? 9 : 6} fill="#f7fbff" stroke={TONES[star.tone]} strokeWidth="3" />
          </g>
        ))}
      </svg>
    </aside>
  );
}

function CanvasToolbar({ zoom, onZoom }: { zoom: number; onZoom(next: number): void }) {
  return (
    <div className="b2-canvas-toolbar" aria-label="画布工具">
      <button type="button" aria-label="平移工具"><ControlGlyph kind="pan" size={19} /></button>
      <button type="button" aria-label="定位中心"><ControlGlyph kind="focus" size={19} /></button>
      <span />
      <button type="button" aria-label="放大" onClick={() => onZoom(Math.min(120, zoom + 10))}><ControlGlyph kind="zoom-in" size={19} /></button>
      <button type="button" aria-label="缩小" onClick={() => onZoom(Math.max(80, zoom - 10))}><ControlGlyph kind="zoom-out" size={19} /></button>
      <span />
      <output aria-label="当前缩放">{zoom}%</output>
      <button type="button" aria-label="适配画布" onClick={() => onZoom(100)}><ControlGlyph kind="fit" size={19} /></button>
    </div>
  );
}

function CanvasHeader() {
  return (
    <header className="b2-canvas-header">
      <h1>Dialogue Atlas</h1>
      <button type="button" className="b2-topic-select">生长星图 · 生成式AI产品的关键体验探索 <span><ControlGlyph kind="chevron-down" size={15} /></span></button>
      <div className="b2-presence" aria-label="房间在线成员">
        <Avatar name="林" tone="red" src={avatarOne} /><Avatar name="陈" tone="green" src={avatarTwo} /><Avatar name="你" tone="blue" src={avatarThree} />
        <span>3 人在线</span>
      </div>
      <div className="b2-header-actions" aria-label="页面操作">
        <button type="button" aria-label="搜索"><ControlGlyph kind="search" /></button>
        <button type="button" aria-label="帮助"><ControlGlyph kind="help" /></button>
        <button type="button" aria-label="设置"><ControlGlyph kind="settings" /></button>
      </div>
    </header>
  );
}

function ConversationPanel() {
  return (
    <section className="b2-conversation" aria-label="LLM 房间共享对话">
      <div className="b2-workbench__section-title">
        <h2>与 LLM 的对话</h2>
        <button type="button">思考中 <ControlGlyph kind="chevron-down" size={12} /></button>
      </div>
      <div className="b2-generation-state"><span><ControlGlyph kind="sparkle" size={14} /></span><strong>正在生成回答…</strong><i /><i /><i /><i /></div>
      <article className="b2-message b2-message--user">
        <strong>你</strong>
        <p>如何通过居中设计让用户在使用过程中感到被理解和愉悦？</p>
      </article>
      <article className="b2-message b2-message--assistant">
        <strong>LLM 助手</strong>
        <p>居中设计通过将最重要的信息、操作与反馈放在用户注意力的自然焦点区域，减少了认知负荷与视觉搜索成本，让用户更快理解“下一步该做什么”。</p>
        <p>具体来说：</p>
        <ul>
          <li>降低决策成本：核心路径清晰，帮助用户快速进入心流；</li>
          <li>增强情感共鸣：视觉层级与动效反馈传递出被关注与被理解的感受；</li>
          <li>提升控制感：关键信息与操作始终可见可达，减少迷失与焦虑。</li>
        </ul>
        <p>因此，居中设计不仅是布局选择，更是一种对用户心理模型的尊重与回应。<span className="b2-caret" /></p>
      </article>
      <footer><span>正在生成中…　<i /><i /><i /><i /></span><button type="button">停止生成</button></footer>
    </section>
  );
}

function NodePanel({ selectedId }: { selectedId: string }) {
  const star = STAR_BY_ID.get(selectedId);
  const copy = NODE_COPY[selectedId] ?? { title: star?.label ?? "节点详情", summary: "结构化星图节点。", status: "团队节点" };
  return (
    <section className="b2-node-panel" aria-label="节点详情">
      <div className="b2-workbench__section-title"><h2>{copy.title}</h2><span>{copy.status}</span></div>
      <div className="b2-node-panel__star"><i style={{ "--node-tone": TONES[star?.tone ?? "blue"] } as CSSProperties} /><strong>{star?.time ?? "08-10"}</strong></div>
      <p>{copy.summary}</p>
      <dl><div><dt>来源</dt><dd>批准后的本地图谱</dd></div><div><dt>关系</dt><dd>4 条可核验连接</dd></div><div><dt>状态</dt><dd>{copy.status}</dd></div></dl>
      <button type="button">查看证据与讨论</button>
    </section>
  );
}

function ExecutionPanel() {
  return (
    <section className="b2-execution-panel" aria-label="执行详情">
      <div className="b2-workbench__section-title"><h2>执行链路</h2><span>静态样例</span></div>
      <ol>
        <li className="is-done"><i />读取已确认上下文<strong>完成</strong></li>
        <li className="is-done"><i />整理隐私约束<strong>完成</strong></li>
        <li className="is-current"><i />分析法规差异<strong>可能中断</strong></li>
        <li><i />形成行动建议<strong>等待</strong></li>
      </ol>
      <p>本视觉页面不会创建真实 Devin Session，也不会发送房间内容。</p>
    </section>
  );
}

function DevinStatus() {
  return (
    <section className="b2-panel b2-devin" aria-label="Devin 运行状态">
      <header><h2>Devin 运行状态</h2><strong>可能中断</strong><span><ControlGlyph kind="diamond" size={15} /><ControlGlyph kind="more" size={17} /></span></header>
      <p>任务：3.2 数据与隐私</p>
      <p>最后更新 2 分钟前（无新事件）</p>
      <p className="b2-devin__note">Devin 已 2 分钟未产生新事件，可能因任务阻塞或外部依赖未就绪而中断。</p>
      <button type="button">查看详情</button>
    </section>
  );
}

function Workbench({ tab, selectedId, onTab }: { tab: WorkbenchTab; selectedId: string; onTab(tab: WorkbenchTab): void }) {
  const tabs: Array<[WorkbenchTab, string]> = [["conversation", "对话"], ["node", "节点"], ["execution", "执行"]];
  return (
    <aside className="b2-workbench" aria-label="协作工作台">
      <section className="b2-panel b2-workbench__main">
        <div className="b2-workbench__tabs" role="tablist" aria-label="工作台视图">
          {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => onTab(id)}>{label}</button>)}
        </div>
        {tab === "conversation" ? <ConversationPanel /> : tab === "node" ? <NodePanel selectedId={selectedId} /> : <ExecutionPanel />}
      </section>
      <DevinStatus />
    </aside>
  );
}

export interface B2VisualDemoProps {
  /** Test and embed seam. Normal navigation reads window.location.search. */
  search?: string;
}

export function B2VisualDemo({ search }: B2VisualDemoProps = {}) {
  const resolvedSearch = search ?? (typeof window === "undefined" ? "" : window.location.search);
  const motionQuery = useMemo(() => new URLSearchParams(resolvedSearch), [resolvedSearch]);
  const motionDemo = motionQuery.get("motionDemo") === "1";
  const systemReducedMotion = useSystemReducedMotion();
  const reducedMotion = motionQuery.get("motion") === "reduced"
    ? true
    : motionQuery.get("motion") === "full"
      ? false
      : systemReducedMotion;
  const fixedMotionTime = useMemo(() => parseMotionTime(resolvedSearch), [resolvedSearch]);
  const [selectedId, setSelectedId] = useState("");
  const [selectionTargetId, setSelectionTargetId] = useState("");
  const [departingSelectionId, setDepartingSelectionId] = useState("");
  const [selectionEventKey, setSelectionEventKey] = useState("");
  const selectionSequenceRef = useRef(0);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("conversation");
  const [zoom, setZoom] = useState(100);
  const [fontsReady, setFontsReady] = useState(() => typeof document === "undefined" || !("fonts" in document));
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [haloAssetsReady, setHaloAssetsReady] = useState(false);
  const [haloAssetsFatal, setHaloAssetsFatal] = useState(false);
  const selectedLabel = useMemo(() => STAR_BY_ID.get(selectedId)?.label ?? "节点", [selectedId]);
  const selectionTimeline = useB2MotionTimeline({
    sequence: "selected-focus",
    reducedMotion,
    autoPlay: false,
  });
  const demoClock = useFullDemoClock({
    enabled: motionDemo,
    fixedTimeMs: motionDemo ? fixedMotionTime : undefined,
    reducedMotion,
  });
  const demoFrame = useMemo(
    () => motionDemo
      ? fullDemoFrameAt(demoClock.elapsedMs, reducedMotion)
      : { phase: "idle" as const, active: null, snapshot: sampleB2Motion("selected-focus", 0) },
    [demoClock.elapsedMs, motionDemo, reducedMotion],
  );
  const demoRuntime = useMemo(
    () => motionDemo ? runtimeAtDemoTime(demoClock.elapsedMs) : createB2MotionRuntimeState(),
    [demoClock.elapsedMs, motionDemo],
  );

  useEffect(() => {
    const theme = document.querySelector('meta[name="theme-color"]');
    const previous = theme?.getAttribute("content");
    theme?.setAttribute("content", "#02070d");
    return () => { if (previous) theme?.setAttribute("content", previous); };
  }, []);

  useEffect(() => {
    if (!("fonts" in document)) {
      setFontsReady(true);
      return;
    }

    let disposed = false;
    void document.fonts.ready.then(() => {
      if (!disposed) setFontsReady(true);
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let active = true;
    void decodeHaloAssets()
      .then(() => {
        if (!active) return;
        setHaloAssetsReady(true);
        setHaloAssetsFatal(false);
      })
      .catch(() => {
        if (!active) return;
        setHaloAssetsReady(false);
        setHaloAssetsFatal(true);
      });
    return () => { active = false; };
  }, []);

  function selectNode(id: string) {
    setWorkbenchTab("node");
    if (id === selectedId) return;
    if (motionDemo) {
      setDepartingSelectionId("");
      setSelectionTargetId("");
      setSelectedId(id);
      return;
    }
    setDepartingSelectionId(selectedId);
    setSelectedId(id);
    setSelectionTargetId(id);
    selectionSequenceRef.current += 1;
    setSelectionEventKey(`selection:${selectionSequenceRef.current}:${id}`);
    selectionTimeline.replay();
  }

  const motionState: FullGraphMotionState = {
    selectionTargetId,
    departingSelectionId,
    selectionSnapshot: selectionTimeline.snapshot,
    demoActive: demoFrame.active,
    demoSnapshot: demoFrame.snapshot,
    demoPlayedEventKeys: demoRuntime.playedEventKeys,
    reducedMotion,
    motionDemo,
  };
  const packetCount = demoFrame.active
    && (demoFrame.active.sequence === "node-appearing" || demoFrame.active.sequence === "devin-event")
    && demoFrame.snapshot.channels.pathPacketOpacity > 0
    ? 1
    : 0;
  // Runtime state is constructed synchronously, before the visual readiness
  // marker can be exposed. Normal B2 therefore retains its canonical timing.
  const motionRuntimeReady = !motionDemo
    || demoRuntime.active !== null
    || demoRuntime.playedEventKeys.includes(DEMO_EVENT_KEYS.devinStale);

  return (
    <main
      className="b2-visual"
      data-runtime="deterministic-visual-fixture"
      data-b2-ready={fontsReady && backgroundReady && haloAssetsReady && motionRuntimeReady ? "true" : "false"}
      data-b2-motion-runtime-ready={motionRuntimeReady ? "true" : "false"}
      data-b2-optics-error={haloAssetsFatal ? "halo-assets-failed" : undefined}
      data-motion-demo={motionDemo ? "true" : "false"}
      data-motion-reduced={reducedMotion ? "true" : "false"}
      data-motion-event-key={(demoFrame.active?.eventKey ?? selectionEventKey) || undefined}
      data-motion-sequence={demoFrame.active?.sequence ?? (selectionEventKey ? "selected-focus" : "idle")}
      data-motion-time-ms={motionDemo ? Math.round(demoClock.elapsedMs) : selectionEventKey ? Math.round(selectionTimeline.snapshot.elapsedMs) : 0}
      data-motion-phase={motionDemo ? demoFrame.phase : selectionEventKey ? "selected" : "idle"}
      data-motion-playback={motionDemo ? demoClock.playback : selectionEventKey ? selectionTimeline.snapshot.playback : "idle"}
      data-motion-packet-count={packetCount}
      data-motion-last-activity-seq={demoRuntime.lastActivitySeq ?? undefined}
      data-motion-played-events={demoRuntime.playedEventKeys.join(",") || undefined}
    >
      <LeftRail />
      <section className="b2-canvas" aria-label="星图画布">
        <B2StarfieldCanvas className="b2-background-canvas" staticMode textureOpacity={0.41} onReady={(state) => setBackgroundReady(state.textureDecoded)} />
        <CanvasHeader />
        <ConstellationGraph selectedId={selectedId} zoom={zoom} motion={motionState} onSelect={selectNode} />
        <Legend />
        <MiniMap />
        <CanvasToolbar zoom={zoom} onZoom={setZoom} />
        <p className="b2-selected-readout" aria-live="polite">当前选择：{selectedLabel}</p>
      </section>
      <Workbench tab={workbenchTab} selectedId={selectedId} onTab={setWorkbenchTab} />
      <TopLevelAnswerLink />
      <p className="b2-fixture-note">{motionDemo ? "视觉动效 Fixture · 非实时状态 · 不连接 Supabase / LLM / Devin" : "视觉还原样例 · 不连接 Supabase / LLM / Devin"}</p>
    </main>
  );
}

export default B2VisualDemo;

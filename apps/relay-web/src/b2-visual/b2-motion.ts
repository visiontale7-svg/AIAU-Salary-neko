import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type B2MotionSequence =
  | "selected-focus"
  | "node-appearing"
  | "devin-event"
  | "devin-stale";

export type MotionPlayback = "idle" | "playing" | "paused" | "finished";

/**
 * Animation values are deliberately independent from the optical SVG filters.
 * Opacity, progress, handoff and boost values stay within 0..1. Scale is the
 * only non-normalized channel and is constrained to the selected ring's
 * 1..1.34 optical contract.
 */
export interface B2MotionChannels {
  auraOpacity: number;
  auraBoost: number;
  focusRingOpacity: number;
  focusRingScale: number;
  selectedHandoff: number;
  pathProgress: number;
  pathPacketOpacity: number;
  particleProgress: number;
  particleOpacity: number;
  coreOpacity: number;
  shellOpacity: number;
  labelOpacity: number;
  devinEnergyOpacity: number;
  devinHazeBoost: number;
  devinBodyOpacity: number;
  staleRingOpacity: number;
}

export interface B2MotionSnapshot {
  sequence: B2MotionSequence;
  elapsedMs: number;
  durationMs: number;
  playback: MotionPlayback;
  reducedMotion: boolean;
  channels: B2MotionChannels;
}

export interface NodeAppearanceParticleSpec {
  /** Stable identifier; never generated at runtime. */
  id: string;
  /** Coordinates are relative to the target star centre. */
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  delayMs: number;
  durationMs: number;
  size: number;
}

export interface UseB2MotionTimelineOptions {
  sequence: B2MotionSequence;
  initialTimeMs?: number;
  reducedMotion?: boolean;
  frozen?: boolean;
  autoPlay?: boolean;
}

export interface B2MotionTimeline {
  snapshot: B2MotionSnapshot;
  replay: () => void;
  pause: () => void;
  resume: () => void;
  seek: (elapsedMs: number) => void;
}

export const B2_MOTION_DURATIONS = {
  "selected-focus": 520,
  "node-appearing": 1450,
  "devin-event": 850,
  "devin-stale": 1600,
} as const satisfies Readonly<Record<B2MotionSequence, number>>;

/**
 * Fixed condensation field for node creation. Values are relative to the new
 * star, biased toward its incoming parent relationship rather than radiating
 * like fireworks.
 */
export const NODE_APPEARANCE_PARTICLES = [
  { id: "condense-01", startX: -43, startY: -8, endX: -4.5, endY: -2.5, delayMs: 0, durationMs: 470, size: 1.15 },
  { id: "condense-02", startX: -38, startY: 11, endX: -3.2, endY: 2.8, delayMs: 34, durationMs: 430, size: 0.8 },
  { id: "condense-03", startX: -31, startY: -21, endX: -1.8, endY: -3.7, delayMs: 62, durationMs: 510, size: 0.65 },
  { id: "condense-04", startX: -27, startY: 23, endX: -2.1, endY: 3.9, delayMs: 88, durationMs: 455, size: 1.3 },
  { id: "condense-05", startX: -19, startY: -30, endX: 0.4, endY: -4.4, delayMs: 116, durationMs: 480, size: 0.9 },
  { id: "condense-06", startX: -14, startY: 31, endX: 1.2, endY: 4.1, delayMs: 142, durationMs: 415, size: 0.7 },
  { id: "condense-07", startX: 7, startY: -28, endX: 2.8, endY: -3.5, delayMs: 166, durationMs: 390, size: 1.05 },
  { id: "condense-08", startX: 13, startY: 25, endX: 3.4, endY: 3.3, delayMs: 188, durationMs: 445, size: 0.75 },
  { id: "condense-09", startX: 24, startY: -17, endX: 4.1, endY: -1.9, delayMs: 207, durationMs: 365, size: 0.6 },
  { id: "condense-10", startX: 27, startY: 14, endX: 4.3, endY: 2.1, delayMs: 224, durationMs: 405, size: 1.1 },
  { id: "condense-11", startX: 18, startY: -5, endX: 3.1, endY: -0.8, delayMs: 238, durationMs: 340, size: 0.7 },
  { id: "condense-12", startX: 15, startY: 7, endX: 2.5, endY: 1.1, delayMs: 252, durationMs: 360, size: 0.9 },
] as const satisfies readonly NodeAppearanceParticleSpec[];

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? maximum : minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function easeOutCubic(value: number): number {
  const t = clamp01(value);
  return 1 - (1 - t) ** 3;
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function progressBetween(elapsedMs: number, startMs: number, endMs: number): number {
  if (endMs <= startMs) return elapsedMs >= endMs ? 1 : 0;
  return clamp01((elapsedMs - startMs) / (endMs - startMs));
}

function fadeWindow(
  elapsedMs: number,
  startMs: number,
  fadeInEndMs: number,
  fadeOutStartMs: number,
  endMs: number,
): number {
  if (elapsedMs <= startMs || elapsedMs >= endMs) return 0;
  if (elapsedMs < fadeInEndMs) return smoothstep(progressBetween(elapsedMs, startMs, fadeInEndMs));
  if (elapsedMs <= fadeOutStartMs) return 1;
  return 1 - smoothstep(progressBetween(elapsedMs, fadeOutStartMs, endMs));
}

function baseChannels(): B2MotionChannels {
  return {
    auraOpacity: 1,
    auraBoost: 0,
    focusRingOpacity: 0,
    focusRingScale: 1,
    selectedHandoff: 0,
    pathProgress: 0,
    pathPacketOpacity: 0,
    particleProgress: 0,
    particleOpacity: 0,
    coreOpacity: 1,
    shellOpacity: 1,
    labelOpacity: 1,
    devinEnergyOpacity: 1,
    devinHazeBoost: 0,
    devinBodyOpacity: 1,
    staleRingOpacity: 0,
  };
}

function clampChannels(channels: B2MotionChannels): B2MotionChannels {
  return {
    auraOpacity: clamp01(channels.auraOpacity),
    auraBoost: clamp01(channels.auraBoost),
    focusRingOpacity: clamp01(channels.focusRingOpacity),
    focusRingScale: clamp(channels.focusRingScale, 1, 1.34),
    selectedHandoff: clamp01(channels.selectedHandoff),
    pathProgress: clamp01(channels.pathProgress),
    pathPacketOpacity: clamp01(channels.pathPacketOpacity),
    particleProgress: clamp01(channels.particleProgress),
    particleOpacity: clamp01(channels.particleOpacity),
    coreOpacity: clamp01(channels.coreOpacity),
    shellOpacity: clamp01(channels.shellOpacity),
    labelOpacity: clamp01(channels.labelOpacity),
    devinEnergyOpacity: clamp01(channels.devinEnergyOpacity),
    devinHazeBoost: clamp01(channels.devinHazeBoost),
    devinBodyOpacity: clamp01(channels.devinBodyOpacity),
    staleRingOpacity: clamp01(channels.staleRingOpacity),
  };
}

function sampleSelectedFocus(elapsedMs: number): B2MotionChannels {
  const channels = baseChannels();
  const focus = easeOutCubic(progressBetween(elapsedMs, 0, 180));
  const handoff = smoothstep(progressBetween(elapsedMs, 180, 520));
  const overlayPresence = elapsedMs <= 180 ? focus : 1 - handoff;

  channels.auraBoost = overlayPresence;
  channels.focusRingOpacity = overlayPresence;
  channels.focusRingScale = 1.34 - 0.34 * focus;
  channels.selectedHandoff = handoff;
  return clampChannels(channels);
}

function sampleNodeAppearing(elapsedMs: number): B2MotionChannels {
  const channels = baseChannels();
  channels.pathProgress = easeOutCubic(progressBetween(elapsedMs, 0, 620));
  channels.pathPacketOpacity = fadeWindow(elapsedMs, 0, 90, 500, 620);
  channels.particleProgress = smoothstep(progressBetween(elapsedMs, 280, 920));
  channels.particleOpacity = fadeWindow(elapsedMs, 280, 410, 760, 920);
  channels.coreOpacity = smoothstep(progressBetween(elapsedMs, 560, 860));
  channels.shellOpacity = smoothstep(progressBetween(elapsedMs, 620, 1200));
  channels.auraOpacity = smoothstep(progressBetween(elapsedMs, 620, 1200));
  channels.labelOpacity = smoothstep(progressBetween(elapsedMs, 1050, 1450));
  return clampChannels(channels);
}

function sampleDevinEvent(elapsedMs: number): B2MotionChannels {
  const channels = baseChannels();
  channels.pathProgress = easeOutCubic(progressBetween(elapsedMs, 0, 700));
  channels.pathPacketOpacity = fadeWindow(elapsedMs, 0, 90, 585, 700);
  channels.devinHazeBoost = fadeWindow(elapsedMs, 580, 640, 745, 850);
  return clampChannels(channels);
}

function sampleDevinStale(elapsedMs: number): B2MotionChannels {
  const channels = baseChannels();
  const decay = smoothstep(progressBetween(elapsedMs, 0, 1600));
  channels.devinEnergyOpacity = 1 - 0.6 * decay;
  channels.devinBodyOpacity = 1 - 0.18 * decay;
  channels.staleRingOpacity = smoothstep(progressBetween(elapsedMs, 360, 1400));
  return clampChannels(channels);
}

export function sampleB2Motion(
  sequence: B2MotionSequence,
  elapsedMs: number,
  reducedMotion = false,
): B2MotionSnapshot {
  const durationMs = B2_MOTION_DURATIONS[sequence];
  const normalizedElapsedMs = reducedMotion
    ? durationMs
    : clamp(elapsedMs, 0, durationMs);

  let channels: B2MotionChannels;
  switch (sequence) {
    case "selected-focus":
      channels = sampleSelectedFocus(normalizedElapsedMs);
      break;
    case "node-appearing":
      channels = sampleNodeAppearing(normalizedElapsedMs);
      break;
    case "devin-event":
      channels = sampleDevinEvent(normalizedElapsedMs);
      break;
    case "devin-stale":
      channels = sampleDevinStale(normalizedElapsedMs);
      break;
  }

  return {
    sequence,
    elapsedMs: normalizedElapsedMs,
    durationMs,
    playback: normalizedElapsedMs >= durationMs ? "finished" : "playing",
    reducedMotion,
    channels,
  };
}

function pageIsVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function useB2MotionTimeline({
  sequence,
  initialTimeMs = 0,
  reducedMotion = false,
  frozen = false,
  autoPlay = true,
}: UseB2MotionTimelineOptions): B2MotionTimeline {
  const durationMs = B2_MOTION_DURATIONS[sequence];
  const initialElapsedMs = reducedMotion ? durationMs : clamp(initialTimeMs, 0, durationMs);
  const [elapsedMs, setElapsedMs] = useState(initialElapsedMs);
  const elapsedRef = useRef(initialElapsedMs);
  const [requestedPlayback, setRequestedPlayback] = useState<MotionPlayback>(
    reducedMotion || initialElapsedMs >= durationMs
      ? "finished"
      : autoPlay
        ? "playing"
        : "idle",
  );
  const [visible, setVisible] = useState(pageIsVisible);
  const previousSequenceRef = useRef(sequence);

  const setElapsed = useCallback((nextElapsedMs: number) => {
    elapsedRef.current = nextElapsedMs;
    setElapsedMs(nextElapsedMs);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => setVisible(pageIsVisible());
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (previousSequenceRef.current === sequence) return;
    previousSequenceRef.current = sequence;
    const nextElapsedMs = reducedMotion ? durationMs : clamp(initialTimeMs, 0, durationMs);
    setElapsed(nextElapsedMs);
    setRequestedPlayback(
      reducedMotion || nextElapsedMs >= durationMs
        ? "finished"
        : autoPlay
          ? "playing"
          : "idle",
    );
  }, [autoPlay, durationMs, initialTimeMs, reducedMotion, sequence, setElapsed]);

  useEffect(() => {
    if (!reducedMotion) return;
    setElapsed(durationMs);
    setRequestedPlayback("finished");
  }, [durationMs, reducedMotion, setElapsed]);

  useEffect(() => {
    if (requestedPlayback !== "playing" || reducedMotion || frozen || !visible) return;

    let frameId = 0;
    let active = true;
    let lastTimestamp: number | undefined;
    const tick = (timestamp: number) => {
      if (!active) return;
      if (lastTimestamp === undefined) {
        lastTimestamp = timestamp;
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      const deltaMs = Math.min(100, Math.max(0, timestamp - lastTimestamp));
      lastTimestamp = timestamp;
      const nextElapsedMs = clamp(elapsedRef.current + deltaMs, 0, durationMs);
      setElapsed(nextElapsedMs);
      if (nextElapsedMs >= durationMs) {
        setRequestedPlayback("finished");
        return;
      }
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      active = false;
      window.cancelAnimationFrame(frameId);
    };
  }, [durationMs, frozen, reducedMotion, requestedPlayback, setElapsed, visible]);

  const replay = useCallback(() => {
    const nextElapsedMs = reducedMotion ? durationMs : 0;
    setElapsed(nextElapsedMs);
    setRequestedPlayback(reducedMotion ? "finished" : "playing");
  }, [durationMs, reducedMotion, setElapsed]);

  const pause = useCallback(() => {
    setRequestedPlayback((current) => current === "finished" ? current : "paused");
  }, []);

  const resume = useCallback(() => {
    if (reducedMotion || elapsedRef.current >= durationMs) return;
    setRequestedPlayback("playing");
  }, [durationMs, reducedMotion]);

  const seek = useCallback((nextElapsedMs: number) => {
    const clampedElapsedMs = reducedMotion ? durationMs : clamp(nextElapsedMs, 0, durationMs);
    setElapsed(clampedElapsedMs);
    setRequestedPlayback(clampedElapsedMs >= durationMs ? "finished" : "paused");
  }, [durationMs, reducedMotion, setElapsed]);

  const snapshot = useMemo(() => {
    const sequenceJustChanged = previousSequenceRef.current !== sequence;
    const snapshotElapsedMs = sequenceJustChanged
      ? reducedMotion
        ? durationMs
        : clamp(initialTimeMs, 0, durationMs)
      : elapsedMs;
    const sampled = sampleB2Motion(sequence, snapshotElapsedMs, reducedMotion);
    const playback: MotionPlayback = frozen
      ? "paused"
      : reducedMotion || snapshotElapsedMs >= durationMs
        ? "finished"
        : !visible
        ? "paused"
        : requestedPlayback;
    return { ...sampled, playback };
  }, [durationMs, elapsedMs, frozen, initialTimeMs, reducedMotion, requestedPlayback, sequence, visible]);

  return useMemo(
    () => ({ snapshot, replay, pause, resume, seek }),
    [pause, replay, resume, seek, snapshot],
  );
}

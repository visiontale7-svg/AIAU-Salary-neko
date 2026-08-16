import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  B2_MOTION_DURATIONS,
  NODE_APPEARANCE_PARTICLES,
  sampleB2Motion,
  useB2MotionTimeline,
  type B2MotionChannels,
  type B2MotionSequence,
} from "./b2-motion";

const SEQUENCES: B2MotionSequence[] = [
  "selected-focus",
  "node-appearing",
  "devin-event",
  "devin-stale",
];

function channelValues(channels: B2MotionChannels): number[] {
  return Object.values(channels);
}

describe("sampleB2Motion", () => {
  it("uses the locked durations and twelve deterministic condensation particles", () => {
    expect(B2_MOTION_DURATIONS).toEqual({
      "selected-focus": 520,
      "node-appearing": 1450,
      "devin-event": 850,
      "devin-stale": 1600,
    });
    expect(NODE_APPEARANCE_PARTICLES).toHaveLength(12);
    expect(new Set(NODE_APPEARANCE_PARTICLES.map((particle) => particle.id)).size).toBe(12);
    expect(NODE_APPEARANCE_PARTICLES).toEqual([...NODE_APPEARANCE_PARTICLES]);
  });

  it("clamps bad times and never emits non-finite channel values", () => {
    for (const sequence of SEQUENCES) {
      const start = sampleB2Motion(sequence, Number.NaN);
      const end = sampleB2Motion(sequence, Number.POSITIVE_INFINITY);
      expect(start.elapsedMs).toBe(0);
      expect(end.elapsedMs).toBe(B2_MOTION_DURATIONS[sequence]);
      for (const value of [...channelValues(start.channels), ...channelValues(end.channels)]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(start.channels.focusRingScale).toBeGreaterThanOrEqual(1);
      expect(start.channels.focusRingScale).toBeLessThanOrEqual(1.34);
    }
  });

  it("contracts the selected focus ring before handing off to the static selected state", () => {
    const start = sampleB2Motion("selected-focus", 0);
    const focused = sampleB2Motion("selected-focus", 180);
    const handoff = sampleB2Motion("selected-focus", 350);
    const end = sampleB2Motion("selected-focus", 520);

    expect(start.channels.focusRingScale).toBeCloseTo(1.34);
    expect(start.channels.focusRingOpacity).toBe(0);
    expect(focused.channels.focusRingScale).toBe(1);
    expect(focused.channels.auraBoost).toBe(1);
    expect(handoff.channels.focusRingOpacity).toBeGreaterThan(0);
    expect(handoff.channels.selectedHandoff).toBeGreaterThan(0);
    expect(end.channels.focusRingOpacity).toBe(0);
    expect(end.channels.auraBoost).toBe(0);
    expect(end.channels.selectedHandoff).toBe(1);
    expect(end.playback).toBe("finished");
  });

  it("samples the new-node path, condensation, body and label in order", () => {
    const start = sampleB2Motion("node-appearing", 0);
    const particles = sampleB2Motion("node-appearing", 600);
    const body = sampleB2Motion("node-appearing", 900);
    const label = sampleB2Motion("node-appearing", 1250);
    const end = sampleB2Motion("node-appearing", 1450);

    expect(start.channels.pathProgress).toBe(0);
    expect(start.channels.coreOpacity).toBe(0);
    expect(start.channels.auraOpacity).toBe(0);
    expect(start.channels.labelOpacity).toBe(0);
    expect(particles.channels.particleProgress).toBeGreaterThan(0);
    expect(particles.channels.particleOpacity).toBeGreaterThan(0);
    expect(body.channels.pathProgress).toBe(1);
    expect(body.channels.coreOpacity).toBe(1);
    expect(body.channels.shellOpacity).toBeGreaterThan(0);
    expect(label.channels.labelOpacity).toBeGreaterThan(0);
    expect(end.channels.auraOpacity).toBe(1);
    expect(end.channels.shellOpacity).toBe(1);
    expect(end.channels.labelOpacity).toBe(1);
  });

  it("defines deterministic one-shot Devin event and stale end states", () => {
    const eventMidpoint = sampleB2Motion("devin-event", 680);
    const eventEnd = sampleB2Motion("devin-event", 850);
    const staleEnd = sampleB2Motion("devin-stale", 1600);

    expect(eventMidpoint.channels.pathProgress).toBeGreaterThan(0.9);
    expect(eventMidpoint.channels.devinHazeBoost).toBeGreaterThan(0);
    expect(eventEnd.channels.devinHazeBoost).toBe(0);
    expect(staleEnd.channels.devinEnergyOpacity).toBeCloseTo(0.4);
    expect(staleEnd.channels.devinBodyOpacity).toBeCloseTo(0.82);
    expect(staleEnd.channels.staleRingOpacity).toBe(1);
  });

  it("collapses every sequence directly to its final static reduced-motion state", () => {
    for (const sequence of SEQUENCES) {
      const reduced = sampleB2Motion(sequence, 0, true);
      const finalFrame = sampleB2Motion(sequence, B2_MOTION_DURATIONS[sequence]);
      expect(reduced.elapsedMs).toBe(B2_MOTION_DURATIONS[sequence]);
      expect(reduced.playback).toBe("finished");
      expect(reduced.reducedMotion).toBe(true);
      expect(reduced.channels).toEqual(finalFrame.channels);
    }
  });
});

describe("useB2MotionTimeline", () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let cancelAnimationFrame: ReturnType<typeof vi.fn>;
  let nextFrameId: number;

  beforeEach(() => {
    callbacks = new Map();
    nextFrameId = 0;
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const frameId = ++nextFrameId;
      callbacks.set(frameId, callback);
      return frameId;
    }));
    cancelAnimationFrame = vi.fn((frameId: number) => {
      callbacks.delete(frameId);
    });
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function runFrame(timestamp: number) {
    const pending = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
    const callback = pending?.[1];
    if (pending) callbacks.delete(pending[0]);
    expect(callback).toBeTypeOf("function");
    act(() => callback?.(timestamp));
  }

  it("advances only while playing and exposes pause, resume, seek and replay", () => {
    const { result } = renderHook(() => useB2MotionTimeline({ sequence: "selected-focus" }));
    expect(result.current.snapshot.playback).toBe("playing");
    expect(callbacks).toHaveLength(1);

    runFrame(100);
    runFrame(200);
    expect(result.current.snapshot.elapsedMs).toBe(100);

    act(() => result.current.pause());
    expect(result.current.snapshot.playback).toBe("paused");
    expect(cancelAnimationFrame).toHaveBeenCalled();

    act(() => result.current.seek(300));
    expect(result.current.snapshot.elapsedMs).toBe(300);
    expect(result.current.snapshot.playback).toBe("paused");

    act(() => result.current.resume());
    expect(result.current.snapshot.playback).toBe("playing");

    act(() => result.current.replay());
    expect(result.current.snapshot.elapsedMs).toBe(0);
    expect(result.current.snapshot.playback).toBe("playing");
  });

  it("does not request animation frames for frozen or reduced motion", () => {
    const frozen = renderHook(() => useB2MotionTimeline({ sequence: "node-appearing", frozen: true }));
    expect(frozen.result.current.snapshot.playback).toBe("paused");
    expect(callbacks).toHaveLength(0);
    frozen.unmount();

    const reduced = renderHook(() => useB2MotionTimeline({ sequence: "node-appearing", reducedMotion: true }));
    expect(reduced.result.current.snapshot.elapsedMs).toBe(1450);
    expect(reduced.result.current.snapshot.playback).toBe("finished");
    expect(callbacks).toHaveLength(0);
  });

  it("reports a frozen reduced-motion query frame as paused", () => {
    const { result } = renderHook(() => useB2MotionTimeline({
      sequence: "node-appearing",
      reducedMotion: true,
      frozen: true,
    }));
    expect(result.current.snapshot.elapsedMs).toBe(1450);
    expect(result.current.snapshot.playback).toBe("paused");
    expect(callbacks).toHaveLength(0);
  });

  it("stays idle without requesting a frame until replay starts it", () => {
    const { result } = renderHook(() => useB2MotionTimeline({
      sequence: "selected-focus",
      autoPlay: false,
    }));
    expect(result.current.snapshot.elapsedMs).toBe(0);
    expect(result.current.snapshot.playback).toBe("idle");
    expect(callbacks).toHaveLength(0);

    act(() => result.current.replay());
    expect(result.current.snapshot.playback).toBe("playing");
    expect(callbacks).toHaveLength(1);
  });

  it("pauses while hidden and resumes without catching up hidden time", () => {
    const { result } = renderHook(() => useB2MotionTimeline({ sequence: "selected-focus" }));
    runFrame(10);
    runFrame(110);
    expect(result.current.snapshot.elapsedMs).toBe(100);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.snapshot.playback).toBe("paused");
    expect(callbacks).toHaveLength(0);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.snapshot.playback).toBe("playing");
    runFrame(10_000);
    runFrame(10_016);
    expect(result.current.snapshot.elapsedMs).toBe(116);
  });

  it("cancels the pending frame on unmount", () => {
    const { unmount } = renderHook(() => useB2MotionTimeline({ sequence: "selected-focus" }));
    expect(callbacks).toHaveLength(1);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(callbacks).toHaveLength(0);
  });

  it("stops requesting frames at the terminal frame", () => {
    const { result } = renderHook(() => useB2MotionTimeline({
      sequence: "selected-focus",
      initialTimeMs: 500,
    }));
    runFrame(0);
    runFrame(25);
    expect(result.current.snapshot.elapsedMs).toBe(520);
    expect(result.current.snapshot.playback).toBe("finished");
    expect(callbacks).toHaveLength(0);
  });

  it("caps a single animation-frame delta at 100ms", () => {
    const { result } = renderHook(() => useB2MotionTimeline({ sequence: "selected-focus" }));
    runFrame(0);
    runFrame(5_000);
    expect(result.current.snapshot.elapsedMs).toBe(100);
    runFrame(5_016);
    expect(result.current.snapshot.elapsedMs).toBe(116);
  });

  it("resets elapsed time when the sequence changes", () => {
    const { result, rerender } = renderHook(
      ({ sequence, initialTimeMs }: { sequence: B2MotionSequence; initialTimeMs: number }) =>
        useB2MotionTimeline({ sequence, initialTimeMs, frozen: true }),
      { initialProps: { sequence: "selected-focus" as B2MotionSequence, initialTimeMs: 260 } },
    );
    expect(result.current.snapshot.elapsedMs).toBe(260);

    rerender({ sequence: "node-appearing", initialTimeMs: 400 });
    expect(result.current.snapshot.sequence).toBe("node-appearing");
    expect(result.current.snapshot.elapsedMs).toBe(400);
    expect(result.current.snapshot.playback).toBe("paused");
  });
});

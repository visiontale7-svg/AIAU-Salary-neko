import { describe, expect, it } from "vitest";
import {
  B2_BACKGROUND_HEIGHT,
  B2_BACKGROUND_SEED,
  B2_BACKGROUND_WIDTH,
  B2_GLINT_COUNT,
  B2_PARTICLE_COUNT,
  clampB2DevicePixelRatio,
  createB2StarfieldPlan,
  measureB2UpperRightToLowerDensity,
  sampleB2ParticleAlpha,
} from "./b2-background";

describe("B2 deterministic background", () => {
  it("generates the same plan byte-for-byte for the same seed", () => {
    const first = createB2StarfieldPlan({ seed: B2_BACKGROUND_SEED });
    const second = createB2StarfieldPlan({ seed: B2_BACKGROUND_SEED });

    expect(second).toEqual(first);
    expect(createB2StarfieldPlan({ seed: B2_BACKGROUND_SEED + 1 })).not.toEqual(first);
  });

  it("keeps the bounded particle and glint budget", () => {
    const plan = createB2StarfieldPlan();

    expect(plan.width).toBe(B2_BACKGROUND_WIDTH);
    expect(plan.height).toBe(B2_BACKGROUND_HEIGHT);
    expect(plan.particles).toHaveLength(B2_PARTICLE_COUNT);
    expect(plan.particles.length).toBeGreaterThanOrEqual(30);
    expect(plan.particles.length).toBeLessThanOrEqual(50);
    expect(plan.glints).toHaveLength(B2_GLINT_COUNT);
    expect(plan.glints.length).toBeLessThanOrEqual(12);

    for (const item of [...plan.particles, ...plan.glints]) {
      expect(Number.isFinite(item.x)).toBe(true);
      expect(Number.isFinite(item.y)).toBe(true);
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.x).toBeLessThanOrEqual(plan.width);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeLessThanOrEqual(plan.height);
    }
  });

  it("makes the upper-right field 2.2x to 2.8x denser than the lower field", () => {
    const ratio = measureB2UpperRightToLowerDensity(createB2StarfieldPlan());

    expect(ratio).toBeGreaterThanOrEqual(2.2);
    expect(ratio).toBeLessThanOrEqual(2.8);
  });

  it("uses four perceptually animated particles and otherwise remains static", () => {
    const plan = createB2StarfieldPlan();
    const animated = plan.particles.filter((particle) => particle.twinkleAmplitude > 0);
    const dust = plan.particles.filter((particle) => particle.radius < 0.6);
    const medium = plan.particles.filter((particle) => particle.radius >= 0.6 && particle.radius < 1.2);
    const large = plan.particles.filter((particle) => particle.radius >= 1.2);

    expect(animated).toHaveLength(4);
    expect(dust).toHaveLength(35);
    expect(medium).toHaveLength(7);
    expect(large).toHaveLength(2);
    expect(plan.glints.filter((glint) => glint.twinkleAmplitude > 0)).toHaveLength(2);
  });

  it("freezes alpha in static mode and clamps device pixel ratio to two", () => {
    const particle = createB2StarfieldPlan().particles.find((item) => item.twinkleAmplitude > 0);
    expect(particle).toBeDefined();

    expect(sampleB2ParticleAlpha(particle!, 4.25, false)).toBe(particle!.alpha);
    expect(sampleB2ParticleAlpha(particle!, 4.25, true)).not.toBe(particle!.alpha);
    expect(clampB2DevicePixelRatio(0.75)).toBe(1);
    expect(clampB2DevicePixelRatio(1.5)).toBe(1.5);
    expect(clampB2DevicePixelRatio(3)).toBe(2);
    expect(clampB2DevicePixelRatio(Number.NaN)).toBe(1);
  });
});

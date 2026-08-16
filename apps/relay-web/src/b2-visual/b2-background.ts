export const B2_BACKGROUND_WIDTH = 1100;
export const B2_BACKGROUND_HEIGHT = 992;
export const B2_BACKGROUND_SEED = 0x0b2a71a5;
export const B2_PARTICLE_COUNT = 44;
export const B2_GLINT_COUNT = 8;

export interface B2BackgroundParticle {
  id: string;
  x: number;
  y: number;
  radius: number;
  alpha: number;
  color: string;
  twinkleAmplitude: number;
  twinklePhase: number;
  twinkleDurationSeconds: number;
}

export interface B2BackgroundGlint {
  id: string;
  x: number;
  y: number;
  size: number;
  alpha: number;
  twinkleAmplitude: number;
  twinklePhase: number;
  twinkleDurationSeconds: number;
}

export interface B2StarfieldPlan {
  seed: number;
  width: number;
  height: number;
  particles: B2BackgroundParticle[];
  glints: B2BackgroundGlint[];
}

export interface B2NebulaTexture {
  /** A decoded, local CanvasImageSource. The renderer never fetches a URL. */
  source: CanvasImageSource;
  opacity?: number;
}

export interface B2BackgroundFrameOptions {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  texture?: B2NebulaTexture;
  timeSeconds?: number;
  animate?: boolean;
}

interface NormalizedRegion {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const UPPER_RIGHT_REGION: NormalizedRegion = {
  minX: 0.58,
  maxX: 0.98,
  minY: 0.07,
  maxY: 0.39,
};

const LOWER_REGION: NormalizedRegion = {
  minX: 0.04,
  maxX: 0.98,
  minY: 0.57,
  maxY: 0.96,
};

const MIDDLE_REGION: NormalizedRegion = {
  minX: 0.04,
  maxX: 0.56,
  minY: 0.07,
  maxY: 0.55,
};

const PARTICLE_COLORS = ["#dbeaff", "#b9d3f2", "#8fb7e6", "#f2f7ff"] as const;

const NORMALIZED_GLINTS = [
  [0.338, 0.046, 1.55],
  [0.536, 0.114, 2.15],
  [0.602, 0.151, 2.85],
  [0.282, 0.281, 1.8],
  [0.545, 0.555, 2.35],
  [0.820, 0.545, 1.65],
  [0.409, 0.686, 1.45],
  [0.691, 0.796, 1.35],
] as const;

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = B2_BACKGROUND_SEED;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

function particleRadii(random: () => number): number[] {
  const radii = [
    ...Array.from({ length: 35 }, () => round(0.24 + random() * 0.32)),
    ...Array.from({ length: 7 }, () => round(0.72 + random() * 0.36)),
    ...Array.from({ length: 2 }, () => round(1.5 + random() * 0.42)),
  ];
  return shuffle(radii, random);
}

function createPositions(
  count: number,
  region: NormalizedRegion,
  width: number,
  height: number,
  random: () => number,
): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, () => ({
    x: round(width * (region.minX + (region.maxX - region.minX) * (0.025 + random() * 0.95))),
    y: round(height * (region.minY + (region.maxY - region.minY) * (0.025 + random() * 0.95))),
  }));
}

export function createB2StarfieldPlan(options: {
  seed?: number;
  width?: number;
  height?: number;
} = {}): B2StarfieldPlan {
  const seed = options.seed ?? B2_BACKGROUND_SEED;
  const width = options.width ?? B2_BACKGROUND_WIDTH;
  const height = options.height ?? B2_BACKGROUND_HEIGHT;
  const random = createRandom(seed);
  const radii = particleRadii(random);

  // Exact regional counts keep the perceptual density stable across browsers.
  // 14 / upper-right-area versus 16 / lower-area yields ~2.5x density.
  const positions = [
    ...createPositions(14, UPPER_RIGHT_REGION, width, height, random),
    ...createPositions(16, LOWER_REGION, width, height, random),
    ...createPositions(14, MIDDLE_REGION, width, height, random),
  ];

  const animatedIndices = new Set(shuffle(Array.from({ length: positions.length }, (_, index) => index), random).slice(0, 4));
  const particles = positions.map((position, index): B2BackgroundParticle => {
    const radius = radii[index];
    const isAnimated = animatedIndices.has(index);
    const alphaRange = radius < 0.6 ? [0.18, 0.46] : radius < 1.2 ? [0.34, 0.62] : [0.5, 0.74];

    return {
      id: `b2-particle-${String(index + 1).padStart(2, "0")}`,
      ...position,
      radius,
      alpha: round(alphaRange[0] + random() * (alphaRange[1] - alphaRange[0])),
      color: PARTICLE_COLORS[Math.floor(random() * PARTICLE_COLORS.length)],
      twinkleAmplitude: isAnimated ? round(0.07 + random() * 0.07) : 0,
      twinklePhase: round(random() * Math.PI * 2),
      twinkleDurationSeconds: round(6 + random() * 6),
    };
  });

  const glints = NORMALIZED_GLINTS.map(([x, y, size], index): B2BackgroundGlint => ({
    id: `b2-glint-${String(index + 1).padStart(2, "0")}`,
    x: round(width * x),
    y: round(height * y),
    size,
    alpha: round(0.4 + random() * 0.18),
    twinkleAmplitude: index === 2 || index === 4 ? round(0.08 + random() * 0.05) : 0,
    twinklePhase: round(random() * Math.PI * 2),
    twinkleDurationSeconds: round(8 + random() * 4),
  }));

  return { seed, width, height, particles, glints };
}

function normalizedRegionArea(region: NormalizedRegion, width: number, height: number): number {
  return (region.maxX - region.minX) * width * (region.maxY - region.minY) * height;
}

function isInsideRegion(
  point: Pick<B2BackgroundParticle, "x" | "y">,
  region: NormalizedRegion,
  width: number,
  height: number,
): boolean {
  return point.x >= region.minX * width
    && point.x < region.maxX * width
    && point.y >= region.minY * height
    && point.y < region.maxY * height;
}

export function measureB2UpperRightToLowerDensity(plan: B2StarfieldPlan): number {
  const upperRightCount = plan.particles.filter((particle) => isInsideRegion(particle, UPPER_RIGHT_REGION, plan.width, plan.height)).length;
  const lowerCount = plan.particles.filter((particle) => isInsideRegion(particle, LOWER_REGION, plan.width, plan.height)).length;
  const upperRightDensity = upperRightCount / normalizedRegionArea(UPPER_RIGHT_REGION, plan.width, plan.height);
  const lowerDensity = lowerCount / normalizedRegionArea(LOWER_REGION, plan.width, plan.height);
  return upperRightDensity / lowerDensity;
}

export function clampB2DevicePixelRatio(devicePixelRatio: number): number {
  return clamp(Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1, 1, 2);
}

export function sampleB2ParticleAlpha(
  item: Pick<B2BackgroundParticle | B2BackgroundGlint, "alpha" | "twinkleAmplitude" | "twinklePhase" | "twinkleDurationSeconds">,
  timeSeconds: number,
  animate: boolean,
): number {
  if (!animate || item.twinkleAmplitude === 0) return item.alpha;
  const angle = item.twinklePhase + (timeSeconds / item.twinkleDurationSeconds) * Math.PI * 2;
  return clamp(item.alpha + Math.sin(angle) * item.twinkleAmplitude, 0, 1);
}

function drawFallbackNebula(context: CanvasRenderingContext2D, width: number, height: number): void {
  const cloud = context.createRadialGradient(width * 0.82, height * 0.18, 0, width * 0.82, height * 0.18, width * 0.46);
  cloud.addColorStop(0, "rgba(84, 126, 174, 0.14)");
  cloud.addColorStop(0.34, "rgba(41, 79, 120, 0.075)");
  cloud.addColorStop(1, "rgba(8, 25, 46, 0)");
  context.fillStyle = cloud;
  context.fillRect(0, 0, width, height * 0.72);
}

function drawParticle(context: CanvasRenderingContext2D, particle: B2BackgroundParticle, alpha: number): void {
  context.save();
  context.translate(particle.x, particle.y);
  context.globalAlpha = alpha;
  context.fillStyle = particle.color;
  context.strokeStyle = particle.color;

  if (particle.radius < 0.6) {
    context.beginPath();
    context.arc(0, 0, particle.radius, 0, Math.PI * 2);
    context.fill();
  } else if (particle.radius < 1.2) {
    const radius = particle.radius;
    context.beginPath();
    context.moveTo(0, -radius * 1.45);
    context.lineTo(radius * 0.72, 0);
    context.lineTo(0, radius * 1.45);
    context.lineTo(-radius * 0.72, 0);
    context.closePath();
    context.fill();
  } else {
    context.lineWidth = 0.28;
    context.beginPath();
    context.moveTo(0, -particle.radius * 3.8);
    context.lineTo(0, particle.radius * 3.8);
    context.moveTo(-particle.radius * 1.55, 0);
    context.lineTo(particle.radius * 1.55, 0);
    context.stroke();
    context.beginPath();
    context.arc(0, 0, particle.radius * 0.64, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawGlint(context: CanvasRenderingContext2D, glint: B2BackgroundGlint, alpha: number): void {
  context.save();
  context.translate(glint.x, glint.y);
  context.globalAlpha = alpha;

  const bloom = context.createRadialGradient(0, 0, 0, 0, 0, glint.size * 3.8);
  bloom.addColorStop(0, "rgba(245, 250, 255, 0.8)");
  bloom.addColorStop(0.18, "rgba(125, 180, 240, 0.24)");
  bloom.addColorStop(1, "rgba(87, 142, 205, 0)");
  context.globalCompositeOperation = "lighter";
  context.fillStyle = bloom;
  context.beginPath();
  context.arc(0, 0, glint.size * 3.8, 0, Math.PI * 2);
  context.fill();

  context.globalCompositeOperation = "source-over";
  context.strokeStyle = "rgba(184, 216, 252, 0.75)";
  context.lineWidth = 0.3;
  context.beginPath();
  context.moveTo(0, -glint.size * 5.2);
  context.lineTo(0, glint.size * 5.2);
  context.moveTo(-glint.size * 1.8, 0);
  context.lineTo(glint.size * 1.8, 0);
  context.stroke();

  context.fillStyle = "#fbfdff";
  context.beginPath();
  context.arc(0, 0, Math.max(0.55, glint.size * 0.34), 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function renderB2BackgroundFrame(
  context: CanvasRenderingContext2D,
  plan: B2StarfieldPlan,
  options: B2BackgroundFrameOptions,
): void {
  const cssWidth = Math.max(1, options.cssWidth);
  const cssHeight = Math.max(1, options.cssHeight);
  const dpr = clampB2DevicePixelRatio(options.dpr);
  const timeSeconds = options.timeSeconds ?? 0;
  const animate = options.animate ?? false;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = "#00040a";
  context.fillRect(0, 0, cssWidth, cssHeight);

  if (options.texture) {
    context.save();
    // The local texture contains a photographed black sky. Screen blending lets
    // the nebula and dust illuminate the calibrated deep-space base without
    // replacing that base with the texture's black pixels.
    context.globalCompositeOperation = "screen";
    context.globalAlpha = options.texture.opacity ?? 0.62;
    const textureOffsetX = cssWidth * (30 / B2_BACKGROUND_WIDTH);
    const textureOffsetY = cssHeight * (45 / B2_BACKGROUND_HEIGHT);
    context.drawImage(options.texture.source, textureOffsetX, textureOffsetY, cssWidth, cssHeight);
    context.restore();
  } else {
    drawFallbackNebula(context, cssWidth, cssHeight);
  }

  const cloudWash = context.createRadialGradient(
    cssWidth * 0.82,
    cssHeight * 0.26,
    0,
    cssWidth * 0.82,
    cssHeight * 0.26,
    cssWidth * 0.42,
  );
  cloudWash.addColorStop(0, "rgba(66, 103, 151, 0.05)");
  cloudWash.addColorStop(0.46, "rgba(34, 70, 111, 0.025)");
  cloudWash.addColorStop(1, "rgba(7, 20, 38, 0)");
  context.fillStyle = cloudWash;
  context.fillRect(0, 0, cssWidth, cssHeight);

  const vignette = context.createRadialGradient(cssWidth * 0.68, cssHeight * 0.34, cssWidth * 0.12, cssWidth * 0.56, cssHeight * 0.46, cssWidth * 0.78);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.62, "rgba(0, 3, 8, 0.08)");
  vignette.addColorStop(1, "rgba(0, 3, 8, 0.42)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, cssWidth, cssHeight);

  context.setTransform(dpr * cssWidth / plan.width, 0, 0, dpr * cssHeight / plan.height, 0, 0);
  plan.particles.forEach((particle) => {
    drawParticle(context, particle, sampleB2ParticleAlpha(particle, timeSeconds, animate));
  });
  plan.glints.forEach((glint) => {
    drawGlint(context, glint, sampleB2ParticleAlpha(glint, timeSeconds, animate));
  });
  context.setTransform(1, 0, 0, 1, 0, 0);
}

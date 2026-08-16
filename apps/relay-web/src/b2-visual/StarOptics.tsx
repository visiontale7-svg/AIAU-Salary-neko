import { useId, type CSSProperties } from "react";
import { HALO_ASSETS, type HaloAssetDefinition, type HaloAssetKey } from "./halo-assets";
import "./star-optics.css";

export type Tone = "blue" | "violet" | "cyan" | "green" | "orange" | "red" | "silver";

export type StarOpticsFamily =
  | "root"
  | "source"
  | "team"
  | "question"
  | "candidate"
  | "devin";

export type StarOpticsState = "idle" | "hover" | "selected";

export interface StarOpticsSpec {
  family: StarOpticsFamily;
  tone: Tone;
  assetKey?: HaloAssetKey;
  energy: 1 | 2 | 3;
  shellRadius: number;
  coreSize: number;
}

export interface StarOpticsProps {
  spec: StarOpticsSpec;
  state?: StarOpticsState;
  x?: number;
  y?: number;
  scale?: number;
  className?: string;
}

type StarStyle = CSSProperties & {
  "--star-tone": string;
  "--star-pale": string;
  "--star-energy": string;
};

const TONE_COLORS: Record<Tone, { tone: string; shell: string; pale: string }> = {
  blue: { tone: "#4d9eff", shell: "#91caff", pale: "#d9efff" },
  violet: { tone: "#9367f2", shell: "#bea5ff", pale: "#eee5ff" },
  cyan: { tone: "#42c5ca", shell: "#8fe0e4", pale: "#defdff" },
  green: { tone: "#94c27d", shell: "#bce1aa", pale: "#f0ffe9" },
  orange: { tone: "#e7a34d", shell: "#f2c383", pale: "#fff1da" },
  red: { tone: "#e46c62", shell: "#efa49d", pale: "#ffe7e4" },
  silver: { tone: "#c8d5e4", shell: "#dde6f0", pale: "#f4f8fc" },
};

const AURA_SIZES: Readonly<Record<Exclude<StarOpticsFamily, "devin">, number>> = {
  root: 176,
  source: 144,
  team: 80,
  question: 88,
  candidate: 88,
};

const ENERGY_FACTORS: Readonly<Record<StarOpticsSpec["energy"], number>> = {
  1: 0.76,
  2: 1,
  3: 1.2,
};

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

function transformAround(x: number, y: number, scale: number): string | undefined {
  if (scale === 1) return undefined;
  return `translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`;
}

function starStyle(spec: StarOpticsSpec): StarStyle {
  const colors = TONE_COLORS[spec.tone];
  return {
    "--star-tone": colors.tone,
    "--star-pale": colors.pale,
    "--star-energy": String(ENERGY_FACTORS[spec.energy]),
  };
}

function requireAuraAsset(spec: StarOpticsSpec): HaloAssetDefinition {
  if (spec.family === "devin") {
    throw new Error("Devin optics do not use a normal star aura asset.");
  }
  if (!spec.assetKey) {
    throw new Error(`Star optics family "${spec.family}" requires an explicit halo assetKey.`);
  }

  const asset = HALO_ASSETS[spec.assetKey];
  if (!asset) {
    throw new Error(`Missing deterministic halo asset "${spec.assetKey}".`);
  }
  return asset;
}

/**
 * Far-field optical pass. Render after path atmosphere and before the sharp
 * path core so the line can enter a bright atmosphere without being blurred.
 */
export function StarAura({
  spec,
  x = 0,
  y = 0,
  scale = 1,
  className,
}: Omit<StarOpticsProps, "state">) {
  const filterStem = sanitizeId(useId());
  if (spec.family === "devin") {
    return (
      <g
        aria-hidden="true"
        className={["b2-star-aura", "b2-star-aura--devin", className].filter(Boolean).join(" ")}
        data-star-aura-family="devin"
        pointerEvents="none"
        transform={transformAround(x, y, scale)}
      />
    );
  }

  const asset = requireAuraAsset(spec);
  const size = AURA_SIZES[spec.family];
  if (asset.displaySize !== size) {
    throw new Error(
      `Halo asset "${spec.assetKey}" has display size ${asset.displaySize}; expected ${size} for ${spec.family}.`,
    );
  }
  const half = size / 2;
  const bloomFilterId = `star-aura-bloom-${filterStem}`;
  const diffractionFilterId = `star-aura-diffraction-${filterStem}`;

  return (
    <g
      aria-hidden="true"
      className={["b2-star-aura", `b2-star-aura--${spec.family}`, className].filter(Boolean).join(" ")}
      data-star-aura-family={spec.family}
      data-star-energy={spec.energy}
      pointerEvents="none"
      style={starStyle(spec)}
      transform={transformAround(x, y, scale)}
    >
      <defs>
        <filter
          id={bloomFilterId}
          x={x - 44}
          y={y - 44}
          width={88}
          height={88}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="5.4" />
        </filter>
        <filter
          id={diffractionFilterId}
          x={x - 20}
          y={y - 56}
          width={40}
          height={112}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1.25" />
        </filter>
      </defs>

      <image
        className="b2-star-aura__texture"
        x={x - half}
        y={y - half}
        width={size}
        height={size}
        href={asset.src}
        preserveAspectRatio="xMidYMid meet"
      />

      <ellipse
        className="b2-star-aura__near-bloom"
        cx={x}
        cy={y}
        rx={spec.shellRadius + 7}
        ry={spec.shellRadius + 5.5}
        fill="var(--star-pale)"
        filter={`url(#${bloomFilterId})`}
      />
      <line
        className="b2-star-aura__diffraction b2-star-aura__diffraction--soft"
        x1={x}
        y1={y - (spec.family === "root" ? 42 : 32)}
        x2={x}
        y2={y + (spec.family === "root" ? 42 : 32)}
        stroke="var(--star-tone)"
        filter={`url(#${diffractionFilterId})`}
      />
      <line
        className="b2-star-aura__diffraction b2-star-aura__diffraction--pale"
        x1={x}
        y1={y - (spec.family === "root" ? 30 : 24)}
        x2={x}
        y2={y + (spec.family === "root" ? 30 : 24)}
        stroke="var(--star-pale)"
      />
    </g>
  );
}

/** Sharp shell and core pass. Render after the sharp path core. */
export function StarBody({
  spec,
  state = "idle",
  x = 0,
  y = 0,
  scale = 1,
  className,
}: StarOpticsProps) {
  const filterStem = sanitizeId(useId());
  const shellFilterId = `star-shell-haze-${filterStem}`;
  const shellToneFilterId = `star-shell-tone-${filterStem}`;
  const shellGradientId = `star-shell-gradient-${filterStem}`;
  const coreFilterId = `star-core-feather-${filterStem}`;
  const coreGradientId = `star-core-gradient-${filterStem}`;
  const plasmaGradientId = `star-plasma-gradient-${filterStem}`;
  const selectedFilterId = `star-selected-${filterStem}`;
  const transform = transformAround(x, y, scale);

  if (spec.family === "devin") {
    return (
      <g
        aria-hidden="true"
        className={["b2-star-body", "b2-star-body--devin", className].filter(Boolean).join(" ")}
        data-star-body-family="devin"
        data-star-state={state}
        pointerEvents="none"
        style={starStyle(spec)}
        transform={transform}
      >
        <defs>
          <filter id={shellFilterId} x={x - 28} y={y - 28} width={56} height={56} filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
        </defs>
        <rect
          className="b2-star-body__devin-haze"
          x={x - 10}
          y={y - 10}
          width={20}
          height={20}
          rx={2}
          fill="var(--star-tone)"
          filter={`url(#${shellFilterId})`}
          transform={`rotate(45 ${x} ${y})`}
        />
        <rect
          className="b2-star-body__devin-shell"
          x={x - 7.5}
          y={y - 7.5}
          width={15}
          height={15}
          rx={1.4}
          fill="#101a26"
          stroke="var(--star-pale)"
          strokeWidth="1.1"
          transform={`rotate(45 ${x} ${y})`}
        />
        <rect
          className="b2-star-body__devin-core"
          x={x - 3.1}
          y={y - 3.1}
          width={6.2}
          height={6.2}
          rx={1.1}
          fill="var(--star-pale)"
          transform={`rotate(45 ${x} ${y})`}
        />
      </g>
    );
  }

  const colors = TONE_COLORS[spec.tone];
  const shellRadius = spec.shellRadius;
  const coreSize = spec.coreSize;
  const hotSide = coreSize * (
    spec.family === "root" ? 1.18
      : spec.family === "source" ? 1.55
      : 0.82
  );
  const shellStroke = spec.family === "team" ? 0.8 : 1.05;

  return (
    <g
      aria-hidden="true"
      className={[
        "b2-star-body",
        `b2-star-body--${spec.family}`,
        `b2-star-body--${state}`,
        className,
      ].filter(Boolean).join(" ")}
      data-star-body-family={spec.family}
      data-star-energy={spec.energy}
      data-star-state={state}
      pointerEvents="none"
      style={starStyle(spec)}
      transform={transform}
    >
      <defs>
        <filter
          id={shellFilterId}
          x={x - shellRadius - 18}
          y={y - shellRadius - 18}
          width={(shellRadius + 18) * 2}
          height={(shellRadius + 18) * 2}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="2.7" />
        </filter>
        <filter
          id={coreFilterId}
          x={x - 18}
          y={y - 18}
          width={36}
          height={36}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1.45" />
        </filter>
        <filter
          id={shellToneFilterId}
          x={x - shellRadius - 8}
          y={y - shellRadius - 8}
          width={(shellRadius + 8) * 2}
          height={(shellRadius + 8) * 2}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1.05" />
        </filter>
        <filter
          id={selectedFilterId}
          x={x - shellRadius - 18}
          y={y - shellRadius - 18}
          width={(shellRadius + 18) * 2}
          height={(shellRadius + 18) * 2}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
        <radialGradient id={coreGradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="0.54" stopColor="#ffffff" stopOpacity="0.99" />
          <stop offset="0.79" stopColor={colors.pale} stopOpacity="0.82" />
          <stop offset="1" stopColor={colors.pale} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={plasmaGradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.78" />
          <stop offset="0.44" stopColor={colors.pale} stopOpacity="0.72" />
          <stop offset="0.72" stopColor={colors.pale} stopOpacity="0.46" />
          <stop offset="1" stopColor={colors.tone} stopOpacity="0.1" />
        </radialGradient>
        <linearGradient
          id={shellGradientId}
          gradientUnits="userSpaceOnUse"
          x1={x - shellRadius}
          y1={y - shellRadius}
          x2={x + shellRadius}
          y2={y + shellRadius}
        >
          <stop offset="0" stopColor={colors.pale} />
          <stop offset="0.28" stopColor="#ffffff" />
          <stop offset="0.57" stopColor={colors.shell} />
          <stop offset="0.82" stopColor="#ffffff" />
          <stop offset="1" stopColor={colors.pale} />
        </linearGradient>
      </defs>

      <circle
        className="b2-star-body__shell-haze"
        cx={x}
        cy={y}
        r={shellRadius}
        fill="none"
        stroke="var(--star-pale)"
        strokeWidth={spec.family === "root" ? 5.2 : 4.2}
        filter={`url(#${shellFilterId})`}
      />

      {spec.family === "root" ? (
        <circle
          className="b2-star-body__root-outer-shell"
          cx={x}
          cy={y}
          r={shellRadius + 6.5}
          fill="none"
          stroke="var(--star-tone)"
          strokeWidth="0.9"
        />
      ) : null}

      <circle
        className="b2-star-body__shell-underglow"
        cx={x}
        cy={y}
        r={shellRadius}
        fill="none"
        stroke="var(--star-tone)"
        strokeWidth={spec.family === "team" ? 2.2 : 3.1}
        filter={`url(#${shellToneFilterId})`}
      />

      <circle
        className="b2-star-body__core-plasma"
        cx={x}
        cy={y}
        r={shellRadius - 1.15}
        fill={`url(#${plasmaGradientId})`}
      />
      <circle
        className="b2-star-body__energy-shell-tint"
        cx={x}
        cy={y}
        r={shellRadius}
        fill="none"
        stroke="var(--star-tone)"
        strokeWidth={spec.family === "team" ? 1.5 : 2.1}
      />
      <circle
        className="b2-star-body__energy-shell"
        cx={x}
        cy={y}
        r={shellRadius}
        fill="none"
        stroke={`url(#${shellGradientId})`}
        strokeWidth={shellStroke}
        strokeDasharray={spec.family === "candidate" ? "2.2 2" : undefined}
      />

      <circle
        className="b2-star-body__core-feather"
        cx={x}
        cy={y}
        r={coreSize + 1.1}
        fill={`url(#${coreGradientId})`}
        filter={`url(#${coreFilterId})`}
      />
      <circle
        className="b2-star-body__core-near"
        cx={x}
        cy={y}
        r={coreSize}
        fill={`url(#${coreGradientId})`}
      />
      <rect
        className="b2-star-body__hotspot"
        x={x - hotSide / 2}
        y={y - hotSide / 2}
        width={hotSide}
        height={hotSide}
        rx={Math.max(0.9, hotSide * 0.18)}
        fill="#ffffff"
        transform={`rotate(45 ${x} ${y})`}
      />

      {spec.family === "question" ? (
        <g className="b2-star-body__question-badge" transform={`translate(${x + shellRadius * 0.62} ${y + shellRadius * 0.86})`}>
          <circle r="5.3" fill="#111823" stroke="var(--star-tone)" strokeWidth="0.8" />
          <text y="2.7" textAnchor="middle" fill="var(--star-pale)" fontSize="7.5" fontWeight="650">?</text>
        </g>
      ) : null}

      {state === "selected" ? (
        <>
          <circle
            className="b2-star-body__selection-haze"
            cx={x}
            cy={y}
            r={shellRadius + 7}
            fill="none"
            stroke="var(--star-pale)"
            strokeWidth="2.1"
            filter={`url(#${selectedFilterId})`}
          />
          <circle
            className="b2-star-body__selection"
            cx={x}
            cy={y}
            r={shellRadius + 7}
            fill="none"
            stroke="var(--star-pale)"
            strokeWidth="0.8"
          />
        </>
      ) : null}
    </g>
  );
}

/** Convenience composition for isolated samples. Full B2 may interleave PathCore. */
export function StarOptics(props: StarOpticsProps) {
  const { spec, state = "idle", x = 0, y = 0, scale = 1, className } = props;
  return (
    <g
      className={["b2-star-optics", className].filter(Boolean).join(" ")}
      data-star-optics-family={spec.family}
      data-star-state={state}
      pointerEvents="none"
    >
      <StarAura spec={spec} x={x} y={y} scale={scale} />
      <StarBody spec={spec} state={state} x={x} y={y} scale={scale} />
    </g>
  );
}

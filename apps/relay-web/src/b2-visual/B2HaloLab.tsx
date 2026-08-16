import { useEffect, useState } from "react";
import { decodeHaloAssets, type HaloAssetKey } from "./halo-assets";
import {
  StarAura,
  StarBody,
  type StarOpticsFamily,
  type StarOpticsSpec,
  type StarOpticsState,
  type Tone,
} from "./StarOptics";
import "./b2-halo-lab.css";

type LabStatus = "loading" | "ready" | "fatal";

interface SampleDefinition {
  id: string;
  label: string;
  family: StarOpticsFamily;
  tone: Tone;
  assetKey: HaloAssetKey;
  shellRadius: number;
  coreSize: number;
}

const SOURCE: SampleDefinition = {
  id: "source",
  label: "Source · 蓝白恒星",
  family: "source",
  tone: "blue",
  assetKey: "source-blue-v0",
  shellRadius: 12.5,
  coreSize: 6,
};

const FAMILY_SAMPLES: SampleDefinition[] = [
  { id: "root", label: "Root", family: "root", tone: "blue", assetKey: "root-blue-v0", shellRadius: 13.5, coreSize: 7 },
  { id: "team-violet", label: "Team · Violet", family: "team", tone: "violet", assetKey: "team-violet-v0", shellRadius: 8, coreSize: 4.5 },
  { id: "team-cyan", label: "Team · Cyan", family: "team", tone: "cyan", assetKey: "team-cyan-v0", shellRadius: 8, coreSize: 4.5 },
  { id: "team-green", label: "Team · Green", family: "team", tone: "green", assetKey: "team-green-v0", shellRadius: 8, coreSize: 4.5 },
  { id: "team-orange", label: "Team · Orange", family: "team", tone: "orange", assetKey: "team-orange-v0", shellRadius: 8, coreSize: 4.5 },
  { id: "question", label: "Question", family: "question", tone: "red", assetKey: "question-red-v0", shellRadius: 9, coreSize: 4.8 },
  { id: "candidate", label: "Candidate", family: "candidate", tone: "silver", assetKey: "candidate-silver-v0", shellRadius: 9, coreSize: 4.8 },
];

function SamplePaths({
  pass,
  emphasize = false,
}: {
  pass: "atmosphere" | "core";
  emphasize?: boolean;
}) {
  if (pass === "atmosphere") {
    return (
      <>
        <path className="halo-lab__path halo-lab__path--atmosphere" d="M -7 53 C 18 50, 72 51, 104 45" />
        <path className="halo-lab__path halo-lab__path--branch-atmosphere" d="M 8 102 C 25 77, 36 60, 48 48" />
      </>
    );
  }
  return (
    <>
      <path className="halo-lab__path halo-lab__path--core" d="M -7 53 C 18 50, 72 51, 104 45" />
      <path className="halo-lab__path halo-lab__path--branch-core" d="M 8 102 C 25 77, 36 60, 48 48" />
      {emphasize ? <circle className="halo-lab__path-spark" cx="78" cy="49" r="1.1" /> : null}
    </>
  );
}

function OpticalSample({
  definition,
  energy = 2,
  state = "idle",
  scale = 1,
  sampleId,
  showPaths = false,
}: {
  definition: SampleDefinition;
  energy?: 1 | 2 | 3;
  state?: StarOpticsState;
  scale?: 1 | 2;
  sampleId: string;
  showPaths?: boolean;
}) {
  const spec: StarOpticsSpec = {
    family: definition.family,
    tone: definition.tone,
    assetKey: definition.assetKey,
    energy,
    shellRadius: definition.shellRadius,
    coreSize: definition.coreSize,
  };

  return (
    <div
      className={`halo-lab__sample halo-lab__sample--${scale}x`}
      data-halo-sample={sampleId}
      aria-label={`${definition.label}, energy ${energy}, ${state}, ${scale * 100}%`}
    >
      <svg viewBox="0 0 96 96" role="img" aria-hidden="true">
        {showPaths ? <SamplePaths pass="atmosphere" /> : null}
        <StarAura x={48} y={48} spec={spec} />
        {showPaths ? (
          <>
            <SamplePaths pass="core" emphasize={energy === 2} />
            <path className="halo-lab__path halo-lab__path--core halo-lab__path--washed" d="M 24 51 C 34 50, 42 49, 48 48" />
            <path className="halo-lab__path halo-lab__path--core halo-lab__path--washed" d="M 48 48 C 56 48, 64 48, 72 47" />
            <path className="halo-lab__path halo-lab__path--branch-core halo-lab__path--washed" d="M 30 69 C 38 58, 43 52, 48 48" />
          </>
        ) : null}
        <StarBody x={48} y={48} spec={spec} state={state} />
      </svg>
    </div>
  );
}

export function B2HaloLab() {
  const [status, setStatus] = useState<LabStatus>("loading");
  const [fatalMessage, setFatalMessage] = useState("");

  useEffect(() => {
    let active = true;
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    Promise.all([fontsReady, decodeHaloAssets()])
      .then(() => {
        if (active) setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setFatalMessage(error instanceof Error ? error.message : "Unknown halo asset decode error");
        setStatus("fatal");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main
      className="halo-lab"
      data-halo-lab="true"
      data-runtime="deterministic-visual-fixture"
      data-b2-ready={status === "ready" ? "true" : undefined}
    >
      <header className="halo-lab__header">
        <div>
          <p className="halo-lab__eyebrow">DIALOGUE ATLAS · OPTICAL MATERIAL STUDY</p>
          <h1>星体光晕实验室</h1>
          <p>只校准空气光、能量壳、白核与路径融合。所有画面为冻结的静态帧。</p>
        </div>
        <div className={`halo-lab__status halo-lab__status--${status}`} role="status">
          {status === "loading" ? "正在解码 14 个本地光学纹理" : status === "ready" ? "纹理与字体已就绪" : "视觉验收已阻止"}
        </div>
      </header>

      {status === "fatal" ? (
        <section className="halo-lab__fatal" role="alert" aria-label="Halo asset fatal error">
          <h2>无法加载确定性光晕资产</h2>
          <p>{fatalMessage}</p>
          <p>未启用旧径向渐变回退；请修复资源后重新验收。</p>
        </section>
      ) : (
        <div className="halo-lab__content" aria-busy={status !== "ready"}>
          <section className="halo-lab__section" aria-labelledby="energy-heading">
            <div className="halo-lab__section-heading">
              <div>
                <p className="halo-lab__section-kicker">ENERGY CALIBRATION</p>
                <h2 id="energy-heading">Source 能量校准</h2>
              </div>
              <p>中心固定在 48,48；96×96 ROI；水平主路径与青色斜向分支穿入星核。</p>
            </div>
            <div className="halo-lab__energy-grid">
              {([1, 2, 3] as const).map((energy) => (
                <article className={`halo-lab__card${energy === 2 ? " halo-lab__card--target" : ""}`} key={energy}>
                  <div className="halo-lab__card-title">
                    <span>{energy === 1 ? "低能量" : energy === 2 ? "目标能量" : "高能量"}</span>
                    {energy === 2 ? <strong>APPROVAL TARGET</strong> : <small>CALIBRATION ONLY</small>}
                  </div>
                  <OpticalSample
                    definition={SOURCE}
                    energy={energy}
                    sampleId={energy === 2 ? "source-target-100" : `source-energy-${energy}-100`}
                    showPaths
                  />
                </article>
              ))}
            </div>
          </section>

          <section className="halo-lab__section" aria-labelledby="state-heading">
            <div className="halo-lab__section-heading">
              <div>
                <p className="halo-lab__section-kicker">STATIC INTERACTION FRAMES</p>
                <h2 id="state-heading">Idle / Hover / Selected</h2>
              </div>
              <p>本阶段不运行循环动画；三种状态并排作为静态视觉契约。</p>
            </div>
            <div className="halo-lab__state-grid">
              {(["idle", "hover", "selected"] as const).map((state) => (
                <article className="halo-lab__compact-card" key={state}>
                  <h3>{state[0].toUpperCase() + state.slice(1)}</h3>
                  <OpticalSample definition={SOURCE} state={state} sampleId={`source-${state}-100`} showPaths />
                </article>
              ))}
              <article className="halo-lab__compact-card halo-lab__compact-card--inspection">
                <h3>200% 光学检查</h3>
                <OpticalSample definition={SOURCE} sampleId="source-target-200" showPaths scale={2} />
              </article>
            </div>
          </section>

          <section className="halo-lab__section" aria-labelledby="family-heading">
            <div className="halo-lab__section-heading">
              <div>
                <p className="halo-lab__section-kicker">MATERIAL FAMILIES</p>
                <h2 id="family-heading">光学材质族</h2>
              </div>
              <p>Root、四种 Team、Question 与 Candidate 只共享光学逻辑，不统一颜色和能级。</p>
            </div>
            <div className="halo-lab__family-grid">
              {FAMILY_SAMPLES.map((definition) => (
                <article className="halo-lab__family-card" key={definition.id}>
                  <OpticalSample definition={definition} sampleId={`${definition.id}-target-100`} />
                  <h3>{definition.label}</h3>
                  <p>{definition.family === "root" ? "176px 远场空气光 · 双环核心" : definition.family === "team" ? "80px 克制空气光 · 分支色保留" : "88px 独立语义材质"}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

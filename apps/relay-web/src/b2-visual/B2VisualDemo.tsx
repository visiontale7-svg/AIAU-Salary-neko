import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import "./b2-visual.css";

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

const TONES: Record<Tone, string> = {
  blue: "#66a9ff",
  violet: "#9978e8",
  cyan: "#5bc4c4",
  green: "#9ec77d",
  orange: "#d8a050",
  red: "#d87368",
  silver: "#dbe5f1",
};

const AMBIENT_STARS = Array.from({ length: 520 }, (_, index) => ({
  x: 7 + ((index * 149 + index * index * 17) % 1082),
  y: 9 + ((index * 97 + index * index * 13) % 973),
  radius: index % 61 === 0 ? 1.7 : index % 23 === 0 ? 1.05 : index % 7 === 0 ? .68 : .38,
  opacity: index % 43 === 0 ? .84 : index % 11 === 0 ? .48 : .17 + (index % 4) * .045,
}));

const NEBULA_DUST = Array.from({ length: 220 }, (_, index) => ({
  x: 650 + ((index * 83 + index * index * 7) % 405),
  y: 54 + ((index * 47 + index * index * 11) % 288),
  radius: index % 31 === 0 ? .85 : index % 9 === 0 ? .48 : .27,
  opacity: index % 17 === 0 ? .42 : .11 + (index % 5) * .025,
}));

const GLINTS = [
  [238, 122, 3.6], [408, 92, 2.6], [603, 331, 4.2], [735, 84, 2.8],
  [879, 191, 3.3], [1005, 324, 2.5], [66, 630, 2.5], [448, 765, 2.2],
] as const;

const STARS: VisualStar[] = [
  { id: "root", x: 79, y: 488, tone: "blue", level: 3, kind: "source", label: "0 · 起点", time: "08-10 10:15", detail: "问题定义与范围", labelDx: -16, labelDy: 48 },
  { id: "value", x: 212, y: 432, tone: "blue", level: 2, kind: "source", label: "1 · 用户价值", time: "08-10 10:42", author: "张明 远程编辑", labelDx: 0, labelDy: 58 },
  { id: "experience", x: 379, y: 434, tone: "blue", level: 2, kind: "source", label: "2 · 核心体验", time: "08-10 11:20", author: "李想 远程查看", labelDx: 0, labelDy: 58 },
  { id: "feasibility", x: 537, y: 449, tone: "blue", level: 2, kind: "source", label: "3 · 技术可行性", time: "08-10 12:05", labelDx: -8, labelDy: 58 },
  { id: "risk", x: 686, y: 461, tone: "blue", level: 2, kind: "source", label: "4 · 机会与风险", time: "08-10 13:15", author: "王颖 远程编辑", labelDx: -6, labelDy: 58 },
  { id: "next", x: 963, y: 543, tone: "blue", level: 2, kind: "source", label: "5 · 下一步计划", time: "08-10 14:20", labelDx: 0, labelDy: 52 },
  { id: "spine-mid", x: 834, y: 510, tone: "blue", level: 2, kind: "source" },

  { id: "portrait", x: 300, y: 203, tone: "violet", level: 1, kind: "team", label: "1.1 用户画像", time: "08-10 10:58", labelDx: 22, labelDy: 0 },
  { id: "pain", x: 288, y: 287, tone: "violet", level: 1, kind: "team", label: "1.2 场景与痛点", time: "08-10 11:05", labelDx: 22, labelDy: 0 },
  { id: "violet-leaf", x: 224, y: 328, tone: "violet", level: 1, kind: "team" },

  { id: "cyan-junction", x: 348, y: 522, tone: "cyan", level: 1, kind: "team" },
  { id: "interaction", x: 270, y: 608, tone: "cyan", level: 1, kind: "team", label: "2.1 交互流程", time: "08-10 11:35", author: "张明 远程编辑", labelDx: -40, labelDy: 42 },
  { id: "emotion", x: 407, y: 641, tone: "cyan", level: 1, kind: "team", label: "2.2 情感化体验", time: "08-10 11:50", labelDx: -30, labelDy: 44 },

  { id: "stack", x: 537, y: 156, tone: "green", level: 1, kind: "team", label: "3.1 技术选型", time: "08-10 12:15", labelDx: 22, labelDy: 0 },
  { id: "privacy", x: 559, y: 244, tone: "silver", level: 1, kind: "devin", label: "3.2 数据与隐私", time: "08-10 12:30", detail: "Devin 输出 · 最后更新 2 分钟前", labelDx: 24, labelDy: 0 },
  { id: "cost", x: 563, y: 332, tone: "green", level: 1, kind: "team", label: "3.3 成本评估", time: "08-10 12:50", labelDx: 22, labelDy: 0 },

  { id: "orange-junction", x: 647, y: 542, tone: "orange", level: 1, kind: "team" },
  { id: "market", x: 682, y: 624, tone: "orange", level: 1, kind: "team", label: "4.1 市场机会", time: "08-10 13:25", labelDx: 24, labelDy: 0 },
  { id: "challenge", x: 728, y: 725, tone: "red", level: 1, kind: "question", label: "4.2 风险与挑战", time: "08-10 13:40", labelDx: 30, labelDy: 0 },

  { id: "candidate", x: 939, y: 226, tone: "silver", level: 1, kind: "candidate", label: "候选观点", time: "居中设计可能降低\n新用户认知负荷", detail: "正在归位", labelDx: 22, labelDy: -8 },
];

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

function Icon({ children, label }: { children: ReactNode; label?: string }) {
  return <span className="b2-icon" aria-hidden={label ? undefined : true}>{children}</span>;
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

function Avatar({ name, tone }: { name: string; tone: Tone }) {
  return (
    <span className="b2-avatar" style={{ "--avatar-tone": TONES[tone] } as CSSProperties} title={name}>
      <span>{name.slice(0, 1)}</span>
    </span>
  );
}

function StarNode({ star, selected, onSelect }: { star: VisualStar; selected: boolean; onSelect(id: string): void }) {
  const color = TONES[star.tone];
  const radius = star.level === 3 ? 15 : star.level === 2 ? 10.5 : 7;
  const interactive = Boolean(star.label);
  const labelX = star.x + (star.labelDx ?? 18);
  const labelY = star.y + (star.labelDy ?? -8);
  const labelAnchor = star.labelAnchor ?? "start";
  const lines = star.time?.split("\n") ?? [];

  return (
    <g
      className={`b2-star b2-star--${star.kind} b2-star--energy-${star.level}${selected ? " is-selected" : ""}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={star.label}
      aria-hidden={interactive ? undefined : true}
      onClick={interactive ? () => onSelect(star.id) : undefined}
      onKeyDown={(event) => {
        if (interactive && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onSelect(star.id);
        }
      }}
    >
      <circle cx={star.x} cy={star.y} r={radius * 3.7} fill={`url(#b2-bloom-${star.tone})`} opacity={star.level === 3 ? .88 : star.level === 2 ? .68 : .52} />
      {star.kind === "candidate" ? <circle cx={star.x} cy={star.y} r={radius + 7} fill="none" stroke={color} strokeWidth=".8" strokeDasharray="2.5 3" opacity=".68" /> : null}
      {star.kind === "source" ? <circle cx={star.x} cy={star.y} r={radius + (star.level === 3 ? 9 : 5)} fill="none" stroke={color} strokeWidth=".8" opacity=".46" /> : null}
      {star.kind === "team" ? <circle cx={star.x} cy={star.y} r={radius + 4.5} fill="none" stroke={color} strokeWidth=".8" opacity=".5" /> : null}
      {star.kind === "question" ? <circle cx={star.x} cy={star.y} r={radius + 4.5} fill="none" stroke={color} strokeWidth=".8" opacity=".45" /> : null}
      {selected ? <circle className="b2-star__selection" cx={star.x} cy={star.y} r={radius + 11} fill="none" stroke="#e5efff" strokeWidth="1" strokeDasharray="2 2.8" /> : null}

      {star.kind === "devin" ? (
        <g transform={`translate(${star.x} ${star.y}) rotate(45)`}>
          <rect x={-radius * .72} y={-radius * .72} width={radius * 1.44} height={radius * 1.44} rx="1.2" fill="#0b1420" stroke={color} strokeWidth="1.05" />
          <rect x={-radius * .31} y={-radius * .31} width={radius * .62} height={radius * .62} fill="#eaf1f7" opacity=".8" />
        </g>
      ) : star.kind === "question" ? (
        <>
          <circle cx={star.x} cy={star.y} r={radius} fill="#101722" stroke={color} strokeWidth="1.2" />
          <circle cx={star.x + 8} cy={star.y + 22} r="8" fill="#101722" stroke={color} strokeWidth=".8" />
          <text className="b2-star__question" x={star.x + 8} y={star.y + 25} textAnchor="middle">?</text>
        </>
      ) : (
        <>
          <circle cx={star.x} cy={star.y} r={radius} fill={`url(#b2-core-${star.tone})`} stroke={color} strokeWidth={star.level === 1 ? .85 : 1.1} />
          <circle cx={star.x} cy={star.y} r={Math.max(1.8, radius * .28)} fill="#fff" opacity=".96" />
        </>
      )}

      {star.author && star.kind === "source" ? (
        <g transform={`translate(${star.x + 16} ${star.y + 25})`}>
          <circle r="9" fill="#1d2a3a" stroke="#79a6da" strokeWidth="1" />
          <circle cy="-2" r="2.5" fill="#dfc8b3" />
          <path d="M-5 6c1-4 9-4 10 0" fill="#657fa1" />
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

function SparkPath({ d, tone, main = false, dashed = false }: { d: string; tone: Tone; main?: boolean; dashed?: boolean }) {
  const color = TONES[tone];
  return (
    <g className={`b2-path${main ? " b2-path--main" : ""}${dashed ? " is-dashed" : ""}`}>
      <path d={d} fill="none" stroke={color} strokeWidth={main ? 6 : 3.4} opacity={main ? .12 : .07} filter="url(#b2-line-soften)" />
      <path d={d} fill="none" stroke={main ? "url(#b2-main-gradient)" : color} strokeWidth={main ? 1.45 : .86} strokeDasharray={dashed ? "5 7" : undefined} opacity={main ? .95 : .82} />
    </g>
  );
}

function ConstellationGraph({ selectedId, zoom, onSelect }: { selectedId: string; zoom: number; onSelect(id: string): void }) {
  const scale = zoom / 100;
  const mainPath = "M 0 560 C 34 526 59 498 79 488 C 124 463 170 435 212 432 C 274 420 330 428 379 434 C 438 440 488 445 537 449 C 594 449 640 455 686 461 C 737 474 787 492 834 510 C 884 528 924 540 963 543 C 1014 549 1056 550 1100 548";
  const mainSparkPoints = [[33, 527], [58, 507], [111, 469], [158, 447], [260, 426], [316, 428], [425, 441], [485, 445], [591, 452], [635, 456], [735, 474], [785, 491], [880, 528], [918, 538], [1010, 548]];

  return (
    <svg className="b2-graph" viewBox="0 0 1100 992" preserveAspectRatio="xMidYMid meet" role="group" aria-label="B2 shared constellation visual fixture">
      <defs>
        {Object.entries(TONES).map(([tone, color]) => (
          <radialGradient key={`bloom-${tone}`} id={`b2-bloom-${tone}`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffffff" stopOpacity=".78" />
            <stop offset=".08" stopColor="#ffffff" stopOpacity=".62" />
            <stop offset=".22" stopColor={color} stopOpacity=".28" />
            <stop offset=".52" stopColor={color} stopOpacity=".075" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </radialGradient>
        ))}
        {Object.entries(TONES).map(([tone, color]) => (
          <radialGradient key={`core-${tone}`} id={`b2-core-${tone}`} cx="43%" cy="36%" r="66%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset=".16" stopColor="#eef7ff" />
            <stop offset=".38" stopColor={color} stopOpacity=".96" />
            <stop offset=".7" stopColor={color} stopOpacity=".32" />
            <stop offset="1" stopColor="#07101b" stopOpacity=".94" />
          </radialGradient>
        ))}
        <linearGradient id="b2-main-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4d91f2" stopOpacity=".52" />
          <stop offset=".18" stopColor="#6bb0ff" />
          <stop offset=".72" stopColor="#4f9dfd" />
          <stop offset="1" stopColor="#5ca5ff" stopOpacity=".45" />
        </linearGradient>
        <filter id="b2-line-soften" x="-20%" y="-80%" width="140%" height="260%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="2.1" />
        </filter>
        <filter id="b2-glint" x="-300%" y="-300%" width="600%" height="600%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="b2-nebula-fill" cx="64%" cy="34%" r="58%">
          <stop offset="0" stopColor="#6f9bc9" stopOpacity=".18" />
          <stop offset=".44" stopColor="#375d88" stopOpacity=".075" />
          <stop offset="1" stopColor="#17304f" stopOpacity="0" />
        </radialGradient>
        <filter id="b2-nebula-texture" x="-20%" y="-35%" width="140%" height="170%">
          <feTurbulence type="fractalNoise" baseFrequency=".014 .032" numOctaves="3" seed="31" result="noise" />
          <feComposite in="SourceGraphic" in2="noise" operator="in" result="textured" />
          <feGaussianBlur in="textured" stdDeviation=".55" />
        </filter>
      </defs>

      <rect width="1100" height="992" fill="transparent" />
      <ellipse className="b2-nebula-cloud" cx="855" cy="205" rx="315" ry="165" fill="url(#b2-nebula-fill)" filter="url(#b2-nebula-texture)" />
      <g className="b2-starfield" aria-hidden="true">
        {AMBIENT_STARS.map((star, index) => <circle key={index} cx={star.x} cy={star.y} r={star.radius} fill="#dceaff" opacity={star.opacity} />)}
        <g className="b2-nebula-dust">
          {NEBULA_DUST.map((star, index) => <circle key={index} cx={star.x} cy={star.y} r={star.radius} fill={index % 4 === 0 ? "#84b4ec" : "#d3e6fb"} opacity={star.opacity} />)}
        </g>
        {GLINTS.map(([x, y, size]) => (
          <g key={`${x}-${y}`} className="b2-glint" transform={`translate(${x} ${y})`} opacity=".82" filter="url(#b2-glint)">
            <circle r={size * .42} fill="#f8fbff" />
            <path d={`M${-size * 3} 0H${size * 3}M0 ${-size * 4}V${size * 4}`} stroke="#a8cfff" strokeWidth=".35" />
          </g>
        ))}
      </g>

      <g className="b2-graph__zoom" style={{ transform: `scale(${scale})`, transformOrigin: "550px 496px" }}>
        <SparkPath d={mainPath} tone="blue" main />
        <SparkPath d="M212 432 C214 383 249 342 288 287 C292 255 297 226 300 203" tone="violet" />
        <SparkPath d="M212 432 C191 402 191 362 224 328 C247 306 268 293 288 287" tone="violet" />
        <SparkPath d="M379 434 C367 466 359 492 348 522 C316 552 290 582 270 608 M348 522 C369 563 390 607 407 641" tone="cyan" />
        <SparkPath d="M537 449 C542 409 551 370 563 332 C568 301 567 273 559 244 C553 207 544 178 537 156" tone="green" />
        <SparkPath d="M686 461 C680 498 666 525 647 542 C658 575 668 603 682 624 C702 663 716 697 728 725" tone="orange" />
        <SparkPath d="M540 595 C682 582 797 515 874 384 C900 337 919 282 939 226" tone="silver" dashed />
        <SparkPath d="M964 543 C1030 529 1058 432 1100 400" tone="blue" dashed />

        {mainSparkPoints.map(([x, y], index) => <circle key={index} cx={x} cy={y} r={index % 4 === 0 ? 1.8 : 1.05} fill="#dceeff" opacity={index % 4 === 0 ? .85 : .56} />)}
        {STARS.map((star) => <StarNode key={star.id} star={star} selected={selectedId === star.id} onSelect={onSelect} />)}
      </g>
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
      <div className="b2-rail__profile"><Avatar name="你" tone="blue" /><span>››</span></div>
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
  return (
    <aside className="b2-panel b2-minimap" aria-label="全局小地图">
      <h2>全局小地图</h2>
      <svg viewBox="0 0 218 126" aria-hidden="true">
        <path d="M4 82C38 64 57 60 83 59c31-1 55 5 82 13 21 7 34 6 49 3" fill="none" stroke="#65a8ff" strokeWidth="1.15" />
        <path d="M55 59c-3-24 10-34 17-48M84 60c-9 18-16 28-23 42m23-42c15 20 16 39 24 56M122 64c0-27 6-42 8-55m35 64c-4 18 10 30 19 43" fill="none" strokeWidth=".75" stroke="#8b78f6" opacity=".85" />
        {[8, 55, 84, 122, 165, 214].map((x, index) => <circle key={x} cx={x} cy={index === 0 ? 80 : index === 5 ? 75 : 58 + index * 3} r="2.3" fill="#f5fbff" />)}
        <rect x="7" y="7" width="204" height="112" fill="none" stroke="#aebbc9" strokeWidth=".7" />
      </svg>
    </aside>
  );
}

function CanvasToolbar({ zoom, onZoom }: { zoom: number; onZoom(next: number): void }) {
  return (
    <div className="b2-canvas-toolbar" aria-label="画布工具">
      <button type="button" aria-label="平移工具">☝</button>
      <button type="button" aria-label="定位中心">⌖</button>
      <span />
      <button type="button" aria-label="放大" onClick={() => onZoom(Math.min(120, zoom + 10))}>＋</button>
      <button type="button" aria-label="缩小" onClick={() => onZoom(Math.max(80, zoom - 10))}>−</button>
      <span />
      <output aria-label="当前缩放">{zoom}%</output>
      <button type="button" aria-label="适配画布" onClick={() => onZoom(100)}>⌗</button>
    </div>
  );
}

function CanvasHeader() {
  return (
    <header className="b2-canvas-header">
      <h1>Dialogue Atlas</h1>
      <button type="button" className="b2-topic-select">生长星图 · 生成式AI产品的关键体验探索 <span>⌄</span></button>
      <div className="b2-presence" aria-label="房间在线成员">
        <Avatar name="林" tone="red" /><Avatar name="陈" tone="green" /><Avatar name="你" tone="blue" />
        <span>3 人在线</span>
      </div>
      <div className="b2-header-actions" aria-label="页面操作">
        <button type="button" aria-label="搜索">⌕</button>
        <button type="button" aria-label="帮助">?</button>
        <button type="button" aria-label="设置">⚙</button>
      </div>
    </header>
  );
}

function ConversationPanel() {
  return (
    <section className="b2-conversation" aria-label="LLM 房间共享对话">
      <div className="b2-workbench__section-title">
        <h2>与 LLM 的对话</h2>
        <button type="button">思考中⌄</button>
      </div>
      <div className="b2-generation-state"><span>✧</span><strong>正在生成回答…</strong><i /><i /><i /><i /></div>
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
      <header><h2>Devin 运行状态</h2><strong>可能中断</strong><span>◆　•••</span></header>
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

export function B2VisualDemo() {
  const [selectedId, setSelectedId] = useState("");
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("conversation");
  const [zoom, setZoom] = useState(100);
  const selectedLabel = useMemo(() => STAR_BY_ID.get(selectedId)?.label ?? "节点", [selectedId]);

  useEffect(() => {
    const theme = document.querySelector('meta[name="theme-color"]');
    const previous = theme?.getAttribute("content");
    theme?.setAttribute("content", "#02070d");
    return () => { if (previous) theme?.setAttribute("content", previous); };
  }, []);

  function selectNode(id: string) {
    setSelectedId(id);
    setWorkbenchTab("node");
  }

  return (
    <main className="b2-visual" data-runtime="deterministic-visual-fixture" data-b2-ready="true">
      <LeftRail />
      <section className="b2-canvas" aria-label="星图画布">
        <CanvasHeader />
        <ConstellationGraph selectedId={selectedId} zoom={zoom} onSelect={selectNode} />
        <Legend />
        <MiniMap />
        <CanvasToolbar zoom={zoom} onZoom={setZoom} />
        <p className="b2-selected-readout" aria-live="polite">当前选择：{selectedLabel}</p>
      </section>
      <Workbench tab={workbenchTab} selectedId={selectedId} onTab={setWorkbenchTab} />
      <p className="b2-fixture-note">视觉还原样例 · 不连接 Supabase / LLM / Devin</p>
    </main>
  );
}

export default B2VisualDemo;

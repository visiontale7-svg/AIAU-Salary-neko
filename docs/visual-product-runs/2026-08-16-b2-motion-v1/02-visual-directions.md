# Visual Directions

## Controlled experiment

- [REQ] 三个方向使用相同的 B2 星体、同一蓝色 Source 节点、同一水平主路径和斜向分支，不改变坐标、字体、背景或面板。
- [REQ] 每个方向都展示 Idle、Selected、新节点生成、Devin running、Devin stale/disconnected 五个关键帧，并附 Reduced Motion 静态结果。
- [ASSUMPTION] 方向图采用同一 16:10 深空动效系统板：上方为整图语境，下方为五状态放大关键帧和时间曲线。

## Shared seed data

- [REQ] 节点：`2 · 核心体验`，Source blue，目标能量档，当前未选中。
- [REQ] 主路径：蓝色主干从左向右穿过节点；青色支持分支从左下接入。
- [REQ] Devin 任务：`3.2 数据与隐私`，状态从 working 进入 stale，最后事件时间为 2 分钟前。
- [REQ] 新节点：由主干父节点产生，沿既有关系方向出现。

## Shared frame matrix

| Frame | Required visible evidence |
|---|---|
| Idle | 星体稳定，只有接近不可察觉的环境变化；路径不持续跑马灯 |
| Selected | 一次性聚焦响应，之后保持清晰选中态 |
| New node generation | 关系前锋先到达，粒子凝结，壳与核心依次稳定 |
| Devin running | 低频、方向明确的执行信号；不靠持续旋转表达 |
| Devin stale/disconnected | 信号逐步衰减、转中性并保留最后状态；无红色报警闪烁 |
| Reduced Motion | 无连续位移或脉冲，使用静态壳层、图标、色相和文案 |

## Directions

### Direction A: Energy Envelope / 能量包络

- Hypothesis: [ASSUMPTION] 把运动限制在空气光、近场 bloom 和能量壳，可最大限度保留当前白热恒星的高级质感，并让状态变化显得来自星体内部。
- Material UX difference: [ASSUMPTION] Selected 是一次性壳层收束；新节点从低能量核逐级点亮；Devin running 通过周期性壳层压缩与释放表达；stale 通过振幅和色温衰减表达。
- ImageGen prompt: [REQ] 基于锁定的 Dialogue Atlas B2 截图，制作专业 motion design system storyboard。严格保持页面布局、深空背景、圆形白热星体和路径几何。聚焦一个 Source 蓝色星体，展示 Idle、Selected、New node、Devin running、Stale 五个连续关键帧以及 Reduced Motion 静态帧。方向 A 只使用空气光半径、能量壳亮度、核心羽化与极弱纵向衍射变化；没有跑马灯、没有爆炸、没有大幅缩放。冷静、精密、高级、接近天体摄影与 Apple Pro 应用，而非游戏 HUD。清楚标注 0ms、180ms、520ms、1600ms 等时间点。
- Image provenance: [EVIDENCE] `images/direction-a-energy-envelope.png`
- Image status: generated
- Generated at: 2026-08-16 07:49 JST
- Visual QA: [EVIDENCE] 星体主体保持稳定，状态差异集中在空气光、薄壳和一次性曝光变化；整体最接近现有 B2 的高级质感。[OPEN] 生成图中的时间曲线是方向证据，不是最终实现参数。

### Direction B: Signal Along Relations / 关系信号

- Hypothesis: [ASSUMPTION] 把主要运动放在关系路径上，可以最直接表达“想法、协作和 Devin 执行正在流动”，同时让星体本身保持稳定。
- Material UX difference: [ASSUMPTION] Selected 只做短促聚焦；新节点由一次路径前锋抵达后点亮；Devin running 以低频单个光包沿指定关系传播；stale 是光包间隔拉长、途中衰减并最终停止。
- ImageGen prompt: [REQ] 基于锁定的 Dialogue Atlas B2 截图，制作专业 motion design system storyboard。严格保持圆形白热星体材质和页面布局。展示同一 Source 星体的 Idle、Selected、New node、Devin running、Stale 与 Reduced Motion。方向 B 让星体几乎静止，运动发生在关系路径：稀疏单一光包沿弧线传播，经过节点时短暂洗白融合；新节点由路径前锋抵达后凝结；Devin working 每约 2.8 秒发送一次方向明确的信号，stale 时信号距离缩短、衰减并停止。禁止连续跑马灯、整条线同时闪烁、霓虹电流和游戏技能特效。标注时间与路径方向。
- Image provenance: [EVIDENCE] `images/direction-b-signal-relations.png`
- Image status: generated
- Generated at: 2026-08-16 07:49 JST
- Visual QA: [EVIDENCE] 因果方向和 Devin event packet 最容易一眼读懂；路径一旦同时出现多个 packet 就会抢过标签，因此只能由真实事件触发，不能成为常驻动画。

### Direction C: Crystallization / 粒子凝结

- Hypothesis: [ASSUMPTION] 用微尘聚集和结晶来表现新想法的形成，能最强地传达“从对话中长出结构”，并形成独有的产品记忆点。
- Material UX difference: [ASSUMPTION] Idle 完全静止；Selected 由少量近场粒子向壳层归位；新节点先出现空间密度变化，再形成核心、壳和关系；Devin running 的新事件以微粒抵达并固化为记录；stale 时粒子不再到达，残余光尘缓慢熄灭。
- ImageGen prompt: [REQ] 基于锁定的 Dialogue Atlas B2 截图，制作专业 motion design system storyboard。严格保持深空背景、圆形白热星体和现有结构。展示 Idle、Selected、New node、Devin running、Stale 与 Reduced Motion。方向 C 的核心语言是受控粒子凝结：不超过 12–18 个极细微尘沿关系方向聚集，先形成白热核心，再出现偏白能量壳，最后路径稳定；Selected 只发生一次近场归位；Devin 事件表现为一小束粒子抵达并结晶。禁止烟花、爆炸、散射、随机雪花、过量粒子和明显缩放。画面应安静、科学、具有研究仪器和天体形成的质感。
- Image provenance: [EVIDENCE] `images/direction-c-crystallization.png`
- Image status: generated
- Generated at: 2026-08-16 07:49 JST
- Visual QA: [EVIDENCE] 新节点从关系方向凝结的过程最有产品记忆点，也最贴合“从对话中长出结构”；它不适合作为 Idle 或普通 selection 的常驻语言。

## Cross-direction visual QA

- [REQ] 三个方向都必须保持现有圆形能量壳、小型羽化白核、宽空气光和路径进入核心时的洗白融合。
- [REQ] 任何方向不得让所有节点同步循环，不得使用高频闪烁、明显 scale bounce、持续旋转或整条路径跑马灯。
- [REQ] 所有循环状态必须低频、可暂停，并在 Reduced Motion 下转换为不依赖运动的静态状态。
- [ASSUMPTION] 初步首选为 A；B 适合吸收为 Devin running 的局部信号，C 适合吸收为新节点生成的专属过渡。

# Product Brief

## Core job

- [REQ] PB-001：让 Dialogue Atlas 的星图动效表达可理解的状态变化，而不是装饰性闪烁。
- [REQ] PB-002：保留已批准的 B2 星体光学材质、布局、文字、背景和面板，不因动画退化成霓虹按钮或游戏特效。
- [REQ] PB-003：先在独立 Motion Lab 比较并批准静态关键帧与时间曲线，再接入完整 B2。
- [ASSUMPTION] PB-004：首轮只定义 Idle、Selected、新节点生成、Devin running、Devin stale/disconnected 五个核心状态。

## Actors and permissions

- [REQ] PB-005：观察者可以辨认当前选中节点、新生成节点和 Devin 执行状态，但不需要理解底层动画实现。
- [REQ] PB-006：键盘、鼠标和 Reduced Motion 用户必须获得同等明确的状态反馈。
- [ASSUMPTION] PB-007：本轮动画仅运行在 B2 视觉样例；真实 Relay、Supabase 和 Devin 不接入。

## In scope

- [REQ] PB-008：建立 100% 与 200% 光学检查比例的 Motion Lab。
- [REQ] PB-009：为五个核心状态定义关键帧、持续时间、缓动、循环规则、视觉静态替代和停止条件。
- [REQ] PB-010：区分星体、能量壳、空气光、路径、粒子和状态覆盖层的动画职责。
- [REQ] PB-011：动画必须保持确定性，可被 Playwright 冻结并稳定截图。
- [REQ] PB-012：页面隐藏、Reduced Motion 或失焦时停止非必要循环。

## Out of scope

- [REQ] PB-013：本轮不实现 Supabase Presence、多人光标、真实 Devin polling 或 LLM 流式输出。
- [REQ] PB-014：本轮不改动图谱坐标、关系语义、右栏文案、MiniMap、背景星云或响应式布局。
- [REQ] PB-015：本轮不让所有星星持续同步呼吸，不加入高频闪烁、持续旋转或大幅缩放。

## Success criteria

- [REQ] PB-016：用户在不看右栏文字时，能仅凭动效区分 Selected、新节点生成、Devin running 与 Devin stale。
- [REQ] PB-017：Idle 状态在 10 秒观察中仍显得稳定、沉静，不能产生“整页在闪”的感觉。
- [REQ] PB-018：新节点生成应呈现“沿关系抵达并凝结为星体”，而不是从零缩放弹出。
- [REQ] PB-019：Devin running 表达“持续但低频的执行信号”；stale 表达“信号衰减且保留最后状态”，不能用红色报警闪烁。
- [REQ] PB-020：Reduced Motion 下取消位移、缩放、连续脉冲，保留壳层、色相、图标和静态状态文字。
- [ASSUMPTION] PB-021：Motion Lab 在 canonical 1586×992、DPR1、Chromium 下作为主要视觉验收面。

## Golden path

1. [REQ] PB-022：进入 Motion Lab，默认展示同一 Source 节点的五个状态与时间轴。
2. [REQ] PB-023：逐一播放 Selected、新节点生成、Devin running、stale，并可暂停到关键帧。
3. [REQ] PB-024：在 100% 实际尺寸判断整页感知，在 200% 检查壳层、核心、路径融合和衍射细节。
4. [REQ] PB-025：切换 Reduced Motion，确认每个状态仍有明确静态表达。
5. [REQ] PB-026：用户批准一个主方向及可保留的跨方向元素后，才接入完整 B2。

## Capability and state matrix

| Frame/state | Direction A | Direction B | Direction C |
|---|---|---|---|
| Idle | same | same | same |
| Selected | same | same | same |
| New node generation | same | same | same |
| Devin running | same | same | same |
| Devin stale/disconnected | same | same | same |
| Reduced Motion | same | same | same |
| Page hidden / paused | same | same | same |
| 100% actual size | same | same | same |
| 200% optics inspection | same | same | same |

## Assumptions and open questions

- [ASSUMPTION] PB-027：Idle 允许极弱、异步、8–12 秒量级的空气光漂移，但主要节点在任一时刻的亮度变化不超过约 4%。
- [ASSUMPTION] PB-028：Selected 使用一次性 420–600ms 聚焦响应，随后停在稳定选中态，不持续呼吸。
- [ASSUMPTION] PB-029：新节点生成持续 1.4–1.8 秒，先有路径前锋，再有粒子凝结和壳层稳定。
- [ASSUMPTION] PB-030：Devin running 每 2.4–3.2 秒产生一次低频信号；stale 在约 4 秒内衰减为中性静态态。
- [OPEN] PB-031：最终应以 A 为主体、局部吸收 B/C，还是完整选择其中一种单一语言。
- [OPEN] PB-032：不同用户的 Presence 动效是否进入第二阶段，还是与 Devin 状态一起进入第一版整图接入。

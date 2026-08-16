# Selection

## Comparison rubric

| Criterion | Direction A: Energy Envelope | Direction B: Signal Along Relations | Direction C: Crystallization |
|---|---|---|---|
| 保持现有星体质感 | [EVIDENCE] 最强；动作留在空气光和壳层 | [EVIDENCE] 强；星体基本不动 | [EVIDENCE] 中；粒子控制不好会削弱光学纯度 |
| Selected 的安静与清晰 | [EVIDENCE] 最强；一次聚焦后稳定 | [EVIDENCE] 中；汇聚光点可能抢注意 | [EVIDENCE] 中；粒子归位语义略重 |
| 新节点生成的可理解性 | [EVIDENCE] 中；能量升起但来源方向较弱 | [EVIDENCE] 强；路径前锋清楚说明父子关系 | [EVIDENCE] 最强；“结构凝结”最具记忆点 |
| Devin running 的可追溯性 | [EVIDENCE] 中；仅靠星体脉冲难说明事件来源 | [EVIDENCE] 最强；单个 event packet 方向明确 | [EVIDENCE] 强；事件可结晶成 milestone，但连续性较弱 |
| stale/disconnected 的克制性 | [EVIDENCE] 最强；一次衰减后静止 | [EVIDENCE] 强；信号停止且路径转中性 | [EVIDENCE] 中；残余粒子容易像系统仍在活动 |
| 性能与实现风险 | [ASSUMPTION] 最低；只增加独立 opacity/transform 层 | [ASSUMPTION] 中；需路径长度与 packet 定位 | [ASSUMPTION] 中高；需确定性粒子与到达控制 |
| 产品辨识度 | [EVIDENCE] 高；形成统一恒星状态语言 | [EVIDENCE] 高；强调 Dialogue Atlas 的因果链 | [EVIDENCE] 很高；最能表达“想法出生” |

## Decision

- [ASSUMPTION] 决策状态：`provisional`。
- [ASSUMPTION] 主方向选择 Direction A「Energy Envelope / 能量包络」。它负责 Idle、Hover、Selected、stale 的全局基础语言。
- [ASSUMPTION] 从 B 保留一个局部模式：仅当真实 Devin event 或持久化的新关系到达时，播放一次沿路径传播的 event packet。
- [ASSUMPTION] 从 C 保留一个局部模式：仅当新节点已经持久化成功时，播放一次 1.2–1.6 秒的凝结生成。
- [REQ] 在用户确认前，不把 provisional 决策接入完整 B2。

## Retained and rejected patterns

- [ASSUMPTION] 保留 A 的一次性 selection focus、低频事件响应和 stale 能量衰减。
- [ASSUMPTION] 保留 B 的单包、单方向、事件驱动路径信号；拒绝整条路径持续跑马灯。
- [ASSUMPTION] 保留 C 的少量、定向、新节点专属粒子凝结；拒绝 Idle 粒子、烟花、散射和随机雪花。
- [REQ] 拒绝所有节点同步呼吸、白核持续缩放、Selected 永久波纹、Devin 菱形永久旋转和红色 stale 闪烁。

## Selection assumptions and open questions

- [OPEN] 用户是否批准“A 为主，B/C 各保留一个局部模式”的混合方向。
- [OPEN] Idle 是否完全静止，还是允许同屏最多 2–3 个活跃节点做 10–16 秒、2–4% 的不可察觉亮度漂移。
- [ASSUMPTION] 首个 Motion Lab 先实现 Selected 与 New Node 两个一次性动作；它们通过后再加入 Devin running/stale。
- [OPEN] 多人 Presence 的轨道弧和用户色标暂缓到第二阶段，不与本轮基础动画混在一起。

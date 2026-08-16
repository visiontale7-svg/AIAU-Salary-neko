# Reverse Specification

## Provenance legend

- [REQ] 来自用户明确要求、已锁定 B2 视觉、当前产品契约或本轮批准边界。
- [EVIDENCE] 来自三张生成方向图或当前代码中可见、可检查的实现。
- [ASSUMPTION] 为形成可测试第一版而选定的可逆默认值。
- [OPEN] 尚需用户确认或真实数据接线后才能锁定的决定。

## Chosen experience

- [ASSUMPTION] `provisional` 选择 Direction A「能量包络」为基础语言，并只吸收 Direction B 的一次性事件信号与 Direction C 的一次性节点凝结。
- [REQ] 动效发生在独立 Motion Overlay，不修改已批准的预烘焙光晕、壳、白核和静态路径材质。
- [REQ] 同一时刻最多 1 个无限循环、最多 3 个活动语义对象；默认 Idle 不制造整页运动。

## Routes and components

- [ASSUMPTION] 新增 `/?demo=b2&motionLab=1`，真实 `/room`、`?room`、`#invite` 继续优先。
- [ASSUMPTION] 新增 `B2MotionLab`、`StarMotionOverlay`、`PathSignalOverlay` 和确定性时间控制器。
- [REQ] 绘制顺序为：静态 PathAtmosphere → 静态 StarAura → 静态 PathCore → MotionPathOverlay → 静态 StarBody → MotionStarOverlay → 文字与交互。
- [REQ] Motion Lab 提供 Replay、Pause、时间点跳转、100%/200% 和 Reduced Motion 切换。

## Interaction traceability

| ID | Provenance | UI element/state | Event | Precondition | Domain command/query | API/event | Entity/field | Success feedback | Failure/permission response |
|---|---|---|---|---|---|---|---|---|---|
| VP-001 | `[REQ]` | Idle Source | enter lab | assets decoded | local fixture read | none | motionState=settled | 稳定静态星体 | 资源失败则 Lab 不 ready，并显示错误 |
| VP-002 | `[REQ]` | Source Selected | click / Enter / Space | node enabled | set local selection | none | selectedId | 380–520ms 一次聚焦后停在静态双环 | Reduced Motion 直接显示静态双环 |
| VP-003 | `[REQ]` | New node | replay | persisted arrival fixture exists | start deterministic timeline | none in Lab | motionState=appearing | 路径前锋→凝结→壳闭合→标签出现 | 中断后保持最后稳定帧，不反复重播 |
| VP-004 | `[REQ]` | Devin running | replay event | run is working and event is new | start one event pulse | future Devin event | runId/eventId | 单个 packet 到达并短促洗白 | 无事件时保持静止 |
| VP-005 | `[REQ]` | Devin stale | set stale | working 且超过 stale 阈值 | derive stale state | future run updatedAt | run.updatedAt | 3–4s 衰减后保持中性静态态 | offline 时冻结，不把连接失败误报为 Devin stale |
| VP-006 | `[REQ]` | Reduced Motion | media/query toggle | none | select static fallback | prefers-reduced-motion | accessibility mode | 每个状态均有不依赖运动的静态表达 | 不允许停在 opacity=0 的初始帧 |
| VP-007 | `[REQ]` | Page hidden | visibilitychange | animation active | pause timeline | document visibility | pausedAt | 画面冻结，回来继续当前语义态 | 不补播历史事件或累积循环 |
| VP-008 | `[REQ]` | Motion controls | pause/scrub | Lab only | set deterministic time | none | timelineMs | 精确显示关键帧 | 非 Lab 页面不暴露测试控制器 |

## State machine

| Current | Trigger | Guard | Next | Persisted effect | UI effect | Failure |
|---|---|---|---|---|---|---|
| settled | [REQ] select | node interactive | selected-focus | none | 一次聚焦后进入 selected-steady | Reduced Motion 直接进入 selected-steady |
| selected-focus | [ASSUMPTION] timeline complete | still selected | selected-steady | none | 静态选中壳和覆盖层 | 若取消则进入 settling |
| selected-steady | [REQ] deselect | none | settling | none | 160–220ms 退场 | 页面隐藏时冻结 |
| settled | [REQ] persisted node arrival | unseen activity seq | appearing | future arrival receipt only | 路径前锋与粒子凝结 | 重连旧事件不得重播 |
| appearing | [ASSUMPTION] timeline complete | node still exists | settled | mark arrival consumed in future live adapter | 新节点保持静态完成态 | 节点被删除则立即移除，不播放消失特效 |
| settled | [REQ] new Devin event | run=working and event unseen | event-pulse | future event cursor | 单包沿路径抵达 | 重复 eventId 不重播 |
| event-pulse | [ASSUMPTION] timeline complete | run still working | settled | none | 返回静态 working 表达 | 若变 stale 则转 energy-decay |
| settled | [REQ] stale threshold reached | run active, connection live | energy-decay | none | 一次衰减 | offline 不进入 stale |
| energy-decay | [ASSUMPTION] timeline complete | still stale | stale-steady | none | 中性、低能量、完全静止 | 新事件到达则先恢复后播放 event-pulse |
| any moving | [REQ] reduced motion / hidden | none | paused-static | store current semantic state only | 显示静态替代帧 | 恢复时不补播循环 |

## Data model and invariants

- [ASSUMPTION] `StarMotionState = settled | selected-focus | appearing | devin-running | devin-stale`，与现有 `StarOpticsState = idle | hover | selected` 正交。
- [REQ] 同一节点可同时是 `selected + devin-running`，业务状态不能通过互斥枚举覆盖交互状态。
- [REQ] 新节点生成只由已持久化、按 activity sequence 去重的 arrival 触发；React 列表 diff、刷新和重连不能触发。
- [REQ] Devin event 由唯一 eventId 去重；轮询未发现新 event 时不得播放假脉冲。
- [REQ] stale 与 Relay offline 分离；offline 冻结最后状态，不推断 Devin 失败。

## API and event contracts

- [ASSUMPTION] Motion Lab 无 API，只使用固定 fixture 与 deterministic clock。
- [OPEN] 真实 Relay 接入时需要 controller 暴露 `{seq,type,targetId}` arrival receipt，并记录已消费 seq。
- [OPEN] 真实 Devin 接入时需要 run/action 与 graph node 的明确 binding，以及去重后的 eventId。
- [REQ] B2 / Motion Lab 不创建 Supabase client，不触发 LLM、Devin 或外部网络。

## Hidden-decision checklist

| Category | Provenance | Decision |
|---|---|---|
| identity, authentication, authorization, and tenancy | [REQ] | Motion Lab 为本地 fixture，无身份或权限变化。 |
| source of truth and persistence | [REQ] | Lab 的真相源是固定 fixture；真实接入后只认 Postgres/Devin 去重事件，不认动画自身。 |
| validation, quotas, and boundary rules | [ASSUMPTION] | 活动语义对象上限为 3；无限循环上限为 1。 |
| concurrency and atomic invariants | [OPEN] | 真实协作 arrival 需要按 activity seq 去重，尚未接入。 |
| idempotency, retry, and duplicate suppression | [REQ] | 同一 seq/eventId 最多播放一次。 |
| loading, caching, stale data, polling, push, and refresh | [REQ] | 刷新不重播生成；stale 只在连接 live 时推导。 |
| async jobs, progress, cancellation, and failure recovery | [REQ] | Devin running 由真实 event 驱动；停止或失败只播放一次状态变化。 |
| timezones, locales, ordering, and clock behavior | [REQ] | 动画使用 monotonic timeline，不依赖墙上时钟；展示文案继续使用 JST。 |
| privacy, security, abuse, and rate limits | [REQ] | 动画层不新增文本、证据、网络或日志内容。 |
| audit history and destructive actions | [REQ] | N/A；Lab 不写持久数据。 |
| notifications and separation from core transaction success | [REQ] | 动画不代表服务器事务成功；只有已确认事件可以触发。 |
| retention, deletion, backup, observability, and support diagnostics | [REQ] | Lab 只把当前 state/timelineMs 暴露为测试属性，不保留用户数据。 |

## Adversarial simulation

| Scenario | Initial state | Interleaving/actions | UI outcome | Server outcome | Persisted result | Event/notification |
|---|---|---|---|---|---|---|
| SIM-001 | [REQ] settled | 用户选中节点 | 一次聚焦后静态选中 | HTTP 200；Lab 不发请求 | none | none |
| SIM-002 | [REQ] appearing | 相同 arrival seq 再到达 | 不重播，保持 settled | HTTP 200；future server row unchanged | consumed seq unchanged | no duplicate animation |
| SIM-003 | [REQ] selected + Devin event；用户同时选中 | selection 与 event packet 并行但不互相覆盖 | selection 壳保持，单个 packet 独立播放 | HTTP 200；event remains canonical | eventId consumed once | one event pulse |
| SIM-004 | [REQ] member tries owner-only Devin action | no accepted run event | 不播放 Devin running | HTTP 403 permission_denied | no run/event row | 显示权限错误，动画保持静态 |
| SIM-005 | [REQ] event-pulse 中页面隐藏 | visibilitychange hidden | 冻结当前语义态；回来不补播累计脉冲 | HTTP 200；provider state unchanged | cursor unchanged | resume from current state or settle |
| SIM-006 | [REQ] working then Relay offline | connection changes before stale threshold | 冻结 working 并显示 offline 静态徽标 | HTTP 503 / no fresh sync；不推断 stale | no run state rewrite | reconnect 后重新读取真实状态 |

## Acceptance criteria

| AC ID | Provenance | Requirement and trace | Exact pass condition |
|---|---|---|---|
| AC-001 | [REQ] | PB-016 / VP-002–VP-005 | 无文字辅助时，五个状态的最终静态态和一次性转场可被区分。 |
| AC-002 | [REQ] | PB-017 / VP-001 | Idle 连续 10 秒无同步呼吸，同屏显著活动对象不超过 3。 |
| AC-003 | [REQ] | PB-018 / VP-003 | 新节点严格按路径前锋→凝结→壳闭合→标签出现，时长 1.2–1.6 秒，无 bounce scale。 |
| AC-004 | [REQ] | PB-019 / VP-004–VP-005 | Devin event 一次触发一个 packet；stale 一次衰减后完全静止，无红色循环闪烁。 |
| AC-005 | [REQ] | PB-020 / VP-006 | Reduced Motion 下无位移、连续缩放或路径脉冲，且所有状态仍可识别。 |
| AC-006 | [REQ] | PB-011 / VP-008 | 固定 timelineMs 的连续 5 次截图 hash 一致。 |
| AC-007 | [REQ] | PB-002 / VP-006 | Reduced Motion canonical B2 截图与当前静态基线不下降。 |
| AC-008 | [REQ] | PB-013 / VP-001 | Motion Lab 无 Supabase、LLM、Devin 或外部网络请求。 |

## Vertical slices

1. [ASSUMPTION] Slice 1：Motion Lab 框架、deterministic clock、Idle、Selected、New Node、Reduced Motion。
2. [ASSUMPTION] Slice 2：Devin event packet、stale decay、页面隐藏和 pause/resume。
3. [OPEN] Slice 3：用户批准后接入完整 B2 视觉样例，仍使用 fixture 状态。
4. [OPEN] Slice 4：未来接入真实 Relay arrival、Devin event 与连接状态；不属于本轮视觉实现。

## Open decisions and risks

- [OPEN] 用户是否批准 provisional 混合方向。
- [OPEN] Idle 是否完全静止；当前建议在第一版完全静止，把生命感留给背景和真实事件。
- [OPEN] 多人 Presence 应使用头像弧、轨道点还是节点旁用户色标，留到第二阶段独立比较。
- [ASSUMPTION] 最大技术风险不是 CSS 能力，而是同时动画已有大量 SVG filters；因此只动画独立 overlay 的 opacity、transform、stroke-dashoffset，不动态修改 filter 参数。

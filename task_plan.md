# Task Plan: Dialogue Atlas B2 Functional Product Integration

## Goal
把已经批准的高还原 B2 星图从确定性视觉 fixture 转化为真实 Dialogue Atlas Relay 产品表面：保留 macOS 私密分析与发布边界，优先完成本地发布 → 邀请加入 → 实时共创 → 提案与房主决策 → Devin 执行的可验收闭环。

## Current Phase
F0–F3 的本地真实协作闭环已经完成；F4 的 provider-health、退避与恢复动效已完成本地实现，真实付费 Devin Session 仍受外部凭据、权限预检与未知创建结果对账能力限制。F1 仍保留 fixture/live 场景渲染器分离这一明确架构债务。

## Scope Boundaries

- `?demo=b2`、Halo Lab、Motion Lab 继续作为无网络的确定性视觉验收面；真实 `/room/:id` 使用 Supabase 房间数据。
- 不上传本地 JSONL、完整 transcript、未批准证据、本机 ID、provider secret 或 service-role key。
- 首个里程碑不新增 Web LLM chat、room-wide chat 或云端对话分析；右栏使用讨论/节点/执行。
- 来源图保持不可变；团队贡献、提案、评论、决策、Action Brief 与 Devin 回执保持分层。
- 不用 Relay offline/reconnecting 推导 Devin stale；真实 Devin provider health 必须有独立证据。
- 视觉演示必须能独立截图、键盘浏览，并在 1280×800 与 1598×1024 下成立。
- 最新用户截图是唯一视觉母版；上一轮浮动 Dock 版只保留为错误方向记录，不再作为验收基准。

## Functional Integration Phases

### F0: 基线与真实发布链路
- [x] 本地 Supabase 10 migrations、pgTAP 48/48、双 Anonymous Auth、RLS 与 private Realtime smoke
- [x] 保留并验证当前未提交的 B2 motion、local Supabase 和 desktop publisher 修复
- [x] 真实 publisher smoke 从已批准 package 创建房间，并验证 canonical URL / invite fragment 分离
- [x] 独立浏览器访客加入并看到 B2 live room；自动化覆盖邀请清除、Presence、团队节点、提案与房主接受
- **Status:** automated_complete_current_tauri_manual_spot_check_pending

### F1: 共享高还原星图表面
- [ ] 抽出 data-driven scene/camera/pass renderer，fixture 与 RoomBundle 使用同一实现（光学原语已共享；fixture scene 仍独立以保护 canonical）
- [x] 真实 B2 接入 zoom/pan/fit/MiniMap viewport，并保持共享布局与本地 camera 分离
- [x] Web 成员与 macOS 房主使用同一 B2RoomView 与协作工作台
- [x] 旧 structured panel 暂作为回退，不在 parity 前删除
- **Status:** operational_with_fixture_renderer_split

### F2: B2 协作工作台闭环
- [x] 讨论：proposal list、comment、typing、房间 revision/seq 与成员状态
- [x] 节点：证据、stance、team node/edge create-edit、source/relationship proposal
- [x] 执行：owner decision、Action Brief、Devin run/event/PR 回执
- [x] 离线草稿、CAS conflict、role-based disabled/hidden state
- **Status:** complete_with_structured_fallback

### F3: 真实 Realtime 动效与成员身份
- [x] durable activity → motion event mapper，初始加载/重连补读不重播
- [x] team item createdBy 与 RLS-protected member summaries 进入 effective graph
- [x] 稳定 member colorKey 驱动头像、Presence 弧与团队星作者标识
- [x] 同屏最多一个 packet，eventKey/activitySeq 去重；provider recovered 清除 stale 断环且不重播动效
- **Status:** complete

### F4: Devin live hardening
- [x] Devin lifecycle 与 provider health 分离，记录 last success/event/failure/retry-after
- [x] 5s visible-owner poll + Retry-After/5–60s 有界退避；unknown create 永不盲重试
- [ ] 真实 Session → branch/PR → tests → human review smoke
- [x] fixture motion 与真实 durable event/stale/recovered 严格区分
- **Status:** local_complete_external_devin_gate_blocked

### F5: 次级产品能力
- [ ] 搜索、mode filter、activity timeline、atlas version、help/settings/invites
- [ ] 多选、框选、撤销等画布增强
- [ ] 原始对话时间线与 Web LLM growth 另立隐私/数据契约后再做
- **Status:** queued

## Reference Reset Phases

### H1: 光学材质实验室与透明资产
- [x] 新增 `?demo=b2&haloLab=1`，隔离 Source/Root/Team/Question/Candidate 的静态材质
- [x] 用固定 seed 的 Chromium 生成 14 个 DPR2 透明 PNG，并提供 hash check
- [x] Source 实验单元同时包含水平主路径与斜向分支
- **Status:** complete

### H2: 分层渲染与全图替换
- [x] 将图谱拆为 PathAtmosphere → StarAura → PathCore → PathParticles → StarBody → StarOverlay
- [x] 删除旧 radial halo、暗 moat、实心白圆和 ring/core drop-shadow
- [x] 保持坐标、标签、头像、键盘、缩放、selection 与 MiniMap 行为不变
- **Status:** complete

### H3: 数值验收与用户审阅
- [x] Source 96×96 ROI 通过白核、壳峰、外晕、衍射和路径融合指标
- [x] DPR1/DPR2 稳定性、无外联、1280 回归和完整 Relay 回归通过
- [x] 提供 Halo Lab、完整 B2、ROI 对比与量化报告给用户审核
- **Status:** complete（Halo Lab 已批准，全图替换指标均提升）

### R1: 新母版拆解与材质契约
- [x] 锁定左栏、中央画布、右侧固定工作台的精确比例与层级
- [x] 锁定节点、边、背景星尘的高质感光学分层
- [x] 识别当前 B2 可保留的数据/交互与必须重写的 DOM/CSS
- **Status:** complete

### R2: 三栏骨架与右侧工作台
- [x] 重建左侧导航、顶部主题条、Presence、图例与 MiniMap
- [x] 重建右侧对话/节点/执行 tabs、LLM 对话和 Devin 状态
- [x] 中央画布不再出现大型浮动 Inspector/LLM/Devin Dock
- **Status:** complete

### R3: 星图与光学材质重做
- [x] 重画参考图的主脊、上下分支、候选/未解决/Devin 节点
- [x] 实现白热核心、薄色环、局部 bloom、亮度能级和星点光路
- [x] 重建高频星尘、微弱星云、空间噪声与局部对比
- **Status:** complete

### R4: 响应式与局部交互
- [x] 节点选择同步右侧节点内容
- [x] 对话/节点/执行 tabs 可切换，保持视觉 fixture 边界
- [x] 1280×800 不通过整体缩小正文解决空间问题
- **Status:** complete

### R5: 截图校准与回归
- [x] 1586×992 与新母版逐项对照
- [x] 1280×800 可读性与遮挡检查
- [x] Relay typecheck/tests/build/boundary/HAR 回归
- [ ] 严格视觉分数达到锁定门槛（当前 full SSIM 0.7081、weighted blurred ROI 0.8150、main-spine IoU 0.7236）
- **Status:** in_progress

## Phases

### Phase 1: 基线勘察与视觉拆解
- [x] 确认现有 Relay Web 入口、路由/fixture 选择方式和样式边界
- [x] 确认可复用的图标、组件、测试与构建脚本
- [x] 把 B2 参考图拆成画布层、星图层、浮窗层和状态层
- **Status:** complete

### Phase 2: 确定性视觉场景与页面骨架
- [x] 新增 B2 fixture 与独立视觉入口
- [x] 完成全屏暗色宇宙背景、顶部房间条、左栏、搜索和底部工具栏
- [x] 保证入口不创建 Supabase client 或发出网络请求
- **Status:** complete

### Phase 3: 高还原星图
- [x] 实现蓝色时间主脊、五色语义分支、候选星与未解决问题
- [x] 实现星体 glow、成员身份环、头像缺口、关系线与标签
- [x] 实现星尘背景、缩放层次和参考图中的空间构图
- **Status:** complete

### Phase 4: 浮动 Dock 与细节状态
- [x] 实现节点详情/证据 Dock
- [x] 实现 Devin 运行 Dock
- [x] 实现三路 LLM 共享生成 Dock
- [x] 实现新星提示、图例和静态状态徽标
- **Status:** complete

### Phase 5: 视觉校准与回归
- [x] 生成 1598×1024 和 1280×800 截图
- [x] 与参考图逐项比较层级、比例、间距、亮度和信息密度
- [x] 完成 typecheck、focused tests、Relay build 和现有测试回归
- [x] 明确记录视觉演示与真实协作功能之间的边界
- **Status:** complete

## Fixed Decisions

| Decision | Contract |
|---|---|
| Visual direction | 仅采用 B2 环绕式共创星图 |
| Data | 完全确定性 fixture，无后端依赖 |
| Primary surface | 左侧窄导航 + 中央星图 + 右侧固定工作台 |
| Main axis | 蓝色时间主脊，左右展开 |
| Branch color | 紫、青、绿、橙、粉表示语义分支 |
| Member identity | 不改变节点色；使用外环、头像缺口和状态弧 |
| Live LLM | 本里程碑不实现；真实房间不显示生成中或停止生成 fixture |
| Live workbench | 讨论 / 节点 / 执行，复用真实 Relay callbacks/RLS；旧面板只作回退 |
| Devin | 执行 Tab 展示真实 Action Brief、Session metadata、event log 与 PR 回执 |
| Camera | 本阶段只做低风险视觉交互，不实现协作跟随 |
| Existing product | 保持本地隐私发布边界；把既有 Relay/Supabase 能力迁入 B2，而非另造后端 |
| Demo URL | 仅根路径 <code>/?demo=b2</code>；room/invite 优先 |

## Verification

- TypeScript typecheck
- 视觉入口组件测试
- Relay package tests
- Relay production build
- Playwright 或本地浏览器截图：1598×1024、1280×800
- 浏览器网络检查：视觉 fixture 不产生 Supabase/LLM/Devin 请求

## Error Log

| Error | Attempt | Resolution |
|---|---:|---|
| Explorer spawn rejected a full-history fork with an explicit agent type | 1 | Re-spawn with fork_turns="none" and provide the full bounded brief |
| First planning-file patch was rejected because the patch terminator was malformed | 1 | Reissued a smaller valid patch |
| Combined approved-reference patch used a stale CSS anchor | 1 | Re-read the exact CSS sections and applied smaller TS/CSS patches |
| In-app browser does not support `networkidle` load-state waits | 1 | Switched the live-page check to `domcontentloaded` plus the deterministic `data-b2-ready` marker |
| Zsh expanded the unquoted `?demo=b2` URL as a glob during the final HTTP smoke | 1 | Re-ran curl with the URL quoted; no code or server change required |
| New controller probe recreated the Realtime adapter on every render and caused the focused Vitest run to loop | 1 | Hoisted the adapter outside the probe component; the focused controller suite then passed 5/5 |
| Halo Lab E2E searched for an English heading while the visible heading is Chinese | 1 | Asserted the actual `星体光晕实验室` heading and reran 2/2 successfully |
| Planned white-core lower bound was 83px, but the canonical is exactly 77px under honest Rec.709 luminance | 1 | Kept the luminance definition and corrected the lower bound to 75px instead of gaming the metric |
| First blue-white path calibration reached 174.78L, 0.22 below the locked 175L floor | 1 | Lifted the washed path color by two RGB steps; final 176.28L/0.365S passed |
| B2 room projection determinism test compared closures by identity | 1 | Compare deterministic stars and paths while testing the inverse mapper behavior separately |
| App-wide starfield mock changed async controller test timing and exposed a storage assertion race | 1 | Kept the starfield mock scoped to B2RoomView tests instead of altering the entire App test module |
| Inline SVG `pointerEvents: bounding-box` failed TypeScript CSS typing during build | 1 | Moved the SVG interaction property to the B2 CSS class and kept the component style typed |
| Hidden Candidate parent disabled pointer events but its child hit circle re-enabled them | 1 | Gate role, focus, handlers and the hit target with one `interactiveNow` value; add real coordinate and Tab/Enter tests |
| In-app browser API has no page-level `waitForSelector` helper | 1 | Use a locator and its documented `waitFor({state:"attached"})` method |
| Local Supabase smoke used `ReturnType<typeof createClient>` and inferred an unusable schema type | 1 | Use the explicit test-only SupabaseClient schema shape and keep the untyped direct-write negative case isolated |
| First behavioral smoke expected `room_closed` after close and hit Vitest's 5s timeout | 1 | Closing a room intentionally revokes invite bearers, so assert `invalid_or_expired_invite`; give private Realtime handshake its own 25s integration-test budget |
| Realtime activity assertion waited for `stance_set`, while the durable contract emits `node_stance_set` | 1 | Match the actual stable event type and also verify the same event through sequence replay |
| Broadcast identity-forgery test expected the phrase `unexpected keys`, while Postgres reports `unsupported keys` | 1 | Assert the stable rejection semantics while accepting either backend wording; the forged `userId` remains rejected |
| Packaged macOS app showed Relay as unconfigured despite generated `.env.local` values | 1 | Vite cannot embed dynamic `import.meta.env[name]` reads; replace them with direct `import.meta.env.VITE_*` references and add packaged-config regression tests |
| Rebuilt app still mixed local `.env.local` with stale linked `.env.production.local` values | 1 | Local configurator now updates both ordinary and production-local public env files; linked configuration remains recoverable through its dedicated generator |
| Full Relay suite still queried the former `打开完整协作面板` label after the B2 workbench renamed it | 1 | Align the two UI assertions with the current explicit `打开旧版完整面板（回退）` product copy |

## Session: 2026-08-16 B2 motion language

### M1: 方向与语义锁定
- [x] 建立独立 visual-product run 与产品需求矩阵
- [x] 用相同五状态生成 A/B/C 三套可比较方向图
- [x] 完成 provisional 选择：Direction A 为基础，保留 B 的事件信号与 C 的节点凝结
- [x] 获得用户对混合方向与分阶段实施方案的明确确认
- **Status:** complete

### M2: Motion Lab
- [x] 新增 `/?demo=b2&motionLab=1`
- [x] 实现 deterministic clock、Replay/Pause、100%/200% 和 Reduced Motion
- [x] 首先实现 Selected 与 New Node 两个一次性动作
- [x] 建立固定关键帧、五次字节稳定、双视口、无外联的 Playwright 验收
- [x] 用户完成 Phase 1 视觉批准
- **Status:** complete

### M2.5: Devin Motion Lab
- [x] 实现 850ms 单事件包传播与一次性 Devin 抵达提亮
- [x] 实现 1600ms 中性 stale 衰减、82% 基础体与暖灰断环终态
- [x] Reduced Motion 直接落到静态终帧，不启动 rAF
- [x] 补齐逐帧截图、单包约束、五次字节稳定与禁止 offline 误映射检查
- [x] 用户完成 Phase 2 视觉批准
- **Status:** complete

### M3: Devin 与整图接入
- [x] 实现真实事件语义的单个 path packet 和 stale decay 视觉样例
- [x] 用户批准 Motion Lab 后接入完整 B2 fixture
- [x] 普通 B2 仅在换选节点时播放聚焦；同节点不重播
- [x] 新增 5300ms 确定性完整演示与 Reduced Motion 静态终态
- [x] 建立 eventKey/activitySeq 去重、单包串行和隐藏节点不可交互边界
- [x] 保持静态 canonical、构建、网络与可访问性回归
- **Status:** complete

## Session: 2026-08-16 B2 live Relay integration

### R1: 真实房间视觉纵向闭环
- [x] 确认现有 Supabase controller、RoomBundle、Presence 与 mutation callbacks 可直接复用
- [x] 新增 B2RoomView，将 effective room graph 映射为星图而非矩形卡片
- [x] 接入选择、在线成员、drag preview 与 drag-stop 持久位置
- [x] 保留现有完整结构化协作面板作为可切换的功能兜底
- [x] 仅在 production/live room 使用新视图；B2 canonical fixture 与 Motion Lab 保持不变
- [x] 完成 focused tests、typecheck、build 与 Supabase adapter 回归
- **Status:** complete

### R2: 真实 Supabase 双端验收
- [x] 启动本地 Supabase 并应用现有 migrations
- [x] 从桌面端发布一个已分析图谱，浏览器匿名访客通过 invite fragment 加入
- [x] 用两个真实匿名客户端验证 Presence、选择、拖动持久化与 stance 更新
- [x] 记录 Realtime/RLS/私有频道与 activity replay 的真实验收回执
- **Status:** complete

### R3: 数据库契约硬化
- [x] 运行 pgTAP 并修复真实 Postgres 与静态审计之间的差异
- [x] 增加 owner/member/non-member 的 HTTP/RPC 行为测试
- [x] 验证 invite、CAS、幂等、immutable source 与关闭房间语义
- [x] 确认 Devin provider mutation 只允许 service role
- **Status:** complete

### R4: 本地后端稳定性与成员身份
- [x] 为 `room_members` 增加数据库分配的稳定 `color_key`，并随原子 room bundle 返回完整成员目录
- [x] 将成员色、Presence、焦点与拖动事件全部绑定到服务端确认的用户身份
- [x] 修复 Tauri 打包时动态 Vite 环境变量未嵌入，以及 production-local 配置覆盖本地联调值的问题
- [x] 为刚重置的本地 Auth 增加仅限已知 schema-startup 竞态的 smoke 重试，其他 Auth 错误继续 fail-fast
- [x] 完成 pgTAP、真实 Anonymous Auth/RLS/Realtime smoke、桌面发布、构建与静态安全审计
- **Status:** complete

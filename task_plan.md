# Task Plan: Dialogue Atlas Approved-Reference Visual Reconstruction

## Goal
在不接入 Supabase、Realtime、真实 LLM 或 Devin 的前提下，以用户最新提供的深色三栏星图为唯一母版重做 `/?demo=b2`：左侧导航/图例/小地图、中央时间生长星图、右侧固定“对话/节点/执行”工作台，以及低饱和、白热核心、细彩缘、克制 bloom 的天体材质。

## Current Phase
Halo Material full-graph integration — Halo Lab 已获用户批准，完整 B2 替换与回归已完成

## Scope Boundaries

- 只做视觉和低风险本地交互；所有数据使用确定性 fixture。
- 不连接 Supabase，不读取或写入真实房间。
- 不调用模型、不创建 Devin Session、不触发网络或额度。
- 不重构现有 Relay repository/controller/RLS/Edge Function。
- 不改变现有 Desktop 日历、图谱和 Relay live 入口的行为。
- 视觉演示必须能独立截图、键盘浏览，并在 1280×800 与 1598×1024 下成立。
- 最新用户截图是唯一视觉母版；上一轮浮动 Dock 版只保留为错误方向记录，不再作为验收基准。

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
| LLM | 右侧工作台“对话”tab 中持续生成 |
| Devin | 右侧工作台下半部状态卡，不悬浮到中央画布 |
| Camera | 本阶段只做低风险视觉交互，不实现协作跟随 |
| Existing product | live Relay、Desktop 和 Supabase 代码保持原样 |
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
| Halo Lab E2E searched for an English heading while the visible heading is Chinese | 1 | Asserted the actual `星体光晕实验室` heading and reran 2/2 successfully |
| Planned white-core lower bound was 83px, but the canonical is exactly 77px under honest Rec.709 luminance | 1 | Kept the luminance definition and corrected the lower bound to 75px instead of gaming the metric |
| First blue-white path calibration reached 174.78L, 0.22 below the locked 175L floor | 1 | Lifted the washed path color by two RGB steps; final 176.28L/0.365S passed |
| B2 room projection determinism test compared closures by identity | 1 | Compare deterministic stars and paths while testing the inverse mapper behavior separately |
| App-wide starfield mock changed async controller test timing and exposed a storage assertion race | 1 | Kept the starfield mock scoped to B2RoomView tests instead of altering the entire App test module |

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
- **Status:** waiting_for_visual_approval

### M3: Devin 与整图接入
- [x] 实现真实事件语义的单个 path packet 和 stale decay 视觉样例
- [ ] 用户批准 Motion Lab 后接入完整 B2 fixture
- [ ] 保持静态 canonical、构建、网络与可访问性回归
- **Status:** pending

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
- [ ] 启动本地 Supabase 并应用现有 migrations
- [ ] 从桌面端发布一个已分析图谱，浏览器匿名访客通过 invite fragment 加入
- [ ] 双端验证 Presence、选择、拖动持久化与 stance 更新
- [ ] 记录 Realtime/RLS/重连的真实验收回执
- **Status:** pending_environment

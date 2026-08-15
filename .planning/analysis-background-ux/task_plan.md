# Dialogue Atlas 非阻塞分析 UX 计划

## 目标

把导入后的长时间分析从“弹窗内阻塞操作”改为“应用级后台任务”：用户启动后可以立即返回日历，查看进度、主动停止，完成后再自行打开论点星图。

## 已锁定的产品语义

- “关闭 / 返回日历”只关闭界面，不取消分析。
- 只有明确的“停止分析”才调用后端取消命令。
- 后台完成只刷新日历并提示，不突然切换到论点星图。
- 分析任务按 `runId` 隔离；同一对话沿用后端 single-flight，不重复启动。
- 本阶段只保证应用仍在运行时的后台分析；退出应用或 WebView 重载后的任务恢复留到后续。

## 状态模型

`preparing -> starting -> running -> stopping -> ready | partial | failed | cancelled`

弹窗是否打开是独立状态，不再由分析状态决定。

## 实施阶段

### 1. 应用级任务控制器

- [ ] 在 store 中以 `runId` 保存任务，包含 conversation、日历 entry、阶段、进度、停止状态和终态结果。
- [ ] App 启动后只注册一次全局 `analysis_progress` 监听；组件不再各自拥有监听器。
- [ ] 保留“监听先于 start”语义，接住 `start_analysis` 返回前发出的首个事件。
- [ ] 终态统一刷新日历、发 toast，并保留可打开的 ready/partial 结果。
- [ ] 多任务事件不得互相覆盖；取消必须使用准确的 runId。

### 2. 导入预览弹窗

- [ ] “导入并分析”把不可变 preview 交给应用级控制器。
- [ ] 后端确认任务启动后自动关闭预览弹窗，返回日历。
- [ ] 启动前的 provider 检测失败时不 commit；错误留在弹窗内并恢复操作。
- [ ] X、Escape、点击遮罩和“返回日历”不调用取消。
- [ ] 删除弹窗内的长期 progress listener、完成后自动导航及卸载后回写。

### 3. 日历中的运行状态

- [ ] 月卡、周卡和详情以活动任务覆盖数据库的静态 `未分析` 状态，显示“分析中”或“停止中”。
- [ ] 详情显示当前阶段与 `3 / 7` 等进度，主操作改为“查看分析进度”。
- [ ] 重新打开进度只查看既有 run，不重复 commit 或 start。
- [ ] ready/partial 后显示“打开论点星图”，由用户主动进入。
- [ ] failed/cancelled 后显示原因与“重新分析”。

### 4. 全局任务浮层与停止

- [ ] 把现有被遮罩挡住的进度条改成始终可达的非阻塞任务浮层。
- [ ] 浮层支持一项任务的摘要；存在多项时显示任务数并展开列表。
- [ ] “停止分析”调用 `cancel_analysis(runId)`；返回 true 只进入“停止中…”。
- [ ] 只有收到 terminal event 后才把任务视为停止/完成。
- [ ] 停止中仍允许关闭进度界面和继续浏览日历。

### 5. 统一其他分析入口

- [ ] 日历“开始/重新分析”接入同一控制器。
- [ ] 通用导入弹窗接入同一控制器，移除局部事件监听。
- [ ] 同一 conversation 在终态前不允许重复启动；不同 conversation 的事件与按钮精确隔离。

### 6. 验证与验收

- [ ] Vitest：3/7 时 X、Escape、遮罩、返回日历均能关闭，且 `cancelAnalysis` 为 0 次。
- [ ] Vitest：弹窗卸载后继续收到 progress，日历刷新，且不会自动切到 atlas。
- [ ] Vitest：重新打开进度不产生第二个 run；无关 conversation/run 不串线。
- [ ] Vitest：停止传入正确 runId，true 后显示停止中，cancelled 后才结束。
- [ ] Vitest：provider preflight 失败不 commit；start 失败后保留已提交版本并可重试。
- [ ] 修正 browser mock，使 `cancelAnalysis` 返回真实 boolean 契约。
- [ ] 运行 typecheck、全量 Vitest、Playwright 既有回归和 production build。
- [ ] macOS 原生 smoke：真实任务在 3/7 时关闭弹窗，继续浏览、重开进度、停止一次；另跑一次关闭后自然完成并手动打开图谱。

## 暂不纳入本轮

- 应用退出后继续分析。
- WebView reload 后恢复 runId / progress。
- 新增数据库迁移或分析任务持久化查询 IPC。
- Windows 专项适配。

## 完成定义

用户在任意长阶段都不会被弹窗困住；关闭与停止含义明确；后台任务的进度、终态、重试和星图入口均可追踪；不会重复启动、串任务或突然抢占导航。

# Task Plan: Dialogue Atlas 对话日历 v1

## Goal
在同一 Tauri/React 代码库中交付以真实 Codex 可见消息时间为依据的本地月/周对话日历：macOS 可增量索引本机会话、流式预览与版本化导入，Windows 保持可编译且不开放自动索引；所有日历、索引和预览路径零模型请求。

## Current Phase
Phase 5 — 集成验证与打包回归（complete on macOS; Windows-native gate remains external）

## Phases

### Phase 1: 时间与数据契约
- [x] 追加迁移 0003，保持旧迁移不可变
- [x] 从 raw rollout 保存消息级 UTC/原始时间/turn ID/覆盖状态
- [x] flat/paste 缺失时间保持 undated，绝不回退 created_at
- [x] Repository 往返、旧库迁移和真实样本时间验收
- **Status:** complete

### Phase 2: macOS 本地会话索引
- [x] 实现普通 rollout 文件发现、头尾解析、签名缓存和 session 合并
- [x] 实现启动扫描、手动刷新、取消、进度、缺失/归档状态
- [x] 确认工具/推理尾记录不推进 lastActivityAt，扫描零模型/零网络
- **Status:** complete

### Phase 3: 月视图与周视图
- [x] 默认月视图：42 格、周日起始、3+N、日期未知入口
- [x] 周视图：7×24h、精确时间点、固定高度卡片、45 分钟碰撞簇
- [x] 详情、状态动作、星图跳转、键盘导航与东京当前时间线
- [x] 切换/浏览日历不得写入星图布局
- **Status:** complete

### Phase 4: 流式预览与版本化导入
- [x] 移除 50 MB 总文件拒绝，逐行读取并跳过大体积非可见字段
- [x] 支持 SHA-256、开始/结束签名、末行未完成、进度与取消
- [x] 相同 session+SHA 幂等；源更新创建不可变新版本
- [x] 无 provider 时不创建 conversation，不增加仅保存流程
- **Status:** complete

### Phase 5: 集成验证与打包回归
- [x] Rust、Vitest、Playwright 月/周与边界测试
- [x] 对当前真实 Codex 目录做零模型索引 smoke
- [x] macOS app/DMG 回归；Windows 源码/前端回归并诚实记录原生门槛
- [x] 独立审计隐私、时间语义、布局非干扰和版本不可变性
- **Status:** complete on macOS; Windows 11/MSVC native build remains the pre-existing external acceptance gate

## Fixed Decisions
| Decision | Contract |
|---|---|
| Calendar timestamp | 最后一条过滤后的可见 user/assistant 消息 |
| Completion timestamp | 最后一条 assistant final；与活动时间不同则状态未确认 |
| Presentation timezone | 固定 Asia/Tokyo，存储 UTC |
| Week boundary | 周日开始 |
| Missing timestamps | 日期未知；不得使用导入时间、mtime、exported_on 等替代 |
| macOS indexing | 启动一次 + 手动刷新；不监听、不轮询 |
| Windows | 保持编译，v1 不索引 Codex 目录 |
| Privacy/network | 索引、日历、预览不触发模型或网络 |

## Error Log
| Error | Attempt | Resolution |
|---|---:|---|
| Existing planning files described the completed Windows handoff | 1 | Rebased the active plan on calendar v1 while retaining prior history in Git/progress |
| Vitest does not support Jest's `--runInBand` option | 1 | Re-run the repository's native `npm test` command without the unsupported flag |
| New calendar component test imported the browser-demo store without a localStorage shim | 1 | Align the test setup with existing Tauri-adapter component tests before import |
| First visual-baseline grep did not match the new E2E test title | 1 | Use the exact `renders deterministic` title fragment for candidate capture |
| Mid-edit Rust check saw incomplete repository helpers and DTO initializers | 1 | Keep the temporal worker's file ownership intact; rerun after its atomic implementation pass completes |
| First full real-home smoke aborted when the active rollout changed during scanning | 1 | Retry one fresh signature, preserve cached rows or skip an unstable new file, and commit all stable sessions |
| Old B5 screenshot changed after adding the calendar rail icon | 1 | Inspected the diff, confirmed it was limited to the intended rail state, then regenerated and reran the full E2E suite |
| Analysis progress could be consumed by another conversation before the run ID returned | 1 | Added conversation ID to the frontend contract and guarded all three analysis entry points before run-ID matching |
| Final Rust format check was first invoked from the frontend root | 1 | Re-ran with the explicit `src-tauri/Cargo.toml` manifest; format and diff checks passed |
| The first >50 MB preview regression could not access Tauri's mock runtime | 1 | Enabled Tauri's test-only feature as a dev dependency; production features remain unchanged |

## Notes
- 不进行任何付费 OpenAI/Codex turn。
- 不把浏览器 fixture 验收等同于原生 macOS/Windows 验收。
- 不把用户真实 JSONL 正文加入测试 fixture 或日志。

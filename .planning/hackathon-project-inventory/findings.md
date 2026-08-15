# Findings

## 已知基线

- Dialogue Atlas 是 macOS 本地 Tauri/React 应用，核心包含对话日历、可见消息导入、模型分析与论点星图。
- 需要以当前 checkout 为准重新验证；旧记忆只作为查找线索。
- 已锁定的产品边界包括：不展示隐藏推理；日历使用可见消息时间；内部 subagent 会话在后端过滤但不删除源数据。

## 待补

- 当前前端与后端真实功能清单。
- 当前测试与打包状态。
- 黑客松演示所需但尚未完成的能力。

## 当前 checkout 结构

- 当前分支为 `main`，但日历 v1、主会话过滤等大量改动仍在工作树中，包含未跟踪迁移、`calendar.rs`、React 日历组件和视觉基线；现状文档必须描述工作树，而不能只描述 HEAD。
- 产品版本为 `0.1.0`，桌面壳为 Tauri 2，前端为 React 19/TypeScript/Vite，图谱使用 React Flow 12 与 ELK.js，状态使用 Zustand，后端为 Rust、SQLite/sqlx。
- macOS 包目标为 `.app` 与 `.dmg`，bundle id 为 `com.visiontale.dialogueatlas`，默认窗口 1536×1024。
- README 已记录原始 rollout、清洗 export、粘贴导入，OpenAI API 与 macOS Codex 两条分析路径，以及无隐藏推理/无 tool graph 等边界；需要逐项与当前代码核对。

## 已记录但需重新验证的现状证据

- 旧进度记录称 calendar v1 的最后一次回归为 Rust 80 passed / 6 ignored、Vitest 56/56、Playwright 13/13，并完成 macOS app/DMG 与真实目录零模型索引。
- 当前用户已确认后续只推进 macOS，因此最终黑客松文档把 Windows 作为历史兼容工作，不作为当前展示主线。
- 当前工作树仍未实现非阻塞分析 UX；该项只有独立计划，不能写为现成功能。

## 后端与数据契约

- Tauri 注册 25 个 IPC，覆盖导入预览、Codex 本地索引、日历查询、版本列表、provider 设置与检测、分析/取消/重试、快照、纠正和布局保存。
- SQLite 有四层迁移：基础 conversation/message/run/snapshot/correction/layout；provider 设置；消息时间与本机 session/version 索引；primary/internal/unknown 会话分类。
- 分析上限为 100 个可见轮次、120,000 字符、300 个语义单元；prompt 版本为 `dialogue-atlas-v2`。
- 三阶段模型管线是语义切片/行为分类、证据约束关系、柔性模式叠层；随后本地验证端点、逐字引用、UTF-16 offset 和模式 membership。失败可生成 deterministic fallback 并把快照诚实标为 partial。
- 对话行为词表含提问、请求、任务、建议、回答、解释、论证、质疑、纠正、假设检验、证据、撤回等；关系含回应、支持、条件、修正、撤回、重新打开、中断后续答、未解决等。
- 模式叠层明确不是自然聚类或线性阶段；允许重复、小岛、多重归属和无归属。
- 原文、AI 基础快照、append-only correction 和布局分层保存；纠正不能改写消息、说话者、source span 或原始快照。
- 隐私预览在本地提示 API key、敏感字段、邮箱与本地路径，可把遮盖后的文本发给模型并保留 source offset 映射。
- OpenAI Responses 请求固定 strict JSON Schema、`store:false`、`background:false`；release 固定官方 `/v1`，debug override 只允许带端口的本机 loopback。

## 日历与前端体验

- macOS 启动时索引 `~/.codex/sessions` 与 `archived_sessions`，只接受普通 `rollout-*.jsonl`，跳过 symlink；最多四文件并发，未变文件按 size/mtime 缓存，正在写入的不稳定文件重试后保留旧缓存。
- 索引只把结构化 metadata 判定的 primary session 暴露给日历；internal 与 unknown 在 repository 查询入口统一隐藏，源记录没有被删除。
- 日历以最后一条过滤后的可见消息作为时间点，以最后 assistant final 判断是否完成；固定 Asia/Tokyo。月视图为 42 格、每日 3+N；周视图为 7×24 小时、精确分钟锚点和 45 分钟簇；日期未知单列。
- 流式本地预览计算 SHA 和文件签名，支持取消、末尾正在写入提示、同 session+SHA 幂等，以及源更新后的不可变新版本。
- 默认主视图是日历；星图支持 pan/zoom、MiniMap、原文搜索、ELK 整理、手动拖动 pin、次级片段折叠、模式岛开关、上下文抽屉、线性大纲和待复核列表。
- 节点按 anchor/card/operation/unresolved 等结构角色呈现，大小不按文字量；边按关系类型着色并显示方向标签；选择后弱化无关节点。
- 逐字证据面板连接节点/边到原文；用户可修改行为标签、关系、模式名称/归属并追加 correction，基础快照保持不变。
- 浏览器模式只提供 B5 fixture 与交互/视觉回归，不读取本地文件、凭据或运行模型；UI 已明确标注为固定示例。

## 当前确认的 UX 缺口

- 分析进度仍由各弹窗局部拥有，store 只有单个 progress；长分析会把日历预览弹窗锁住，X/Escape/返回均被禁用，且被遮罩挡住的全局停止条不可操作。
- 非阻塞分析已有完整计划，但尚未实现：不能把“关闭后后台继续、卡片显示分析中、重开进度”列为现成功能。
- 侧栏“筛选”目前只是提示“已简化为原文搜索和模式开关”，不是完整筛选系统。
- 普通运行仍内置 B5 fixture 作为无快照时的占位，虽然有诚实标注，但黑客松演示应避免让观众误以为这是实时分析结果。

## 2026-08-15 当前验证

- TypeScript typecheck：通过。
- Rust `cargo check --locked --all-targets`：通过，但存在未使用函数/字段的 dead-code warnings。
- Vitest：14 个文件、56 个测试全部通过。
- Rust：83 passed、0 failed、6 ignored；ignored 包括真实 Codex home/sample smoke、零模型 installed CLI readiness 和会消耗额度的真实 turn smokes。
- Playwright：13/13 通过，覆盖图谱视觉、证据、次级片段、搜索、纠正、fixture 诚实性、关系编辑、provider UI，以及月/周日历视觉。
- 前端 production build：通过。生成的 ELK worker 未压缩体积约 1.43 MB，主 JS 约 494 KB；对本地桌面应用可接受，但仍可做加载优化。
- 本轮没有运行真实模型请求、真实 Codex turn 或付费 OpenAI 请求。
- 当前磁盘上存在 2026-08-13 20:05 构建的 Apple Silicon `.app` 和 7.6 MB DMG；DMG 当前 SHA-256 为 `38cec181925cddf9b09cefd5482fafc351233d6eb2c918707bb4acde36102f8d`。
- `.app` 不是可验证的完整 ad-hoc bundle signature：`codesign --verify --deep --strict` 退出 1，并报告 `code has no resources but signature indicates they must be present`。DMG 被 Gatekeeper 判定为 `no usable signature`，且无 notarization ticket；当前只适合同一台开发机上的受控演示。
- `git diff --check` 通过；当前功能改动规模约 3,645 additions / 182 deletions，且若干核心日历文件仍未跟踪，黑客松前必须先形成可回退提交。

## 当前本机数据快照（只读统计）

- SQLite 当前索引 521 个 Codex session：161 primary、360 internal；过滤后保留主要任务，未删除内部记录。
- 已导入 6 段 conversation，共 256 条可见消息、197 个可见轮次、6 个 snapshot/layout；当前没有 correction event。
- 6 次分析均走 `codex_cli / gpt-5.6-luna`，且状态全部为 `partial`，累计记录 72,582 input tokens 与 37,511 output tokens。
- 早期三个 snapshot 都是 0 relations、32–34 个 validation issues；后期三个分别为 26/13/23 条关系，但仍有 2/3/20 个 issues。说明分析链路已经能产出丰富结构，但稳定性和质量仍明显依赖对话形态与模型输出。
- 这组统计是当前个人本机数据，不是产品基准或通用准确率，黑客松材料不能把它包装成模型效果实验。

## 最终文档

- 已生成 `docs/Dialogue_Atlas_黑客松项目现状全景.md`，共 13 个主体章节。
- 文档区分已实现、固定 fixture 与尚未实现能力，并单列 P0/P1/P2 不足、真实数据、验证结果和三种黑客松交付场景的就绪度。

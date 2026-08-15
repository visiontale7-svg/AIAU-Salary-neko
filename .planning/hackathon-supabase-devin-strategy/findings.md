# Findings

## 已知项目基线

- 当前产品已经具备本机对话日历、流式可见消息导入、三阶段分析、论点星图、逐字证据和追加式人工纠正。
- 真实本机 6 次分析全部为 partial，因此现场不能只依赖实时分析。
- 当前最强辨识度是“从时间中找到任务，从结构中重新理解任务”。
- 当前缺少跨对话价值闭环、分享/协作和可量化的用户结果。

## 待核对

- 最新官方评分与赞助工具要求。
- Supabase 最适合承接的数据和协作闭环。
- Devin 可以独立完成且容易展示的工程包。
- 主方案与备选方案的演示风险。

## 官方规则核对（2026-08-15）

- 官方把比赛定义为“Supabase × Devin，把想法在三天内做成实际运行产品”的离线黑客松。
- Supabase 与 Devin 是推荐工具而非强制技术栈，但有效使用既影响 25 分 sponsor-tool 项，也关系 Supabase / Cognition 单项奖。
- 评分：工具活用 25、完成度/实际运行 25、创意 20、问题价值/影响 15、Demo 表达 15。
- 官方特别列出 Supabase 的 Postgres、Auth、Storage、Edge Functions、Realtime、Vector；因此方案应至少让数据库、Realtime 或权限成为用户体验的一部分。
- 主题自由；Dialogue Atlas 可落在 AI-native 与 realtime/collaboration 的交叉位置。
- 最终先按 Project title、description、附件/GitHub URL 预选十队，所以仓库证据、清楚架构和一条稳定 Demo 都重要。

## 技术核对

- 当前前端没有 Supabase 依赖；需要新增 `@supabase/supabase-js` 和明确的 browser/Tauri 配置边界。
- `AtlasSnapshot` 已经有稳定的 units、relations、modes、source spans 和 layout，适合生成一个经过用户确认的 `SharePackage`，无需把原始 JSONL 上传云端。
- Supabase 官方能力可直接对应协作体验：Postgres 保存房间和审阅结果，Anonymous Auth 提供无邮箱的 authenticated user，RLS 限制房间成员，Realtime Presence 显示在线成员，Broadcast 或 Postgres Changes 同步选择与审阅。
- 当前 repo 仍是大规模脏工作树，因此任何黑客松开发必须先形成 baseline commit；否则 Devin 无法得到稳定任务起点。

## 方案筛选

1. 个人 AI 工作周报：改动较小，但 Supabase 只是云存储，实时性和团队价值弱。
2. 跨对话主题聚合：长期价值高，但依赖更多模型调用和不稳定的跨会话分析，不适合当前演示窗口。
3. 团队决策交接房间：把个人 AI 对话发布成团队可共同确认的证据星图；最大化复用现有 Atlas，并让 Supabase Realtime/RLS 成为可见核心。

主选方案为第 3 项。核心问题是：个人和 AI 完成的复杂工作被锁在长对话里，发给队友后无法快速判断哪些是决定、依据、争议与未解决问题。

## 最终主方案

- 产品名：Dialogue Atlas Relay。
- 核心闭环：本地对话→证据星图→用户确认的 SharePackage→Supabase Review Room→实时审阅→Decision Handoff。
- Supabase：Anonymous Auth、Postgres JSONB snapshot、规范化 review、RLS、Presence、Broadcast/Postgres Changes。
- Devin：分别承担 schema/RLS、Realtime client、双客户端 E2E 三个有边界的工程包，保留 PR/test/review receipt。
- 主 Demo 不运行实时分析，使用脱敏且人工核验的 snapshot；实时模型只作可放弃加分项。
- 官方页面当前显示 Day 3 的提交截止为 8 月 16 日 12:50，开发顺序必须先纵向跑通，再加实时细节。

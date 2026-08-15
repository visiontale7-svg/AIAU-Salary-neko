# Dialogue Atlas 黑客松转化方案

## 目标

基于当前 Dialogue Atlas 已实现能力、AIAU Craft Day 评分标准以及 Devin / Supabase 的可证明使用方式，产出一套主方案：明确用户痛点、核心闭环、Supabase 运行时职责、Devin 开发职责、现场 Demo、最小开发范围和风险降级。

## 阶段

- [completed] 核对比赛最新公开规则与评分重点
- [completed] 对照当前项目优势和不足，筛选适合黑客松的产品叙事
- [completed] 设计 Supabase 与 Devin 的不可替代角色
- [completed] 给出主方案、演示脚本、开发范围和备选降级
- [completed] 校验方案不依赖未实现能力或不稳定实时分析

## 固定原则

- Supabase 必须是运行时核心能力，而不是只存一个配置表。
- Devin 必须留下可审计的任务、diff/PR、测试和复核证据，而不是只写在介绍页。
- 以稳定的端到端 Demo 优先，不把实时长分析作为唯一主路径。
- 保留 Dialogue Atlas 的证据可追溯、partial 与人工纠正边界。
- 当前推进仅面向 macOS。

## 错误记录

| 错误 | 处理 |
|---|---|
| 从 Supabase HTML 通过 `rg -m` 提取片段时 curl 报 `Failure writing output to destination` | 下游达到匹配上限后提前关闭管道，不是网络或页面失败；所需官方文本已成功读取，不重复请求 |

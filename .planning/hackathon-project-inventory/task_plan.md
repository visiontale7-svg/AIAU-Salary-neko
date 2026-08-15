# Dialogue Atlas 黑客松项目现状盘点

## 目标

基于当前代码库而非旧计划，生成一份完整 Markdown，整理项目定位、用户问题、现有功能、系统架构、数据与隐私边界、验证现状、已知不足以及转成黑客松项目时真正需要补齐的内容。

## 阶段

- [completed] 盘点代码库、运行脚本、依赖与当前变更范围
- [completed] 核对前端功能、后端数据流、分析来源及安全边界
- [completed] 核对测试、打包、原生运行证据及未闭合事项
- [completed] 编写项目现状 Markdown，明确区分已实现、示例与计划
- [completed] 交叉校验文档中的路径、数字、功能和限制

## 固定原则

- 不把 mock、fixture 或规划项描述为已实现能力。
- 不把可观察对话行为描述为隐藏 chain-of-thought。
- 日历时间依据最后一条可见消息，不使用导入时间代替。
- 本轮只写文档，不修改产品功能代码。

## 错误记录

| 错误 | 处理 |
|---|---|
| 首次 explorer spawn 同时指定 full-history 与 agent_type 被拒绝 | 改为 `fork_turns: none` 并在任务中写明路径与范围 |
| `sqlite3 -readonly` 因 URI/空格路径无法打开数据库 | 改用 `file:...?...mode=ro&immutable=1` 的只读 URI，随后只查询聚合统计 |

# Findings

## 根因

- 后端 `start_analysis` 已把分析放入独立的 Tauri 异步任务，任务不依赖弹窗生命周期。
- 当前锁死来自 `CalendarImportPreviewDialog` 的单一 `busy`：整个 7 阶段周期内，Escape、遮罩、X 和“取消”全部禁用。
- 当前进度监听器由弹窗持有；只解除按钮禁用会造成卸载后监听泄漏，并可能在后台完成时突然切换到星图。
- App 的进度浮层只消费单个 `progress`，且位于 modal backdrop 下方；后端却允许不同 conversation 并发。

## 取消契约

- `cancel_analysis(runId) == true` 只表示取消请求已被接受，不代表任务已经停止。
- 真正停止以后，后端才写入 `cancelled`、发送 terminal progress、清理 job 并释放 conversation reservation。
- 因此 UI 必须使用“正在停止…”，并以 terminal event 为最终依据。
- 关闭弹窗不需要改 Rust，也不应调用取消。

## 重要边界

- 初始 progress 可能在 `start_analysis` 返回 runId 之前发出，所以全局 listener 必须常驻。
- 当前事件没有 replay/query；应用重载后无法恢复正在运行的任务。本轮明确只保证同一次应用运行。
- terminal event 与 reservation 释放之间存在极短竞态；立即重试需要回归测试，必要时再把后端清理顺序作为硬化项。

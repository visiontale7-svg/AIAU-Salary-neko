# Dialogue Atlas · Windows Codex 接手说明

> 先完整阅读本文件，再执行命令或修改代码。

## 1. 这份包是什么

这是一份可直接交给 Windows 11 x64 环境中 Codex 的完整工程副本，包含：

- Dialogue Atlas 的已提交源码与本地 Git 历史；
- `package-lock.json` 与 `src-tauri/Cargo.lock`；
- Windows Tauri／NSIS 配置；
- Win32 视觉基线生成脚本；
- Windows 原生构建脚本；
- 本地模拟 OpenAI 服务与测试 fixture；
- Windows 原生验收清单。

工程目录不配置 Git remote，避免把本机路径当成远端或意外推送。只有用户明确指定远端后才能添加。

这是用户个人设备间的内部移交。保留的 Git 历史含本地提交作者信息，规划记录可能提到原 macOS 工作区路径；未经净化不得对外分发。

本包不包含：

- `node_modules`、`dist`、Rust `target`；
- SQLite 数据库、日志、Playwright 临时产物；
- `.env`、真实 OpenAI API Key、Windows Credential Manager 凭据；
- macOS Keychain 或 Codex／ChatGPT 登录文件；
- 已验收的 Windows 安装包或 Win32 截图基线。

测试 fixture 有意包含 `sk-fixture-secret`、`sk-fixture-only` 等不可用的合成字符串，它们是脱敏与泄漏防护契约，不是真实 Key，也不要误删。

完整内容边界见 [Windows package manifest](WINDOWS_PACKAGE_MANIFEST.md)。

## 2. 当前真实状态

已经完成并在 macOS 上验证的部分：

- Windows 只开放 `openai_api`；后端设置、检测、启动和重试入口都会拒绝 `codex_cli`；
- Windows 二进制不编译 macOS Codex runner、Seatbelt 或 Unix 进程代码；
- SQLite 使用 LocalAppData；
- API Key 使用 Windows Credential Manager，并要求 `persistence=Local`；
- NSIS 为 current-user 安装，WebView2 使用 download bootstrapper；
- Release 固定访问官方 OpenAI 地址；只有 debug 测试可使用显式端口的 localhost `/v1`；
- 本地模拟服务覆盖 success、partial、invalid evidence、slow cancellation 和 retry；
- macOS 上 TypeScript、Vitest、Playwright、Rust debug/release、Tauri 打包和测试钩子扫描通过；
- 两轮独立代码审计未发现剩余 P0/P1。

尚未完成、必须在真实 Windows 11 x64 上完成的部分：

- Win32 视觉基线生成与人工审核；
- MSVC 原生编译；
- Windows Credential Manager 实机验证；
- NSIS 安装、卸载、二次启动聚焦和缩放 smoke test；
- LocalAppData 与重启持久化检查；
- Windows 安装包及其 SHA-256。

没有执行真实 OpenAI API 请求。不得宣称真实 API 连通性或计费已经验证。

## 3. 不得扩大范围

本轮只完成 Windows 11 x64、OpenAI API provider 的内部 MVP 验收。

禁止：

- 实现、启用或测试 Windows Codex 额度路径；
- 使用真实 OpenAI API Key 或发送真实 OpenAI 请求；
- 把 mock server 编入正式安装包；
- 为了让测试通过而删除、跳过或自动批准 Win32 截图门；
- 把 Credential Manager 从 `Local` 放宽为 `Enterprise`；
- 让 Release 接受任意 `OPENAI_BASE_URL`；
- 静默从 Codex 回退到 OpenAI，或反向回退；
- 增加 MSI、ARM64、Windows 10、签名、自动更新、云同步或数据迁移；
- 把 macOS、交叉编译或浏览器结果写成 Windows 原生通过。

如果发现 Windows 专属缺陷，可以在当前仓库中修复并提交，但不得绕过上述边界。

## 4. 环境要求

必须使用 Windows 11 x64 实机或虚拟机，并安装：

- Git for Windows；
- Node.js 24 LTS；
- Rust 1.97.1；
- Rust target `x86_64-pc-windows-msvc`；
- Visual Studio 2022 Build Tools；
- workload `Desktop development with C++`；
- Windows 11 SDK；
- PowerShell。

建议解压到 `C:\work\dialogue-atlas` 之类的短本地路径，不要放入 OneDrive、Dropbox 或其他同步目录。npm、Cargo、Playwright 与 WebView2 安装需要普通依赖下载网络；本轮禁止访问 OpenAI API。

在项目根目录先检查：

```powershell
git status --short
git log --oneline -3
git remote -v
git fsck --no-reflogs --unreachable
node --version
rustc --version
rustup target list --installed
```

预期：

- `git status --short` 没有输出；
- `git remote -v` 没有输出；
- `git fsck --no-reflogs --unreachable` 没有输出；
- Node 为 `v24.x`；
- Rust 为 `rustc 1.97.1`；
- 已安装 `x86_64-pc-windows-msvc`。

如果版本不符，先修复环境，不要修改构建脚本绕过版本检查。

## 5. 第一阶段：生成并审核 Win32 视觉基线

在项目根目录运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\capture-windows-visual-baseline.ps1
```

脚本会生成并打开：

```text
tests\e2e\dialogue-atlas.spec.ts-snapshots\b5-atlas-1536x1024-win32.png
```

必须由人工在 100% 显示比例下检查：

- 顶栏明确显示“固定示例图谱 · 未运行分析”；
- 示例不被描述为 AI／模型运行结果；
- 星图节点、关系、模式岛、MiniMap 与证据面板没有裁切或覆盖；
- 中文、英文、数字与图标渲染正常；
- 1536×1024 画面与现有设计契约一致。

确认后提交该 PNG：

```powershell
git add tests/e2e/dialogue-atlas.spec.ts-snapshots/b5-atlas-1536x1024-win32.png
git commit -m "test: approve Windows visual baseline"
```

如果视觉不合格，应修复 UI、重新生成并再次人工检查；不得直接批准失败截图。

## 6. 第二阶段：完整 Windows 构建

视觉基线提交后运行：

```powershell
.\scripts\build-windows-internal.ps1
```

脚本会依次执行：

1. Node／Rust／target 强校验；
2. `npm ci`；
3. TypeScript 类型检查；
4. Vitest；
5. Playwright；
6. Windows MSVC `cargo check`；
7. Windows MSVC `cargo test`；
8. 真实 Windows Credential Manager 的 Local round-trip smoke；
9. unsigned current-user NSIS 构建；
10. Windows release 与 NSIS 的测试钩子排除扫描；
11. 输出安装包路径和 SHA-256。

保存完整 PowerShell 输出。任一步失败都应停止，不得继续声称构建通过。

预期安装包位于：

```text
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\
```

## 7. 第三阶段：本地模拟分析

模拟服务只监听随机 localhost 端口，不访问 OpenAI。success 场景必须带 `-VerifyRestart`：

```powershell
.\scripts\start-windows-mock-smoke.ps1 -Scenario success -VerifyRestart
```

脚本启动后：

1. 记录它显示的测试端点、测试 Key、smoke credential target、紧急清理命令和 request log 路径；
2. 在 Dialogue Atlas 设置中保存该 TEST-ONLY Key；
3. 分别导入 `fixtures\codex-rollout-minimal.jsonl` 与 `fixtures\conversation-export-flat-minimal.jsonl`；
4. 检查可见轮次和隐私预览；
5. 确认并开始分析；
6. 检查语义节点、证据关系、模式岛、使用量与逐字证据；
7. 修改一个关系或标签，拖动并固定节点；
8. 退出应用，让脚本清理测试凭据和临时 stdout／stderr。

脚本会在同一隔离凭据账户下启动应用两次，并只在第二次退出后清理。第二次启动不得要求重新输入 TEST-ONLY Key。若脚本或终端异常终止，使用它启动时打印的 `cmdkey.exe /delete:<target>` 命令清理 smoke credential。

然后依次运行：

```powershell
.\scripts\start-windows-mock-smoke.ps1 -Scenario partial
.\scripts\start-windows-mock-smoke.ps1 -Scenario invalid_evidence
.\scripts\start-windows-mock-smoke.ps1 -Scenario slow
.\scripts\start-windows-mock-smoke.ps1 -Scenario retry_once
```

预期：

- `partial`：关系阶段失败可见，不伪造关系；
- `invalid_evidence`：非法逐字证据被拒绝或只进入确定性回退并标记待复核；
- `slow`：取消后任务停止，不自动重放；
- `retry_once`：首次失败，只有用户明确重试才产生新请求。

检查 request log：每个 `/responses` 请求都必须包含 `store:false`、`background:false`，且只包含用户确认后的可见／遮盖文本。request log 含测试对话，记录断言后删除。

## 8. 第四阶段：安装包原生 smoke test

严格执行 [Windows 原生验收清单](docs/windows-internal-mvp.md)，至少确认：

- current-user 安装无需 UAC；
- SmartScreen 警告与“未签名内部包”预期一致；
- 第二次启动聚焦已有窗口，不创建重复实例；
- Windows UI 只显示 OpenAI API，不显示 Codex；
- `Ctrl+K` 可用；
- 中文及 emoji 路径的原始 rollout 和可见导出均可预览；
- 无 Key 时预览可用，但正式分析在创建 run 前被阻止；
- dummy Key 重启后仍可检测，Credential Manager 属性严格为 `Local`；
- SQLite 只出现在 `%LOCALAPPDATA%\com.visiontale.dialogueatlas`；
- `%APPDATA%` 对应目录没有数据库；
- SQLite、日志、浏览器存储和错误文本不包含完整 Key；
- 纠正、节点 pin、模式开关和 viewport 重启后保留；
- 125% 与 150% 缩放下设置、图谱、MiniMap 和证据面板可用；
- 卸载不需要管理员权限；
- 安装包 SHA-256 与构建记录一致。

## 9. 发生 Windows 专属失败时

先保存：

- 完整命令；
- 完整错误；
- Windows、Node、Rust、MSVC 和 SDK 版本；
- 最小复现步骤；
- 相关截图；
- `git status --short` 与当前 commit。

然后只修复确认的 Windows 缺陷，并运行与风险相称的完整回归。不要通过放宽安全边界、移除断言或自动更新截图掩盖失败。

每个修复使用独立 commit，并在最终记录中列出 commit、原因和验证结果。

## 10. Windows Codex 必须返回的验收记录

最终请生成 `WINDOWS_NATIVE_RECEIPT.md`，至少包含：

```markdown
# Dialogue Atlas Windows Native Receipt

## Environment
- Windows edition/build:
- Architecture:
- Node:
- Rust:
- MSVC / Windows SDK:
- Source commit:

## Visual baseline
- PNG path:
- Human reviewer:
- Review result:
- Commit:

## Automated checks
| Check | Result | Evidence |
|---|---|---|
| TypeScript | | |
| Vitest | | |
| Playwright | | |
| Cargo check | | |
| Cargo test | | |
| Credential Manager Local smoke | | |
| Release test-hook exclusion scan | | |
| NSIS build | | |

## Offline native analysis
| Scenario | Result | Evidence |
|---|---|---|
| success | | |
| partial | | |
| invalid_evidence | | |
| slow cancellation | | |
| retry_once | | |

## Manual smoke
- No-UAC install:
- Second-launch focus:
- LocalAppData only:
- Credential persistence Local:
- Restart persistence:
- 125% scaling:
- 150% scaling:
- Key leakage search:

## Artifact
- NSIS path:
- SHA-256:
- Unsigned/SmartScreen notice:

## Unverified
- Live OpenAI connectivity and billing remain unverified.

## Failures or code changes
- None, or list each failure/fix/commit/evidence.
```

不要只写“通过”。每项必须有路径、输出摘要、截图或可复现证据。

## 11. 完成标准

只有以下条件全部满足，才可以说 Windows 内部 MVP 原生验收完成：

- Win32 截图已人工审核并提交；
- 锁定的自动化测试全部通过；
- Credential Manager、LocalAppData 和单实例行为在 Windows 上通过；
- 模拟分析全流程与失败场景通过；
- NSIS 安装、启动、卸载、缩放和持久化通过；
- 生成 `WINDOWS_NATIVE_RECEIPT.md`；
- 提供 NSIS 安装包和 SHA-256。

即使以上全部通过，也只能声明离线模拟流程已验证。真实 OpenAI API 连通性与计费必须在以后取得用户授权和临时 Key 后单独验证。

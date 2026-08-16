# Findings & Decisions

## 2026-08-15 — Approved reference reset

- 用户最新提供的三栏截图取代上一轮“环绕式浮动 Dock”图片，成为唯一母版。之前的布局方向错误，不能靠微调 glow 修复。
- 页面骨架是：约 64 px 左侧导航；中央星图画布；约 400 px 右侧固定工作台。右栏顶部为“对话/节点/执行”tabs，中部为 LLM 对话，底部为 Devin 状态。
- 中央画布包含顶部主题选择与三人在线状态、左上图例、左下 MiniMap、底部工具栏；没有大型节点证据浮窗或多人 LLM 浮窗。
- 目标光感不是高饱和霓虹：小面积白热核心、极薄彩色 corona、宽而低透明度的局部 bloom、锐利的 1 px 光路线与稀疏星点高光。
- 亮度必须稀缺且分级。主干源节点最亮，普通分支节点次之，候选/未解决/Devin 使用形状区分；不能让每颗星拥有同尺寸同强度的三层圆形 halo。
- 背景质感依赖高频细星尘、局部星云、微弱噪声和暗部层次，而不是用大面积彩色圆晕填充空白。
- 文字与面板使用低对比蓝灰、细描边与近黑实体表面；发光只属于星图，不应扩散到所有控件。

### Reuse boundary

- 保留 `/?demo=b2`、route guard、lazy chunk、确定性 fixture、无网络/HAR 回归和基础节点数据。
- 重写 B2 页面骨架、SVG filters、节点视觉、背景纹理与右栏组织；不继续修补旧浮动 Dock CSS。
- 中央 SVG 必须使用独立 1100×992 坐标系并优先 `meet`，避免三栏布局中 `slice` 裁掉主干两端。
- 1280 px 下右栏保持约 350–360 px，MiniMap/图例压缩次要信息但不整体缩小正文。

### Approved-reference verified geometry and material

- 1586×992 顶层网格已按母版固定为 `64 px rail + 1096 px canvas + 426 px workbench gutter`；右栏 panel 的左右 inset 为 10/12 px。
- 主干本地锚点已经对齐 `root(79,488) → value(212,432) → experience(379,434) → feasibility(537,449) → risk(686,461) → bridge(834,510) → next(963,543)`。
- 青色分支现在使用无标签 junction `(348,522)`，`2.1` 位于 `(270,608)`；橙色分支恢复 junction `(647,542)`、market `(682,624)`、challenge `(728,725)`。
- 普通支线节点补齐独立 0.8 px 外环，分支色降低饱和度；主干保留 1.45 px 亮芯、低透明线光与离散星点，不再让所有节点共享相同强度的霓虹圆盘。
- 右栏 tabs/区块标题/正文分别提升到 16/18/14 px；小屏通过局部字号与间距规则收敛，不使用整面板 `transform: scale()`。
- 最终生产页保持同源资源请求；视觉入口未加载 Supabase、LLM 或 Devin 运行时。

## 2026-08-15 — B2 Visual Reconstruction

### Reference decomposition

- 参考图为约 1598×1024 的暗色桌面界面，视觉中心不是传统卡片图，而是一条从左下向右缓升的蓝色时间主脊。
- 页面使用四层结构：星尘背景、图关系层、节点/标签层、浮动 Dock/导航层。浮窗均为半透明深蓝灰，细描边、轻阴影和背景模糊。
- 左侧约 58 px 的垂直工具栏；顶部左侧是品牌和主题；顶部中央是房间成员 Presence 条；右上是搜索、筛选和全屏。
- 主图包含蓝色主脊与紫、青、绿、橙等分支。节点使用多层 glow、亮芯、填充环、作者身份环和选择环，不能用普通 React Flow 矩形卡片替代。
- 右上为紧凑 Devin Dock，右下为较大的三路 LLM 共享生成 Dock；中央偏左有节点详情/证据 Dock；左下有视觉编码图例；底部中央有画布工具栏。
- “候选轮次 B-1”使用白色空心星、虚线连接和尾迹；未解决问题使用紫色问号环。
- 整体信息密度高，但层级由亮度控制：星图最亮，正文次之，辅助线和背景最暗。

### Implementation decisions

- 第一版采用独立视觉 fixture，而不是改造真实房间数据模型。
- 优先在 Relay Web 内实现，避免 Desktop Tauri 和本地分析流程被视觉试验影响。
- 星图可使用 SVG 作为确定性视觉层；交互只保留选择、Dock 折叠和缩放提示，不接真实持久化。
- 参考图中的成员头像若无批准素材，使用确定性渐变头像和首字母，保持构图而不引入外部图片依赖。
- 静态演示不伪造实时能力：所有“正在生成/运行中”状态必须明确属于视觉样例。
- B2 使用根路径 <code>/?demo=b2</code>，且只在没有 room 与 invite 参数时生效；视觉组件按需加载，live Relay 保持原入口和启动体积边界。

### Verified visual slice

- 最终 1598×1024 页面已对齐参考图的左上品牌起点、短侧栏、蓝色时间主脊、四色分支、候选星、节点详情、Devin Dock 与 395 px 高的 LLM Dock。
- 1280×800 使用压缩间距与自适应宽度，不再整体缩小 Inspector、LLM 或图例正文；关键操作和文字保持可读。
- 无标签的小叶星被视为装饰，不进入键盘 Tab 顺序；节点详情的证据/来源标签可本地切换。
- 生产 HAR 只包含本地页面及同源 JS/CSS，未加载 Supabase 动态 chunk，也未出现 LLM/Devin 请求。
- 五个 Relay workspace 的 TypeScript 检查、148 项测试、production build、边界扫描和 diff check 均通过。

### 2026-08-16 B2 canonical rebuild receipt

- 唯一 canonical reference 已锁定为 1586×992、SHA-256 `f83d824d4e282440f0d3677bd438cf1b129c87cec4fd0e13bac6aca5f19a1a97`；旧图仅作为 exploration artifact 保留。
- 最新实现采用本地 WebP 星云纹理、固定 seed 的 DPR-aware Canvas 星尘、SVG 图谱/节点/路径与 DOM 面板的混合渲染；无 Supabase、LLM、Devin 或跨域请求。
- 五次 canonical 截图字节完全一致；1280×800 无横向溢出，键盘选择、工作台 tabs 和本地缩放仍可操作。
- 最终量化校准后的严格指标为 full SSIM `0.7081`、weighted blurred ROI `0.8150`、main-spine corridor IoU `0.7236`；Workbench/Devin blurred ROI 分别达到 `0.8295/0.8277`。仍未达到计划中的 `0.88/0.90/0.90` 门槛，不能宣称数值验收完成。
- 外框和中心线几何已经接近母版；剩余像素差主要来自无法从单张 PNG 反推出的原始中文字体/抗锯齿、星云素材与混合方式、头像和光学滤镜参数。

### 2026-08-16 Halo material audit

- 当前廉价感来自 `r48` 高不透明 radial halo、`r10.5` 暗边 core、`r15.5` 高饱和蓝 ring、`r6` 实心白圆和双重 drop-shadow 的完全同心组合；它构成的是霓虹按钮，而不是连续能量场。
- 母版 Source 白核在 `r≈4.75` 后连续羽化，能量壳峰位于 `r≈11.8–13.2`、亮度 `215–245`；当前壳峰约 `r=15.2/L=125`，中间还有暗 moat。
- 母版在 `r18–24` 的空气光比当前强约 15–20%，并有延伸至约 40px 的极弱纵向衍射；路径进入核心后会被洗白降饱和，而当前路径像穿过圆形徽章。
- 锁定混合路线：预烘焙透明 PNG 只负责远场空气光/色散/衍射，SVG 保留路径、薄壳、羽化白核、selection 和交互；先通过 Halo Lab 再替换全图，静态材质批准后才做循环动效。

### 2026-08-16 Halo Lab verified result

- `/?demo=b2&haloLab=1` 已成为独立确定性入口；room、`?room` 与 `#invite` 仍优先进入真实 Relay。实验室只展示静态 Source/Root/Team/Question/Candidate 材质，不接 Supabase、LLM、Devin 或外部网络。
- 14 张 DPR2 透明空气光资产由固定 seed Chromium 生成并锁定：压缩总量 `608,496 B`，解码预算 `2,557,952 B`，外缘 8px alpha 全为 0，连续 5 次 `--check` 字节一致。
- Source 目标档最终测量：白核 `77/70px`、最大边缘坡度 `31.28 L/px`、壳峰 `r=12.25/L=199.98/S=.342`、moat 最低 `141.53L`、外晕 `60.77L`、向外蓝移 `+5.19°`、近/远衍射 `14.87/3.61L`、路径融合 `176.67L/.367S`。
- Source masked blurred SSIM 为 `0.94296`，DPR2 下采样一致性为 `0.99944`；DPR1/DPR2 各 5 次截图 hash 完全一致。
- 原计划的白核下限 `83px` 无法由母版诚实复现：canonical 在 Rec.709 `L>245 && chroma<30` 下只有 `77px`。验收保持公式不变，将区间修正为 `75–92px`；没有使用 max-channel 代替 luminance。
- 完整 `/?demo=b2` 尚未替换，严格全页指标仍精确保持 `0.708060953 / 0.815033023 / 0.723619910`，证明 Halo Lab 没有暗中改变现有画面。

### 2026-08-16 Full B2 halo integration

- 用户批准 Halo Lab 后，完整 B2 已按 `PathAtmosphere → StarAura → PathCore → PathParticles → StarBody → StarOverlay` 分层替换；20 个节点均使用目标能量档，19 个普通星体显式绑定确定性纹理，Devin 保持无纹理银灰菱形。
- 旧 halo/ring/core/question/selection 及 energy `!important` 规则已移除；MiniMap 仍使用独立简化亮芯，未缩放完整光晕。字体、背景和 14 张 halo 解码完成前不会设置 `data-b2-ready=true`。
- 相对替换前，Full SSIM `0.708061 → 0.712888`，weighted blurred ROI `0.815033 → 0.823585`，main-spine IoU `0.723620 → 0.765678`，六个非 Root Source 光晕平均 blurred SSIM `0.779921 → 0.812910`（`+0.032990`）。

## 2026-08-13 — 对话日历 v1

### Verified Baseline
- Raw Codex rollout 的顶层 RFC3339 `timestamp` 可以为过滤后的可见 `response_item.message` 提供真实活动时间；当前 importer 会保留文字与 event index，但尚未保存时间或 raw turn ID。
- 两个已验证样本的最后可见活动东京时间分别为 `2026-08-08 20:50:14` 与 `2026-08-07 15:43:08`；它们的文件尾还有更晚的工具记录，因此文件尾时间不能作为日历时间。
- Header-gated flat visible export 没有逐消息时间；`exported_on` 只是导出时间，必须保持 undated。
- 当前本机有约 495 个 active/archived rollout，总量远超逐文件完整扫描适合的启动成本；索引应读取身份/标题头部与可见消息尾部，并以文件签名缓存未变文件。
- `conversations.created_at` 是导入时钟；现有日历若复用它会把历史对话错误放到导入日。
- 现有数据库含同一 raw source/hash 的重复导入，日历层需要以 session/version 规范化但不能删除旧 snapshot、correction 或 layout。

### Implementation Boundaries
- 时间字段以 UTC 持久化，界面统一按 `Asia/Tokyo` 分日与定位。
- `lastActivityAt` 包括 user、assistant commentary/final 和操作型用户消息；`lastCompletedTurnAt` 只认 assistant final。
- 自动索引只在 macOS 注册/启用；Windows 仍须通过编译与前端回归。
- 大文件预览必须逐行读取；解析器仍只分配可见文本，并忽略 reasoning、tool、event 与附件正文。
- 月/周浏览状态不能触碰图谱节点、pin、viewport 或纠正状态。

### Calendar v1 Verified Results
- 两个真实 raw rollout 的最后可见活动 UTC 精确为 `2026-08-08T11:50:14.446Z` 与 `2026-08-07T06:43:08.312Z`，东京显示满足计划；flat visible export 保持 undated。
- 流式解析采用元数据首遍与仅可见正文二次读取，字段顺序不影响结果；大型 developer/tool/reasoning/隐藏 flat 文本不会进入正文分配。
- 直接构造的 51 MiB 稀疏 rollout 已通过完整预览：仅两条可见消息进入结果，隐藏 developer 大字段被跳过，同时生成完整文件 SHA-256。
- 当前真实 Codex home 的零模型串行 smoke：511 个 rollout，508 个可见会话，3 个跳过，0 个 partial，223.70 秒；正在写入的 active rollout 不再使整批失败。
- Native app 完成首次索引后，2026 年 8 月视图显示 402 段有日期对话与 5 段日期未知记录；浏览和索引未触发模型或网络请求。
- Release DMG 已只读挂载并直接启动；重启后立即恢复缓存日历。加入直接大文件回归后的最终内部包 SHA-256 为 `b51f07aa045c2bfac03430bc762d98f37ac23b435f834023b39f5d1c136585e3`。
- 日历当前版本始终指向最新不可变源版本；旧成功快照不会掩盖新版本的未分析/失败状态，历史版本仍可单独打开。
- 三个分析入口都先按 conversation ID 隔离全局进度事件，再匹配 run ID，避免并行会话误关闭当前流程。

## Requirements
- The Windows handoff must be a single ZIP with all source, Git history, scripts, fixtures, and an explicit Markdown operating guide for Windows Codex.
- The ZIP must exclude build caches, databases, logs, environment files, credentials, and machine-specific Git remotes.
- Windows 11 x64 internal NSIS build, current-user installation, unsigned for internal use.
- Windows supports OpenAI API only; macOS Codex support must remain unchanged.
- SQLite uses LocalAppData and Windows API keys use local-only Credential Manager persistence.
- No real API key is available, so full analysis is verified through a localhost-only test harness.
- No save-for-later workflow, data migration, Windows Codex, signing, updater, MSI, ARM64, or public distribution.

## Research Findings
- The clean transfer boundary is the committed repository plus the new handoff guide. The repository has no configured remote or tracked symlink; the only tracked environment-style file is the non-secret `.env.example`.
- Large tracked assets are limited to expected icons, lock files, generated Tauri schemas, and the approved Darwin visual baseline; ignored `node_modules`, `dist`, Rust `target`, and test output must not enter the ZIP.
- Independent transfer audit found that ordinary local clones copied unreachable Git objects; the staging copy must use `git clone --no-local`, remove `origin`, and pass a zero-output unreachable-object check.
- The original Windows scripts needed stronger handoff gates: an ASCII-only screenshot selector for Windows PowerShell compatibility, committed/clean baseline enforcement, a human-usable slow delay, two launches before credential cleanup, and a Windows release test-hook scan.
- The portable clone uses `--no-local`, has no `origin`, carries a repository-only neutral Git identity, and has no unreachable objects. This preserves useful committed history without copying local-clone garbage or a machine-specific remote.
- ZIP validation must cover both archive entries and a fresh extraction. The verified layout has exactly one top-level `dialogue-atlas` repository and retains the expected clean Git state after extraction.
- The current directory is not a Git repository, so the current source tree must be captured as a local baseline before broad edits.
- Prior repository inspection found the OpenAI, SQLite, React Flow, ELK, import, and analysis layers platform-neutral; the Codex runner is macOS-specific.
- Current Tauri `app_data_dir()` maps to roaming data on Windows; `app_local_data_dir()` is the required LocalAppData boundary.
- `keyring::Entry::new` uses Windows Credential Manager but defaults to Enterprise persistence; strict local persistence requires the Windows store modifier `persistence=Local`.
- The present environment is Apple Silicon macOS; Windows native build/install evidence must remain a separate acceptance gate.
- Existing `.gitignore` already excludes `node_modules`, frontend/Rust build output, Playwright artifacts, SQLite files, and `.env*` secrets; `*.tsbuildinfo` was added before the baseline.
- The staged baseline contains 137 source/config/fixture/icon files and no discovered database, log, credential, or non-example environment file.
- `OpenAiClient` already honors a process-local `OPENAI_BASE_URL`, sends `store:false` and `background:false`, and exposes `/models` plus strict `/responses`; this is the clean test seam for a localhost mock with no production toggle.
- Existing OpenAI tests already cover request privacy flags and in-flight cancellation, but there is no reusable server that supplies deterministic segmentation/relations/modes for a native smoke run.
- README and `.env.example` are currently macOS-specific and must be updated only after capability/storage behavior is implemented and verified.
- Backend capabilities, provider rejection, macOS-arm64 Codex compile gates, stale-setting repair, historical provenance preservation, and LocalAppData path are implemented with 57 passing Rust tests.
- Windows Credential Manager now uses direct `Store::build` with exact `persistence=Local`, serializes access, and fail-closes on missing or mismatched persistence; NSIS overlay and target-specific Cargo dependencies are implemented.
- A macOS-hosted full Windows target check reaches third-party `ring` and then fails for missing MSVC `assert.h`; this confirms the remaining blocker is the absent Windows SDK, not a sufficient Windows build result.
- Manual integration review confirmed backend capability JSON, provider rejection ordering, historical provenance, and compile gates match the approved contract. The credential wrapper needed an explicit serialized delete method, and the Windows overlay needed its schema marker; both were added during integration.
- Frontend integration review found two small contract gaps: a forged Windows capability list could still expose Codex, and the shortcut rendered `Ctrl K` rather than `Ctrl+K`. Normalization now strips Codex on every non-macOS platform and the exact shortcut copy is fixed.
- Production-source search finds no mock server, scenario, or dummy-key reference under `src`; the only production seam is the pre-existing `OPENAI_BASE_URL` override in the Rust HTTP client. Final bundle scanning is still required.
- Native Windows credential persistence needed a test that exercises the real OS store rather than only validating modifiers. A Windows-only ignored smoke now writes a unique dummy entry, checks `Local`, reads it, removes it, and is invoked explicitly by the Windows build script.
- PowerShell is not installed on the macOS host, so script parsing/execution remains part of the mandatory Windows-host receipt.
- Final Rust audit found that a failed post-write persistence check could leave the just-written credential behind and that the backend success message still named macOS Keychain. Failed verification now best-effort deletes the credential before returning the original error, and success copy derives from platform capabilities.
- Final front/security audit found four material gaps: release builds trusted arbitrary `OPENAI_BASE_URL`, second-instance focus was not implemented, deeper fixture UI still said AI inference, and Windows Playwright had no reviewed win32 baseline. Release now fixes the official endpoint, debug accepts only explicit loopback `/v1`; single-instance focuses `main`; fixture copy is source-aware; and Windows build fails with an explicit baseline-capture workflow instead of silently approving one.
- Windows mock smoke uses a constrained debug-only credential account with target format `{account}.com.visiontale.dialogueatlas`, then deletes it and removes stdout/stderr metadata on exit.
- Debug and release Rust suites both pass after the endpoint/cfg hardening; this specifically covers the release-test combination that originally could have omitted the debug URL validator.
- No Parallels, UTM, VMware, VirtualBox executable, or local Windows VM bundle was found on this host, so native Windows screenshot/NSIS/Credential Manager validation cannot be completed locally.
- The final macOS release rebuild contains no mock-server name, dummy key, debug endpoint override, or debug credential-account override; its unsigned DMG hash is `cc97e201e2e9114aef987fc70b3228e1aa07ca6742c397ee48074c022fcd674a`.
- Independent final Rust/security review found no remaining P0/P1 in the current diff. A Windows installer is still not a delivered artifact until the Windows-only visual, build, Credential Manager, install, scaling, and persistence gates pass.
- Independent frontend/packaging review also found no remaining P0/P1 after fixture correction, restore, toast, and mode-detail copy became source-aware and the 11-test browser suite passed.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Embed platform capabilities in `AnalysisSettings` | Reuses the existing settings IPC and makes backend support authoritative |
| Compile-gate the whole macOS Codex implementation | Avoids fragile per-function Windows conditionals and prevents unsupported code from entering the Windows binary |
| Keep localhost mock in tests only | Exercises the real HTTP/analysis pipeline without shipping fake analysis behavior |
| Preserve raw/clean JSONL import contracts | Existing privacy boundary excludes tools, attachments, and hidden reasoning |
| Implement the mock as a standalone Node test helper plus contract test | It can be launched beside the native app on Windows, uses no new production dependency, and is excluded from Tauri `frontendDist` |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| No Git history for distinguishing pre-existing edits | Treat the entire current tree as user-owned baseline; initialize local history before implementation edits |
| Windows MSVC target cannot fully compile on the Mac host | Keep the native Windows build/install checklist mandatory and do not claim completion from cross-checks |
| No reviewed Windows Playwright baseline exists on this Mac | Added a Windows-only capture-and-review script; the release build refuses to proceed until the win32 PNG is committed |

## Resources
- `/Users/visiontale7/Desktop/workshop/dialogue-atlas`
- Tauri Windows prerequisites: https://v2.tauri.app/start/prerequisites/
- Tauri Windows installer: https://v2.tauri.app/distribute/windows-installer/
- Windows Credential persistence: https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentiala

## Visual/Browser Findings
- The existing graph UI has a browser-demo B5 snapshot; on Windows it must be labeled as example data rather than an active Codex result.
- The updated 1536×1024 Darwin baseline visibly shows `固定示例图谱 · 未运行分析`, `B5 固定示例对话`, and `示例标注`; graph geometry, evidence panel, toolbar, mode islands, and legend remain intact with no obvious clipping or overlap regression.

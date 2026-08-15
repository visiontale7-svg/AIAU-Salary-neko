# Dialogue Atlas「环绕式共创星图 B2」完整视觉与交互方案

> 状态：视觉方向已确认，可进入交互原型与工程实施  
> 日期：2026-08-15  
> 视觉基准：B2「环绕式共创星图」

> B2 视觉基准图暂未随本文公开；本文以其为唯一主方向。

## 1. 方案总结

本方案以用户确认的 B2 图为唯一主方向，将 Dialogue Atlas Relay 定义为：

> 一个房间内，人、LLM 与 Devin 共同生长一张可追溯的时间—语义星图。

### 1.1 已锁定的产品决策

- [REQ] 全屏星图是第一层界面，不保留永久右侧栏。
- [REQ] LLM 对话位于右下角可折叠浮动 Dock，并向房间成员共享完整对话。
- [REQ] 最多允许三位成员并行提交问题并生成回答。
- [REQ] 一条用户消息加对应的完整 LLM 回答构成一轮，只生成一颗星，不把回答拆成多颗星。
- [REQ] 新一轮完成后先成为暗淡的候选星，排布成功后自动转为正式星。
- [REQ] 主脊严格遵循服务器时间与事件顺序，AI 不得重排历史。
- [REQ] 星体颜色只表示语义分支；作者身份通过外环、头像缺口和短暂轨迹表示。
- [REQ] 新星出现在当前视野外时不移动镜头，只显示方向提示与“新增 N 颗”。
- [REQ] Devin 的结论、产物和 Pull Request 自动成为正式执行分支；普通运行日志不生成星。
- [REQ] Devin 动画只由真实事件或心跳触发；无事件时停止动画。
- [REQ] 节点详情、证据、LLM 对话和 Devin 状态均使用可折叠浮动 Dock。
- [ASSUMPTION] 桌面端最低设计尺寸为 1280×800；移动端首版只支持浏览、评论和立场表达。

## 2. 统一视觉语言

### 2.1 视觉通道只表达一种含义

| 视觉通道 | 唯一含义 |
|---|---|
| 水平位置 | 服务器时间与事件顺序 |
| 垂直位置 | 语义分支和并行轮次 |
| 星体大小 | 结构重要性 |
| 星体色相 | 语义分支 |
| 中心图标 | 来源或对象类型 |
| 填充方式 | 生命周期状态 |
| 静态外环 | 发起者身份 |
| 动态头像弧 | 当前查看、编辑或拖动者 |
| 最外层白环 | 当前用户选择 |
| 连线形态与端点 | 关系类型 |
| 亮度 | 当前注意力 |
| 动效 | 新近事件、实时协作或异步执行 |

模式或主题区域使用半透明区域和标签表示，不重新给节点着色，避免与语义分支颜色冲突。

### 2.2 颜色系统

| 用途 | 色值 |
|---|---|
| 主脊 | <code>#65A7FF</code> |
| 分支一 | <code>#9B7CFF</code> |
| 分支二 | <code>#46D7D1</code> |
| 分支三 | <code>#A7DC70</code> |
| 分支四 | <code>#F2A94D</code> |
| 分支五 | <code>#E879A7</code> |
| 当前选择 | 白色 |
| 警告、等待输入 | 琥珀色 |
| 错误 | <code>#FF6B6B</code> |
| 离线、过期、归档 | 中性灰 |

红色不用于普通“质疑”关系，以免将合理争议误读为系统错误。

### 2.3 星体尺寸

| 类型 | 建议直径 |
|---|---:|
| 根节点 | 44 px |
| 主脊关键节点 | 32 px |
| 普通轮次节点 | 22 px |
| 候选星 | 20 px，空心 |
| 未解决问题 | 20 px，中心为问号 |
| Devin 节点 | 22 px，中心为机器人图标 |
| 产物或 PR | 20 px，中心为文件或分支图标 |
| 聚合节点 | 28 px，中心显示数量 |

缩放低于 70% 时隐藏正文；低于 45% 时合并为聚合星，避免视觉噪声。

### 2.4 多用户身份表示

    interface MemberVisualIdentity {
      userId: string;
      colorSeed: number;
      ringPattern: "solid" | "dash" | "dot" | "double";
      avatarUrl?: string;
      initials: string;
    }

规则：

- 一轮对话归属于发起该问题的成员。
- 语义分支颜色保持不变，不随作者变化。
- 作者通过静态身份外环、头像缺口和短轨迹表示。
- 正在查看的成员以头像弧显示在节点外侧。
- 正在编辑时只播放一次往返提示，不持续闪烁。
- 拖动中的远程节点显示带姓名的半透明幽灵位置。
- 同一节点超过三位成员时显示“+N”。
- 成员离线后，临时 Presence 弧消失，但作者身份外环永久保留。
- 图标位于星体中心，层级顺序固定为：
  星核 → 生命周期填充 → 作者外环 → Presence 弧 → 当前选择白环。

## 3. 页面结构与浮动 Dock

### 3.1 全屏星图

页面由以下部分构成：

- 左侧窄导航栏；
- 顶部房间标题、在线成员、搜索与视图切换；
- 中央时间主脊和语义分支；
- 左下角图例；
- 底部缩放、适配、聚焦与个人跟随控制；
- 右上角视野外新星提示；
- 按需出现的节点、LLM 和 Devin 浮动 Dock。

共享的是正式图布局；个人独立保存视口、缩放、过滤和聚焦状态。房主跟随必须由成员主动开启，不能默认夺取成员视角。

### 3.2 LLM 对话 Dock

LLM Dock 固定在右下角，支持折叠和展开，包含：

- 房间共享提示；
- 当前模型与状态；
- 最多三条并行生成通道；
- 每条通道的发起者、提交时间、问题、流式回答和运行状态；
- 候选星生成状态；
- 当前用户自己的停止按钮；
- 已完成轮次历史入口。

并行规则：

- [ASSUMPTION] 每个房间最多三条活跃 LLM 运行，第四条进入队列。
- 用户提交时即由服务器分配顺序号。
- 同一时间窗口内的 A、B、C 三轮共享一个时间锚点，在垂直方向扇出。
- 所有房间成员都能看到问题和完整回答。
- 输入区必须明确提示：“该内容将对房间成员可见。”

### 3.3 节点详情 Dock

同一时刻只打开一个节点详情 Dock，优先贴近选中节点或画布边缘，内容包括：

- 标题；
- 发起者；
- 提交、完成和正式落位时间；
- 用户问题；
- 完整 LLM 回答；
- 所属分支；
- 上下游关系；
- 证据；
- 成员立场；
- 提案和评论；
- 来源、版本和审计信息。

Dock 之间必须具备避让规则，不能覆盖彼此的主要操作按钮。

### 3.4 Devin Dock

Devin Dock 靠近执行分支或右上区域，包含：

- 当前任务；
- 关联的团队决定；
- 最近一次心跳或真实事件；
- 已确认状态；
- Devin Session 链接；
- PR 与检查状态；
- 里程碑；
- 可折叠事件日志；
- 房主可用的补充消息、停止和重试操作。

## 4. 新对话生成星体

### 4.1 状态机

    draft
      → submitted
      → queued | generating
      → response_complete
      → candidate
      → placing
      → formal

异常分支：

    generating
      → slow
      → possible_interruption
      → retry | cancel

    placing
      → placement_failed
      → candidate_queue
      → automatic_retry_once
      → manual_attach | abandon

### 4.2 动画顺序

1. 用户提交问题，LLM Dock 中出现一条生成通道。
2. 流式输出期间不生成正式节点。
3. 回答结束后，在对应分支边缘生成一颗暗淡空心候选星。
4. 候选星与预计父节点之间出现虚线“引力绳”。
5. 系统在约 650 ms 内完成自动排布。
6. 排布成功后星体填充、关系线变为正式线。
7. 星体只进行一次柔和绽放。
8. 若新星位于当前视野外，仅显示方向提示与新增数量，不移动镜头。

开启 Reduced Motion 时，以上过程改为静态状态切换。

### 4.3 一轮一星数据结构

    interface RoomRoundStar {
      id: string;
      roomId: string;
      initiatorId: string;
      serverSeq: number;
      promptId: string;
      responseId: string;
      label: string;
      branchId: string;
      parentId?: string;
      primary: boolean;
      relationType?: string;
      state:
        | "streaming"
        | "candidate"
        | "placing"
        | "placed"
        | "failed"
        | "cancelled";
      submittedAt: string;
      completedAt?: string;
      placedAt?: string;
    }

规则：

- 再长的回答也只生成一颗星，完整内容在详情 Dock 中查看。
- 内容相似但时间不同的轮次保持独立，可建立“重复”或“重新打开”关系。
- 失败或取消的运行不进入正式星图。
- 主要轮次位于蓝色主脊；其他轮次按语义进入分支。
- 用户可以更改分支和“主要轮次”属性，但不能改变服务器事件顺序。

### 4.4 镜头规则

- 新星出现时不自动平移或缩放。
- 右上角显示方向箭头和“新增 N 颗”。
- 点击提示后才平滑移动到新星。
- 提供个人级“跟随新星”开关。
- 远程选择只产生一次轻微脉冲。
- 用户正在阅读详情、输入或拖动时，任何远程事件都不能夺取镜头。

## 5. Devin 的视觉与状态

### 5.1 哪些 Devin 事件生成正式星

只有以下三类事件自动生成执行分支节点：

1. 结论；
2. 产物；
3. Pull Request。

普通计划、过程消息、工具日志和轮询结果只保留在 Devin Dock。

Devin 节点表示正式执行记录，不等于团队已经认可。节点永久保留机器人来源；房主接受后增加“人类确认”印记；被拒绝时转为灰色，但不删除历史。

### 5.2 新鲜度数据

    interface DevinFreshness {
      lastPollSucceededAt?: string;
      lastProviderEventAt?: string;
      staleSince?: string;
      retryAfterAt?: string;
      statusSource: "provider" | "cache" | "unknown";
    }

### 5.3 Devin 状态表现

| 状态 | 视觉表现 |
|---|---|
| 未配置 | 灰色机器人和锁 |
| 正在创建 | 细环旋转 |
| 排队 | 静态时钟 |
| 收到心跳 | 单次脉冲 |
| 收到真实事件 | 单次脉冲加一颗粒子 |
| 轮询正常但 2 分钟无事件 | 静止，文字显示“运行中，2 分钟无新事件” |
| 30 秒未能轮询 | 降低饱和度，显示“状态更新延迟” |
| 120 秒未能轮询 | 灰色断环，显示“可能中断” |
| 429 限流 | 琥珀色时钟，显示下次重试时间 |
| 等待输入 | 琥珀色暂停 |
| 正在停止 | 琥珀色分段环 |
| 已完成 | 一次绿色绽放，随后静止 |
| 失败 | 一次红色闪烁，随后静止 |
| 阻塞或结果未知 | 灰橙断环，不自动盲目重试 |

禁止使用没有真实事件支撑的呼吸灯、虚假百分比或持续粒子动画。

## 6. 关系、问题与同步状态

### 6.1 关系语法

| 关系 | 线形与端点 |
|---|---|
| 时间顺序 | 蓝色实线加箭头 |
| 语义子分支 | 分支色实线 |
| 支持 | 虚线加“+”端点 |
| 质疑 | 虚线加“!”端点 |
| 修正 | 点划线加回转端点 |
| 证据 | 点线加引号端点 |
| 依赖 | 链条端点 |
| 未解决 | 低透明点线加问号 |
| Devin 执行 | 双线加机器人端点 |

每种关系同时通过类型、端点和标签表达，不能只依赖颜色。

### 6.2 未解决问题生命周期

    system_suggested
      → confirmed_open
      → assigned
      → waiting_evidence | blocked
      → resolved | rejected
      → reopened

未解决问题使用问号星核；只有高优先级问题才增加红色徽标。

### 6.3 同步与冲突

| 状态 | 表现 |
|---|---|
| 正在保存 | 小型同步徽标 |
| 已同步 | 徽标淡出 |
| 离线 | 云朵斜线；保留未提交表单 |
| 远程更新 | 单次蓝色脉冲 |
| CAS 冲突 | 分裂外环并打开差异比较 Dock |
| 权限不足 | 锁图标和明确原因 |

禁止无提示的 last-write-wins。

## 7. 数据与接口

### 7.1 版本策略

- Relay v1 房间保持只读兼容。
- 新建动态共创房间使用 <code>relay-v2</code>。
- 本地原始 JSONL 和未经批准的历史内容不得自动上传。

### 7.2 新增核心对象

- <code>room_messages</code>
- <code>room_llm_runs</code>
- <code>room_round_stars</code>
- <code>semantic_branches</code>
- <code>member_visual_identities</code>
- <code>devin_milestones</code>

### 7.3 命令接口

    submit_room_prompt(roomId, body, clientMutationId)
    cancel_room_llm_run(roomId, runId)
    list_room_messages(roomId, afterSeq?)
    retry_round_placement(roundId)
    move_round_to_branch(roundId, branchId, expectedRevision)
    set_round_primary(roundId, primary, expectedRevision)

### 7.4 Realtime 事件

    room_prompt_submitted
    llm_run_started
    llm_chunk
    llm_run_completed
    round_candidate_created
    round_placed
    round_placement_failed
    devin_heartbeat
    devin_milestone_created
    member_focus
    member_drag_preview

### 7.5 持久化原则

- Postgres 保存最终消息、轮次、星体、布局和 Devin 里程碑。
- Broadcast 只承载流式片段、光标、拖动预览和临时提示。
- Presence 只承载在线成员、当前查看版本和低风险瞬时状态。
- 持久写入必须经过 RPC、RLS、CAS 和 <code>clientMutationId</code>。
- 服务器分配事件顺序和 UTC 时间；界面以 Asia/Tokyo 显示。
- 房间内共享对话属于云端协作内容；本地原始对话仍遵守发布审批边界。

## 8. 工程实现方向

不重写已经成立的 Supabase、RLS、Relay Controller 与 Devin 接入边界。实施重点是：

1. 把桌面端 React Flow 的成熟图能力抽取到无数据源副作用的 <code>atlas-graph</code>。
2. 用共享渲染器替换 Relay 当前的简化 SVG 图。
3. 保持 React Flow 路线，首版默认可见节点不超过 120，不引入 WebGL。
4. 将界面状态拆为：
   - 持久图数据；
   - 瞬时协作状态；
   - 浮动 Dock 状态；
   - 个人视口状态。
5. 本地拖动保持 60 fps；远程拖动预览限频到约 10–15 Hz；只在 drag stop 时持久化。
6. Broadcast 只负责体验，不参与权限和事实判断；所有正式状态以数据库和 RLS 为准。

## 9. 验收矩阵

| ID | 验收内容 |
|---|---|
| PB-001 / VP-001 | 三位成员可并行提交 LLM 请求，服务器顺序确定且互不串线 |
| PB-002 | 一条用户消息加完整回答只生成一颗星 |
| PB-003 | 候选星与正式星具备明确两阶段状态 |
| PB-004 | 主脊严格遵循服务器时间，不允许 AI 重排 |
| PB-005 | 语义色与作者身份可同时辨识 |
| PB-006 | 新星和远程操作不会自动移动用户镜头 |
| PB-007 | Devin 动效只来自真实状态、事件或心跳 |
| PB-008 | 只有结论、产物和 PR 自动生成 Devin 正式星 |
| PB-009 | 节点、LLM 和 Devin Dock 不遮挡主要操作 |
| PB-010 | 重连按事件序列补读，不产生重复星体 |
| PB-011 | 并发修改通过 revision CAS 暴露冲突 |
| PB-012 | 键盘、屏幕阅读器、Reduced Motion 与非颜色编码通过 |

### 9.1 必测场景

1. 三位成员同时提交，其中一条失败、两条成功。
2. 自动排布超时，候选星保留并可恢复。
3. 用户查看证据时，远程新星出现但镜头不移动。
4. 两人同时拖动同一节点，幽灵位置可区分且 CAS 冲突被明确显示。
5. Devin 工作中，两分钟无新事件但轮询正常。
6. Devin 轮询中断 120 秒后恢复。
7. Devin 连续产生普通日志、结论、产物和 PR，只有后三类生成星。
8. 非房主尝试停止 Devin 或关闭房间，被 RLS 拒绝。
9. 断网后重连，按 sequence 恢复且不重复。
10. Reduced Motion 模式下不使用连续动画。
11. 在 1280×800、1536×1024 和 Retina 屏幕检查完整布局。
12. 在 120 个可见节点、5 位在线成员和3条并行流式回答下检查性能。

## 10. 建议实施顺序

### Vertical Slice 1：共享渲染基础

- 抽取 React Flow 图组件；
- 实现主脊、分支、星体和关系视觉；
- 建立缩放层级和聚合节点。

### Vertical Slice 2：Presence 与身份

- 成员视觉身份；
- 节点查看、编辑和拖动状态；
- 新星方向提示与个人跟随。

### Vertical Slice 3：共享 LLM 与候选星

- 房间共享对话；
- 三路并行；
- 一轮一星；
- 候选星自动落位与失败恢复。

### Vertical Slice 4：Devin 映射与新鲜度

- 真实状态和心跳；
- 结论、产物和 PR 里程碑；
- 诚实的静默、延迟和中断表现。

### Vertical Slice 5：聚焦与辅助视图

- 时间流视图；
- 模式区域；
- 关系高亮；
- 未解决问题视图；
- 小地图和节点详情。

### Vertical Slice 6：稳定性与无障碍

- 重连；
- CAS 冲突；
- 离线草稿；
- Reduced Motion；
- 键盘和屏幕阅读器；
- 性能压力测试。

最小端到端演示应优先打通：

> 成员提交问题 → 完整 LLM 回答 → 候选星 → 自动落位 → 另一成员查看与质疑 → 房主确认行动 → Devin 产生真实执行里程碑。

## 11. 固定边界

- 不做自由画笔、通用模板市场或完整 Miro 替代品。
- 不做字符级多人富文本 CRDT。
- 不上传原始 JSONL 或未经批准的完整本地历史。
- 不允许 AI 改写或重排已经发生的时间历史。
- Devin “完成”不等于团队认可。
- 任何重要语义都不能只靠颜色表达。
- 不使用没有真实事件支撑的持续动画。
- Relay v1 继续可读；新的动态共创能力进入 Relay v2。
- 本文引用的视觉方向、需求 ID 与验收矩阵是后续实现和视觉验收的基准。

## 附录 A：视觉探索来源

本方案由三条初步方向和一次 B2 收敛产生：

- 方向 A：时间主脊生长
- 方向 B：多人协作环绕
- 方向 C：静谧宇宙档案
- B2：环绕式共创星图，作为最终主方向

最终参考图：

- B2 视觉基准图：本地设计资产，公开仓库暂未附带。


# Dialogue Atlas Relay：Supabase 本地与云端接入

## 当前边界

Supabase 在 Relay 中负责协作事实源，不负责分析本地原始对话：

- Postgres：房间、成员、不可变图版本、团队节点、立场、提案、决策、共享布局、活动序列和 Devin 回执；
- Auth：房主和访客均使用 Anonymous Auth；
- RLS：只有房间成员能读取，只有 RPC 允许的角色能写入；
- Realtime：私有 `room:<room_id>` 频道、Presence、Broadcast 和数据库活动提示；
- Edge Function：仅服务端持有 Devin 凭据并执行 owner-only 操作。

本地 JSONL、完整 transcript、未批准证据、service-role key 和 Devin key 不进入浏览器环境变量。

## 一键启动本地 Supabase

前置条件：Docker Desktop 已启动，Supabase CLI 可用。

    npm run relay:supabase:up
    npm run relay:supabase:reset
    npm run relay:supabase:test
    npm run relay:supabase:smoke

第一条命令会：

1. 启动本地 Supabase；
2. 从 `supabase status` 读取本地公开 URL 与 publishable key；
3. 更新被 Git 忽略的根目录 `.env.local`；
4. 更新被 Git 忽略的 `apps/relay-web/.env.local`；
5. 生成只允许本地 Supabase HTTP/WS 的 Tauri CSP overlay。

脚本拒绝把 secret key、service-role key、数据库密码或 Devin 凭据写入 Vite 环境。

## 启动 Web 与 macOS App

先启动访客 Web：

    npm run relay:local:web

默认地址为 `http://127.0.0.1:5173`。未携带房间 ID 或邀请 fragment 时，页面会按设计 fail closed。

另开一个终端启动 macOS 房主端：

    npm run relay:local:tauri

房主从已经分析的真实 snapshot 选择“发布协作空间”，发布后复制邀请链接；访客应使用独立浏览器上下文打开：

    http://127.0.0.1:5173/room/<room-id>#invite=<token>

兑换成功后，前端必须立即从地址栏移除邀请 token。

## RLS 验收

本地权限测试：

    npm run relay:supabase:test

测试必须覆盖：

- 14 张公开表全部启用 RLS；
- 非成员无法读取房间；
- 成员只能读取所属房间；
- 访客不能发布图版本、决定提案、关闭房间或启动 Devin；
- 来源图不可由客户端直接改写；
- team item 只能由创建者修改；
- layout 和 team item 使用 revision CAS；
- invite token 只保存 hash；
- private Realtime channel 只允许成员收发；
- provider 状态和 Devin event 只能由 service-role RPC 写入。

`relay:supabase:smoke` 还会通过真实本地 HTTP API 创建三个 Anonymous Auth
身份，验证 owner 创建房间、member 凭邀请加入、双方读取成功、非成员读取失败，
最后由 owner 关闭测试房间。测试不会输出邀请 token 或任何密钥。

不要把浏览器能成功读取一条记录当作 RLS 已通过；以 pgTAP 的 owner/member/non-member negative cases 为准。

## 连接云端项目

本地验证通过后，再绑定独立的 Supabase staging 项目：

    supabase login
    supabase projects list
    supabase link --project-ref <project-ref>
    npm run relay:supabase:configure-linked
    supabase db push --linked --dry-run
    supabase db push --linked
    supabase config push

云端必须确认：

1. Anonymous Sign-ins 已开启；
2. Site URL 与允许的 redirect URL 指向 Relay Web；
3. 8 个迁移均出现在 migration history；
4. Realtime private channel policy 已建立；
5. 前端只配置项目 URL 和 publishable key；
6. service-role key 只存在于可信服务环境；
7. `DEVIN_API_KEY`、`DEVIN_ORG_ID` 等仅配置为 Edge Function secrets；
8. 公网开放前设置 Anonymous Auth/IP 速率限制和监控。

建议先在 staging 执行真实公开 API smoke：

    npm run relay:supabase:smoke:linked

该测试以三个真实 Anonymous Auth 身份验证 owner、member、outsider 的 RLS 行为，
会创建并关闭测试房间，只应对 staging 或专门验收项目运行。

完整 pgTAP 使用数据库内部测试身份和私有 schema，固定在本地容器执行
`npm run relay:supabase:test`。托管项目的 CLI login role 无权直接写 `auth.users`
或 `relay_private`，因此不把 `supabase test db --linked` 作为云端验收命令。

`relay:supabase:configure-linked` 会从已绑定项目读取唯一的现代
`sb_publishable_...` key，并写入 Git 忽略的 `.env.production.local`。它会拒绝
legacy service-role、现代 secret key、数据库密码和 Devin 凭据，同时生成只允许
该项目 HTTPS/WSS origin 的 `tauri.relay.cloud.generated.conf.json`。

## 云端前端变量

Relay Web/Vercel 只配置：

    VITE_SUPABASE_URL=https://<project-ref>.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>

macOS App 另外配置：

    VITE_RELAY_WEB_URL=https://<relay-domain>

生产环境不得设置 `VITE_RELAY_LOCAL_INTEGRATION=1`。

## 发布前检查

    npm run typecheck:relay
    npm run test:relay
    npm run build:relay
    npm run check:relay-boundaries
    npm run relay:supabase:test
    npm run relay:supabase:smoke

完成这些本地检查仍不等于云端验收完成。最终还必须实际验证 Anonymous Auth、邀请兑换、双浏览器 Presence、断线重连、RLS 越权失败以及部署域名的 HTTPS/WSS CSP。

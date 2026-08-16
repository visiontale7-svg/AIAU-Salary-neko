# Progress Log

## Session: 2026-08-16 — B2 Functional Product Integration

- **Status:** local_collaboration_complete_live_devin_blocked
- 最终本地链路已在 10 个迁移上重新验证：pgTAP 48/48、Anonymous Auth/RLS/Realtime smoke 2/2、owner/guest 双浏览器 E2E 1/1。
- 双浏览器 E2E 真正完成邀请码兑换与 fragment 清除、2 人 Presence、团队节点创建与凝结动效、proposal 提交、房主接受及访客同步。
- Devin provider health 已独立持久化：普通失败按 5/10/20/40/60 秒退避，429 尊重 Retry-After；stale/recovered 仅在状态转换时生成一次 durable activity。
- B2 星图现在会在明确 stale 事件后保持暖灰断环，并在明确 recovered 事件后清除，不从 Relay reconnect/offline 推断状态，也不为恢复事件播放伪动画。
- Vitest 已限制只收集 `src/**/*.test.*`，避免把真实 Playwright E2E 当成单元测试载入。
- 当前真实付费 Devin 仍为 NO-GO：缺少本地 DEVIN secrets、owner entitlement、`/v3/self` 权限预检与未知创建结果的官方 tag reconciliation；本轮没有产生付费 Session。
- Live B2 camera 已完成：本地 pan、wheel/button zoom、fit all、可交互 MiniMap viewport，以及 camera 逆变换后的共享节点拖动；camera 操作不会写共享 layout 或 Broadcast。
- macOS 房主入口已从 classic `RelayRoomRuntime` 切换为与浏览器成员端相同的 `B2RoomView` + `useRelayRoomController`，旧 structured UI 只在显式回退后显示。
- Realtime controller 现在只暴露“已在线观察且经数据库刷新确认”的 durable activity；初次加载与 reconnect replay 不进入动效队列。
- `ActivityMotionMapper` 已锁定：新团队节点、Devin provider event、明确 provider-health stale；Relay offline/reconnecting 永远不推导 Devin stale。
- P0 automated publisher and local Supabase smoke passed: anonymous owner/member/outsider RLS, immutable source, idempotency, CAS conflict, private Realtime, Presence, focus, drag preview and activity replay.
- Publisher now stores only a canonical token-free room URL; the transient bearer is emitted only in `#invite=` and production accepts only `sb_publishable_` public keys.
- Added RLS-protected room member summaries with stable server-assigned `colorKey`; preserved team item `createdBy` through the effective graph projection.
- Replaced the real B2 room’s static right rail with an operational `讨论 / 节点 / 执行` workbench using existing Relay callbacks.
- Discussion now exposes proposals, durable comments, typing, owner accept/reject/defer, room seq/revision and online members without pretending to be LLM chat.
- Node workbench now supports evidence, stances, team node/edge create-edit, node/relationship proposals and local conflict drafts.
- Execution workbench now supports accepted-decision Action Brief creation, owner-only Devin start/follow-up, session URL, event log, PR/check receipts and member read-only access.
- Stable member color drives top avatars, Presence arcs and team-star author color; source nodes remain content-colored.
- Focused B2 room/workbench tests pass 8/8; all Relay workspace typechecks pass.
- Captured and visually inspected `/tmp/dialogue-atlas-b2-live-workbench.png`; the real fixture surface contains no fake LLM generating copy.
- Remaining F0 manual check: launch Tauri, publish an already analyzed snapshot, redeem the invite in a separate browser profile and confirm fragment removal plus cross-WebView Presence.

## Session: 2026-08-15 — Approved Reference Rebase

- **Status:** complete
- User correction accepted: the latest three-column screenshot is now the sole visual reference.
- Compared the approved image against the running B2 page and confirmed both layout and light-material language require a rebase, not incremental tuning.
- Locked the reusable boundary to route isolation, deterministic data and no-network verification; central layout and visual skin will be rewritten.
- Replaced the old B2 component with a three-column component tree: short labeled rail, central constellation canvas, right tabbed workbench and fixed Devin status card.
- Preserved deterministic graph data, keyboard node selection, local zoom, route guard and fixture marker; removed floating Inspector/LLM/Devin Dock state.
- Rebuilt the 64/1096/426 px desktop grid so the canvas starts at x=64 and the right panels retain the reference 10/12 px inset.
- Repositioned the source spine and cyan/orange/candidate topology against measured reference anchors; corrected `2.1` to the cyan leaf and restored the orange junction.
- Replaced saturated halo stacks with a white-hot core, thin low-saturation corona, low-opacity bloom, crisp edge core and sparse route sparks; added deterministic fine dust and a faint textured upper-right nebula.
- Raised the right workbench type scale to the approved reference while retaining compact 1280×800 overrides.
- Final screenshots: `/tmp/dialogue-atlas-b2-final-1586x992.png` and `/tmp/dialogue-atlas-b2-final-1280x800.png`.
- Focused B2 tests pass 3/3; full Relay regression passes 148/148 tests, all workspace typechecks, production build, boundary scan and `git diff --check`.

## Session: 2026-08-15 — B2 Visual Reconstruction

### Phase 1: 基线勘察与视觉拆解
- **Status:** complete
- Actions taken:
  - Re-read the approved B2 plan and inspected the original 1598×1024 reference image.
  - Locked the implementation boundary to a deterministic frontend-only visual fixture.
  - Recorded the four-layer composition, major floating panels, star grammar, and no-network requirement.
  - Error noted: the first explorer spawn combined a full-history fork with an explicit role; subsequent agents use a context-free bounded brief.
- Next:
  - Run the complete Relay typecheck/test/build/boundary regression.
  - Complete the independent visual and route-isolation audits.
- Implemented:
  - Added a namespaced B2 visual shell with deterministic SVG constellation, glass docks, local selection, collapse controls, and zoom label.
  - Added a guarded root-only <code>/?demo=b2</code> selector and lazy-loaded visual chunk.
  - Preserved existing live Relay, invite, room, Supabase, Desktop and shared graph paths.
  - Added deterministic starfield, blue time spine, semantic branches, candidate/unresolved states, member rings, evidence inspector, Devin/LLM docks, legend and canvas toolbar.
  - Generated and inspected browser screenshots at 1598×1024 and 1280×800; calibrated rail height, legend clearance, star density, root position and large-screen LLM dock spacing.
  - Focused Relay Web typecheck passed; focused Vitest now passes 19/19.
  - Final Relay regression passed: all five workspace typechecks, 148/148 tests, production build, boundary scan and `git diff --check`.
  - Production HAR contained only the local preview document and same-origin B2/main JS/CSS; the Supabase dynamic chunk, LLM and Devin endpoints were not requested.
  - Final production screenshots: `/tmp/dialogue-atlas-b2-production-1598x1024.png` and `/tmp/dialogue-atlas-b2-production-1280x800.png`.

## Session: 2026-08-13 — Dialogue Calendar v1

### Phase 1: 时间与持久化基础层
- **Status:** complete
- Actions taken:
  - Recovered the completed Windows handoff plan and established calendar v1 as the new active objective.
  - Reconfirmed the no-model/no-network boundary for index, preview, and calendar work.
  - Split implementation into temporal persistence, local indexing/commands, and frontend calendar work packages.
- Verification pending:
  - Real raw sample timestamps in Asia/Tokyo.
  - Flat/paste undated behavior.
  - Old-database migration and full regression.
- Error noted: the first Vitest invocation used unsupported `--runInBand`; TypeScript passed, and tests will be rerun with the repository-native command.
- First calendar integration test run: 13 files / 49 tests passed; the new calendar UI suite failed during import because its jsdom localStorage was not initialized. Fix delegated to the frontend work package.
- Frontend after repair: TypeScript and 14 Vitest files / 52 tests pass. Generated both macOS visual candidates and inspected them; final baseline will show a selected entry without changing ordinary startup selection.
- Approved the regenerated month/week visual baselines after inspecting both at original 1536×1024 resolution. The week frame now begins at a fully visible 08:00 and preserves selected-entry detail without hiding the morning events.
- A mid-edit Rust check intentionally caught the temporal worker before helper/query definitions landed; no integration verdict is recorded until that work package finishes.

### Calendar v1 completion receipt
- Added migration `0003_calendar_time_index.sql`, message-level occurrence time/provenance, strict calendar aggregates, immutable session+SHA versions, canonical legacy mapping, and history access.
- Added macOS startup/manual session indexing, four-file production concurrency, cancellation/progress, cache retention, source move/missing handling, and streaming preview with SHA/signature checks.
- Added fixed Tokyo month/week views, 42-cell Sunday calendar, 3+N overflow, exact-minute week anchors, 45-minute clusters, undated records, details, history versions, and atlas navigation.
- Hardened the parser against JSON key order, multi-megabyte developer/tool/reasoning rows, incomplete tails, duplicate-warning growth, active-file mutation, and forged/tampered time summaries.
- Isolated all analysis progress consumers by `conversationId` before `runId`, preventing unrelated concurrent jobs from closing the active import/calendar flow.
- Real fixtures passed with Tokyo last activity `2026-08-08 20:50:14` and `2026-08-07 15:43:08`; the flat visible export remained undated.
- Real-home zero-model smoke passed: 511 discovered, 508 visible, 3 skipped, 0 partial in 223.70 seconds serial; the production worker uses up to four concurrent files.
- Native release app launched and completed a real local index; the August month view showed 402 dated conversations and 5 undated records without a model request.
- Final DMG was mounted read-only and launched directly after the last rebuild; cached calendar data had already been verified to reappear immediately after restart. SHA-256: `b51f07aa045c2bfac03430bc762d98f37ac23b435f834023b39f5d1c136585e3`.
- Added a direct 51 MiB streaming-preview regression containing only two visible messages and large hidden developer rows; the preview completed with exactly the two visible messages and a full SHA-256.
- Final automated regression: Rust 80 passed / 6 ignored, Vitest 56/56, Playwright 13/13, TypeScript and production frontend build passed.
- Final independent contract audit reported no remaining P0/P1. Windows-native MSVC/installer validation remains an external Windows-host gate.
- The final macOS-to-Windows target attempt again stopped in third-party `ring` because this host lacks the MSVC SDK header `assert.h`; it is not Windows-native acceptance and did not expose a calendar source error.

## Session: 2026-08-11

### Phase 6: Windows Codex Transfer Package
- **Status:** complete
- Actions taken:
  - Re-read the persistent plan and confirmed the Windows-native acceptance gate remains pending.
  - Started preparing a single portable ZIP containing only committed source/history and a Windows Codex first-read guide.
  - Audited tracked and ignored content: only `.env.example` matched credential-like names; build output, dependencies, Rust target, and test artifacts remain ignored.
  - Added `WINDOWS_CODEX_HANDOFF.md` with environment setup, scope boundaries, exact scripts, mock scenarios, manual smoke checks, and a required receipt template.
  - Hardened the Windows handoff scripts after independent audit: committed/clean visual gate, ASCII-safe screenshot selector, 30-second slow response, two-launch credential persistence smoke, emergency cleanup copy, and release test-hook scanning.
  - Added a synthetic flat visible-export JSONL fixture and a Rust black-box import test for Chinese/emoji paths, attachment exclusion, phase normalization, and email redaction.
  - Created a `--no-local` staging clone, removed its origin, set a repository-only neutral Git identity, and confirmed clean status with no unreachable Git objects.
  - Built a single-root ZIP with extended macOS metadata disabled, then passed archive integrity, forbidden-path, required-file, Git ancestry, clean status, remote, identity, and unreachable-object checks after extraction.
  - Confirmed the handoff archive contains 220 entries and no `__MACOSX`, dependency directories, build output, application database/log, real `.env`, or test-result directory.

### Phase 1: Baseline & Discovery
- **Status:** complete
- **Started:** 2026-08-11
- Actions taken:
  - Read the planning-with-files instructions and templates.
  - Ran session catch-up; no unsynchronized planning context was reported.
  - Confirmed the project directory currently has no Git metadata.
  - Captured the approved Windows implementation requirements and acceptance boundaries.
  - Audited ignore rules and sensitive filenames, initialized a local Git repository, and staged the current 137-file tree as the user-owned baseline.
  - Ran the complete available pre-port baseline: TypeScript, Vitest, Rust check/tests, and Playwright all passed.
  - Added a localhost-only OpenAI acceptance server supporting success, partial, invalid-evidence, retry-on-next-run, and slow scenarios.
  - Added contract tests proving loopback binding, dummy-key authentication, UTF-16 evidence, privacy flags, and deterministic failure behavior.
  - Added Windows PowerShell helpers for locked build/hash generation and native mock smoke startup.
  - Added the Windows native acceptance checklist and exact honest release statement.
  - Integrated backend platform capabilities, provider enforcement, macOS-only Codex compilation, stale-setting repair, and LocalAppData selection.
  - Integrated local-only Windows Credential Manager storage and the NSIS current-user overlay.
  - Added the serialized credential-delete boundary requested by the plan and validated the Windows overlay JSON schema.
  - Visually inspected the updated 1536×1024 baseline; only the intended honest example provenance changed and graph layout remained intact.
  - Ran the integrated full regression, production frontend build, macOS Tauri app/DMG build, bundle scan, and zero-model Codex readiness smoke.
  - Added a Windows-only real Credential Manager round-trip smoke to the deterministic Windows build script.
  - Hardened credential writes so a failed Local-persistence verification removes the just-written entry, and platformized the backend save-success message.
  - Restricted OpenAI endpoint overrides to debug-only loopback, added single-instance focus, removed remaining fixture-as-AI copy, isolated/cleaned mock credentials, pinned Windows tool versions, and added a human-gated win32 screenshot workflow.
  - Re-ran debug and release Rust suites plus Playwright after audit fixes; all passed.
  - Checked for a local Windows VM/runtime and found none, leaving native Windows acceptance as an explicit external gate.
  - Rebuilt the unsigned macOS regression app/DMG after all audit fixes and re-scanned the final release bundle for test-only hooks.
  - Received independent final Rust/security and frontend/packaging verdicts with no remaining P0/P1 findings; the remaining gates require a Windows 11 x64 host.
- Files created/modified:
  - `task_plan.md` (created)
  - `findings.md` (created)
  - `progress.md` (created)
  - `.gitignore` (added `*.tsbuildinfo`)
  - `tests/helpers/mock-openai-server.mjs` and `.d.mts` (created)
  - `tests/mock-openai-server.test.ts` (created)
  - `package.json` (added `mock:openai` test helper command)
  - `scripts/build-windows-internal.ps1` (created)
  - `scripts/start-windows-mock-smoke.ps1` (created)
  - `docs/windows-internal-mvp.md` (created)
  - `src-tauri/src/platform.rs` and related backend domain/command/provider/repository/lib files
  - `src-tauri/src/keychain.rs`, Cargo target dependencies/lock, and `src-tauri/tauri.windows.conf.json`

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Session catch-up | Project root | Report prior unsynced context or remain empty | No unsynced context reported | pass |
| Baseline secret/name scan | Project root | No database, log, credential, or real `.env` staged | Only `.env.example` found | pass |
| TypeScript baseline | `npm run typecheck` | No type errors | Exit 0 | pass |
| Frontend unit baseline | `npm test` | Existing suite passes | 35/35 passed | pass |
| Rust baseline | Cargo check and test, locked | Compile and tests pass without paid turns | Check passed; 49 passed, 4 ignored | pass |
| Browser E2E baseline | `npm run test:e2e` | Existing browser-demo suite passes | 10/10 passed | pass |
| Local OpenAI mock contracts | Focused Vitest | Four privacy/protocol scenarios pass | 4/4 passed | pass |
| TypeScript after mock helper | `npm run typecheck` | ESM helper declarations resolve | Exit 0 | pass |
| Backend platform/storage Rust suite | Locked Cargo tests | Platform, provider, LocalAppData, and credential changes preserve macOS | 57 passed, 4 paid/native smokes ignored | pass |
| Credential integration | Keychain-focused tests and format check | Local persistence helpers and serialized cleanup API compile cleanly | 4/4 passed; format/config parse passed | pass |
| Integrated TypeScript | `npm run typecheck` | No cross-platform type regressions | Exit 0 | pass |
| Integrated Vitest | `npm test` | Platform, mock, graph, and import contracts pass | 44/44 passed | pass |
| Integrated Rust | fmt, locked check/all-targets, locked tests | No formatting/compile/test regression | 58 passed, 4 paid/native smokes ignored | pass |
| Integrated Playwright | `npm run test:e2e` | B5, fixture provenance, and provider flows pass | 11/11 passed | pass |
| Production frontend | `npm run build` | Vite production bundle builds | Exit 0 | pass |
| Mock exclusion | Search `dist` and macOS `.app` | No mock helper, scenario variable, or test key bundled | No matches | pass |
| macOS packaging | Tauri build, unsigned internal | `.app` and `.dmg` produced after final fixes | Exit 0; DMG SHA-256 `cc97e201e2e9114aef987fc70b3228e1aa07ca6742c397ee48074c022fcd674a` | pass |
| Codex readiness | Exact no-model ignored smoke | Sandbox/login/protocol readiness without turn | 1/1 passed, no model request | pass |
| Audit-fix Rust debug/release | Locked debug and release tests | cfg combinations and hardened endpoint/credential paths pass | 61 passed, 4 ignored in each profile | pass |
| Audit-fix Playwright | Full suite | Fixture-source copy and graph regressions pass | 11/11 passed | pass |
| Windows host discovery | Local virtualization/application scan | Find a usable Windows 11 runner or record absence | No Windows VM/runtime found | external-gate |
| Windows target cross-check | `x86_64-pc-windows-msvc` from macOS | Identify source/dependency errors if possible | Reached `ring`; blocked by missing MSVC `assert.h`/SDK | environment-blocked |
| Final release-hook scan | `dist` and rebuilt macOS `.app` | No mock helper, dummy key, debug endpoint/account override | No matches | pass |
| Windows handoff source clone | `git clone --no-local` | Clean Git tree, no origin, neutral local identity, no unreachable objects | All checks produced expected empty/output values | pass |
| Windows handoff archive | ZIP integrity and entry audit | One top-level repo; no excluded cache/data paths | 220 entries; integrity and forbidden-path checks passed | pass |
| Windows handoff extraction | Fresh temporary directory | Exact source commit and clean portable Git state survive extraction | HEAD/ancestor/identity/required-file checks passed | pass |

## Session: 2026-08-16 B2 canonical visual rebuild

- Replaced the stale B2 reference with the user-approved 1586×992 canonical and retained the former reference as an exploration artifact.
- Rebuilt B2 as a deterministic local texture + Canvas particles + SVG graph + DOM workbench composition with five node material families, layered paths, shared MiniMap geometry, local avatars and SVG controls.
- Added a dedicated Playwright visual harness, stable-capture check, 1280×800 responsive check, no-external-traffic assertion, and overlay/heatmap/ROI report generation.
- Final automated verification: Relay typecheck passed; Relay tests passed 153 effective tests with one intentional skip; B2 Playwright 5/5 passed; production build and seven-file boundary scan passed; `git diff --check` passed.
- Latest strict visual report after the bounded CSS calibration: full SSIM 0.7081, weighted blurred ROI 0.8150, main-spine corridor IoU 0.7236 (`pass=false`); the preserved changes improved both global metrics and lifted Devin blurred ROI to 0.8277.
- Rebuilt and restarted the local production preview on `http://127.0.0.1:4176/?demo=b2`; live page reported the deterministic fixture ready and no console errors.

## Session: 2026-08-16 Halo material reconstruction

- Started the isolated hybrid optics pass after the user accepted the full-page reconstruction but rejected the concentric halo material.
- Locked the implementation boundary to B2 star optics only: no layout, copy, background, panel, data, backend or motion changes.
- Selected a deterministic transparent-PNG atmosphere layer plus sharp SVG shell/core, with a Halo Lab approval gate before full-graph replacement.
- Added the isolated `/?demo=b2&haloLab=1` route with low/target/high energy, Idle/Hover/Selected static states, 100%/200% inspection and six material families; local assets and fonts must decode before `data-b2-ready=true`.
- Generated and locked 14 deterministic DPR2 halo PNGs. The final set is 608,496 compressed bytes / 2,557,952 decoded bytes, has zero alpha in every outer 8px guard, and survived five byte-identical regeneration checks.
- Rebuilt Source optics as separated aura/body passes: pre-baked atmosphere, short tapered diffraction, near bloom, tone+pale shell, continuous inner plasma, feathered core and rounded diamond hotspot. No animation or full-B2 integration was added.
- Corrected the halo reporter after proving the original 83px white-core floor contradicted the 77px canonical. Final honest target range is 75–92px; every remaining locked optical check now passes.
- Final target Source report after the bounded shell finish: hot/ultra core 77/70px; shell r12.25, 199.98L, .342S; moat 141.53L; outer 60.77L; hue shift +5.19°; diffraction 14.87/3.61L; path 176.67L/.367S; masked blurred SSIM .94296; DPR consistency .99944.
- Verification passed: Halo Playwright 2/2, all B2 Playwright 7/7, Relay typecheck, 159 Relay Vitest tests plus one intentional skip, production build, boundary scan, halo hash check and diff check.
- Re-captured the unchanged complete B2: full SSIM .708060953, weighted blurred ROI .815033023, main-spine IoU .723619910. The new material remains behind the explicit user approval gate.
- The user approved the Halo Lab and the optics were integrated into all full-B2 nodes using six global rendering passes. All final nodes use target energy 2; deterministic variants are explicit, Devin stays a texture-free diamond, and MiniMap remains simplified.
- Post-integration visual metrics all improved: full SSIM .712888, weighted blurred ROI .823585, main-spine IoU .765678, and six non-root Source halo average blurred SSIM .812910 versus .779921 before integration (+.032990).
- Final regression passed: 14-asset hash/edge check, Halo Lab optical gates, Relay typecheck, 162 Relay Vitest tests plus one intentional skip, production build, boundary scan, 7/7 B2 Playwright tests, five byte-stable captures, 1280 responsive view, keyboard/zoom/tabs and zero external traffic.

## Session: 2026-08-16 B2 motion language

- Started the visual-product selection gate before adding production motion to the approved static optics.
- Created a dedicated run at `docs/visual-product-runs/2026-08-16-b2-motion-v1/` with the required product brief, three controlled visual directions, provisional selection and reverse specification.
- Generated three distinct local storyboard images using the same B2 graph and state matrix: energy envelope, signal along relations and crystallization.
- Provisional recommendation is Direction A as the global language, with one event-driven path packet retained from B and one persisted-node crystallization transition retained from C.
- The deterministic artifact validator passes with 32 PB requirements, 3 linked images, 8 trace rows, 10 state rows, 12 hidden-decision categories, 6 adversarial simulations and 8 acceptance criteria.
- No runtime code, live Relay state, Supabase, Devin or current full-B2 animation was changed; Motion Lab remains behind user selection.
- The user approved the hybrid motion plan. Phase 1 is now implemented at `/?demo=b2&motionLab=1`: Idle, one-shot Selected focus, directed New Node crystallization, deterministic transport controls, 100%/200% inspection and Reduced Motion.
- The renderer uses the locked eight-pass order and exactly 12 fixed condensation particles. It does not animate filters or halo textures, does not use runtime randomness, and keeps Devin Event/Stale visibly disabled for the next approval phase.
- Browser acceptance passed at every frozen Selected/New Node keyframe, with five byte-identical representative captures, 1586x992 and 1280x800 containment, and no external traffic.
- Final regression: 184 Relay tests passed with one intentional skip; all 12 B2 Playwright tests passed; Relay typecheck, production build, 21-file boundary scan and diff check passed.
- The existing static B2 candidate remains byte-identical and its visual metrics are unchanged. Full-B2 motion integration is intentionally paused until the Motion Lab receives visual approval.
- After Phase 1 approval, the Motion Lab now also exposes Devin Event and Devin Stale. Event uses one explicit cubic-point light packet and a single 580–850ms near-field lift; Stale produces no packet, decays the temporary layer to 40%, preserves 82% of the base diamond and settles into a warm-gray broken ring.
- Both Devin states are labelled `视觉 Fixture · 非实时状态`; neither is derived from Relay offline/reconnecting and neither claims a live provider connection.
- Phase 2 browser evidence covers 12 Devin keyframes, five byte-identical event captures, one-or-zero packet cardinality, Reduced Motion with zero rAF, and no external traffic. The complete B2 suite is now 14/14 Playwright tests.
- Final Phase 2 regression: 187 Relay tests passed with one intentional skip; typecheck, production build, 21-file boundary scan and diff check passed. Static B2 metrics remain exactly .712888 full, .823585 weighted, .765678 spine and .812910 Source halo.
- The user approved Phase 2, and the complete B2 now uses the exact eight-pass render stack with ordinary selection focus plus an opt-in `motionDemo=1` sequence for candidate creation, Devin event and stale.
- Added the local production motion runtime: one active trigger, FIFO queue, stable eventKey/activitySeq dedupe, 64-key played history, strictly one packet, fixed-frame query capture and Reduced Motion terminal semantics.
- Fixed an independent-audit finding where the hidden candidate's transparent child hit circle could still receive pointer and keyboard input. The final test performs a real coordinate click and repeated Tab/Enter traversal before the node is visible.
- Final verification after the fix: Relay typecheck and production build passed; 211 Relay unit tests passed with one intentional skip; all 21 B2 Playwright tests passed; the 21-file boundary scan and diff check passed.
- Static B2 remains byte-identical at SHA-256 `abf62878e2e47daed7065b47999f542d703db45e571ffaf8375a8b986fa42d1a`, with unchanged `.712888 / .823585 / .765678 / .812910` visual metrics.
- In-app browser smoke at `http://127.0.0.1:4187/?demo=b2&motionDemo=1` observed the live clock enter `devin-event` with exactly one packet and finish in the static terminal state.

## Session: 2026-08-16 B2 live Relay integration

- Added `B2RoomView` and a deterministic projection from the existing effective room graph to B2 star families, paths, source/team semantics and Presence rings.
- Wired node selection, stance changes, Realtime drag preview and drag-stop persistence to the existing Relay callbacks; no Supabase schema, RLS, Edge Function or public DTO changed.
- Production/live room rendering now selects B2 by default. Invite/bootstrap/error states remain on the existing surface, and a room can switch to the complete structured collaboration panel without recreating the controller.
- The fixed `/?demo=b2`, Halo Lab and Motion Lab routes were not changed by this integration.
- Browser smoke at 1586x992 passed on the deterministic controller fixture at `http://127.0.0.1:4190/`; screenshot: `/tmp/dialogue-atlas-b2-live-room.png`.
- Verification: focused B2/App tests 19/19; full Relay tests 209/209 effective with one intentional skip; Relay typecheck passed; production build passed; 21-file boundary scan and diff check passed.
- Remaining external acceptance is a true two-client run against a running local or hosted Supabase project. The database/Realtime layer is already implemented, but local Supabase was not started in this slice.

## Session: 2026-08-16 local Supabase backend acceptance

- Installed and started the local Supabase stack, reset the database, and applied all eight Relay migrations to real Postgres 15.
- Ran the database contract suite successfully: pgTAP 25/25, including RLS coverage, member/non-member reads, owner-only decision/action/Devin boundaries, provider-write privilege isolation, and bounded Devin entitlement/quota behavior.
- Expanded the opt-in local integration smoke to use real Anonymous Auth identities and real HTTP/RPC calls. It now verifies room creation and join, outsider denial, direct-write denial, owner/member roles, idempotent stance/layout mutations, stale-layout CAS conflict, immutable source package, room close, and invite revocation.
- Added a real private-Realtime run with owner connected before the visitor joins. Late-join Presence, focus, drag preview, durable `node_stance_set` broadcast, and activity replay all passed; non-member private-channel subscription and client-supplied identity both failed closed.
- Full regression passed after the additions: Relay typecheck; 211 unit tests plus the two opt-in local integration tests; production build; 21-file boundary scan; and `git diff --check`.
- Local Supabase remains running for the remaining desktop publish -> invite fragment -> browser UI acceptance. No Supabase service-role or Devin secret was written into frontend environment files.
- During packaged-app acceptance, fixed two environment-injection defects rather than bypassing the disabled publish button: Relay config now uses direct build-time Vite variables, and the local configurator writes coherent ordinary plus production-local public env files for both Tauri and Relay Web.
- Rebuilt the macOS debug app with exact loopback CSP and completed the missing UI acceptance using an existing analyzed conversation: 44 source nodes, zero evidence excerpts, one local room, and one fresh browser anonymous member.
- The invite bearer was supplied in the URL fragment and removed after redemption. Owner and visitor both appeared online; the visitor's challenge persisted and moved the displayed activity sequence from 61 to 62.
- R2 and R3 are now complete for the local collaboration backend. The local Supabase stack, Relay Web dev server, packaged owner app, and guest room remain running/open for inspection; this still does not claim deployed Vercel, hosted Supabase, or live Devin credentials.
- Applied the ninth migration without weakening production RLS. It adds server-assigned member colors and an atomic member directory to `get_room_bundle`; pgTAP now passes 30/30.
- Diagnosed a local reset/startup race from Auth and Postgres logs, added a narrowly scoped local-smoke retry, and verified the exact order `supabase test db` -> real Anonymous Auth/RLS/Realtime smoke succeeds.
- Final backend receipts: local Supabase smoke 2/2; desktop publisher integration 7/7; root tests 74 passed plus one intentional skip; Relay package tests 216 passed plus two integration skips; Relay production build passed; boundary scan passed over 21 dist files; static audit passed with nine migrations and 14/14 RLS tables; TypeScript and diff checks passed.

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-08-11 | `fatal: not a git repository` | 1 | Will initialize a local baseline after auditing ignore rules |
| 2026-08-11 | TS7016 for the new `.mjs` mock helper | 1 | Replaced the declaration file suffix with `.d.mts` |
| 2026-08-11 | Windows cross-check failed in `ring` due missing MSVC `assert.h` | 1 | Deferred full compile to required Windows 11/MSVC host |
| 2026-08-11 | Clippy component unavailable | 1 | Kept fmt, check, unit, and diff checks as local verification |
| 2026-08-11 | Exact readiness filter selected zero tests | 1 | Corrected to the full no-model test name before rerunning |
| 2026-08-11 | Registry source command referenced nonexistent `credential.rs` | 1 | Read actual `cred.rs`/`store.rs` and confirmed account-first target naming |
| 2026-08-11 | New fixture-source E2E selected only the mode drawer header | 1 | Scoped the assertion to the containing right-drawer aside and reran it |
| 2026-08-11 | One fake Codex process assertion failed while debug and release Rust suites ran concurrently | 1 | The focused test passed; serial full debug and release suites each passed 61/61 non-ignored tests |
| 2026-08-11 | Rust fmt check found one long new assertion | 1 | Ran `cargo fmt --all` |
| 2026-08-11 | New flat-export fixture test expected `[邮箱_1]`, but the product contract uses `[邮箱]` | 1 | Corrected the assertion to the existing deterministic placeholder |
| 2026-08-11 | Initial staging clone command selected the destination as `workdir` before it existed | 1 | Re-ran from the existing temporary parent and addressed the clone with `git -C` |
| 2026-08-11 | Initial extraction verification selected the repository as `workdir` before unzip created it | 1 | Extracted from the existing parent and used `git -C` for all repository assertions |
| 2026-08-15 | B2 dock test matched the same question text inside the SVG candidate node | 1 | Scoped the assertion to the LLM dock with Testing Library `within` |
| 2026-08-15 | Requested Vite port 4173 was already occupied | 1 | Used the automatically selected isolated port 4174 for screenshots |
| 2026-08-15 | Combined visual-tuning patch referenced a duplicate line that was not present | 1 | Re-read exact anchors and applied a smaller verified patch |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Local implementation and macOS regression are complete; Windows-native acceptance is pending |
| Where am I going? | Capture the Win32 baseline and run the locked build/native smoke on Windows 11 x64 |
| What's the goal? | Windows 11 x64 API-only internal MVP without regressing macOS |
| What have I learned? | See `findings.md` |
| What have I done? | Implemented the API-only Windows port, test harness, packaging gates, and local/macOS verification |
# Session: 2026-08-16 B2 functional product integration

- User approved direct implementation of P0–P5, prioritizing the collaboration-decision loop and choosing a real Discussion/Node/Execution workbench rather than a fake LLM conversation.
- Recovered the existing file-based plan and confirmed the worktree is intentionally dirty; no reset or destructive cleanup will be used.
- Revalidated current implementation boundaries: fixture B2 is visually complete; live B2 has real room projection/selection/Presence/stance/drag; classic Relay already owns the broader collaboration and Devin callbacks.
- Confirmed local Supabase is running and prior receipts record migrations, pgTAP and dual-client Realtime acceptance. Desktop publish/invite/browser remains the active P0 UI oracle.

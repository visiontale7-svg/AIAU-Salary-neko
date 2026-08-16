import {
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  ActionBrief,
  DevinRun,
  Proposal,
  ProposalDecision,
  PublicGraphNode,
  TeamEdgeItem,
  TeamNodeItem,
} from "@dialogue-atlas/relay-contract";
import type {
  ActionBriefDraft,
  ProposalDraft,
  RelayReadyRoomModel,
  RelayRoomCallbacks,
  TeamEdgeDraft,
  TeamNodeDraft,
} from "@dialogue-atlas/relay-room";
import type { B2RoomPath, B2RoomStar } from "./b2-room-model";

export type B2WorkbenchTab = "discussion" | "node" | "execution";

interface B2WorkbenchProps {
  model: RelayReadyRoomModel;
  callbacks: RelayRoomCallbacks;
  stars: readonly B2RoomStar[];
  paths: readonly B2RoomPath[];
  selected?: B2RoomStar;
  activeTab: B2WorkbenchTab;
  onTabChange(tab: B2WorkbenchTab): void;
  onOpenStructuredView?(): void;
}

const NODE_KINDS: PublicGraphNode["kind"][] = ["anchor", "claim", "evidence", "decision", "action", "note"];

function initials(name: string): string {
  return [...name.trim()].slice(0, 2).join("").toUpperCase() || "?";
}

function displayTime(value?: string): string {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function asLines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function mutationAccepted(result: void | boolean | Promise<boolean>): Promise<boolean> {
  return await result !== false;
}

function PanelHeading({ eyebrow, title, meta }: { eyebrow: string; title: string; meta?: ReactNode }) {
  return (
    <header className="b2-panel-heading">
      <div><p>{eyebrow}</p><h2>{title}</h2></div>
      {meta ? <span>{meta}</span> : null}
    </header>
  );
}

function OfflineDrafts({ model, callbacks }: { model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks }) {
  if (model.connection === "live" && model.offline.drafts.length === 0) return null;
  return (
    <section className="b2-drafts" aria-label="本地安全草稿">
      <div><strong>{model.connection === "live" ? "待处理草稿" : "连接恢复中"}</strong><span>{model.offline.drafts.length} 项 · 最近同步 {displayTime(model.offline.lastSyncedAt)}</span></div>
      {model.offline.drafts.map((draft) => (
        <article key={draft.id} className={draft.status === "conflict" ? "has-conflict" : ""}>
          <div><b>{draft.label}</b><small>{draft.kind.replaceAll("_", " ")}{draft.status === "conflict" ? ` · 房间 revision ${draft.serverRevision ?? "?"}` : ""}</small></div>
          <div>
            {callbacks.onResolveDraft ? <button type="button" disabled={model.connection !== "live"} onClick={() => callbacks.onResolveDraft?.(draft.id, "retry_local")}>重试</button> : null}
            {draft.status === "conflict" && callbacks.onResolveDraft ? <button type="button" onClick={() => callbacks.onResolveDraft?.(draft.id, "accept_server")}>采用房间版本</button> : null}
            {callbacks.onDiscardDraft ? <button type="button" onClick={() => callbacks.onDiscardDraft?.(draft.id)}>丢弃</button> : null}
          </div>
        </article>
      ))}
    </section>
  );
}

function ProposalComposer({ target, callbacks, disabled }: {
  target: { id: string; origin: "source" | "team"; kind: "node" | "edge"; label: string };
  callbacks: RelayRoomCallbacks;
  disabled: boolean;
}) {
  return (
    <details className="b2-composer">
      <summary>提出语义修改提案</summary>
      <form onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const operation = String(data.get("operation")) as Proposal["operation"];
        const value = String(data.get("value") ?? "").trim();
        const draft: ProposalDraft = {
          targetType: `${target.origin}_${target.kind}` as Proposal["targetType"],
          targetId: target.id,
          operation,
          proposedValue: operation === "remove" ? { remove: true } : { value },
          rationale: String(data.get("rationale") ?? "").trim(),
        };
        const result = callbacks.onSubmitProposal?.(draft);
        if (result !== undefined && await mutationAccepted(result)) form.reset();
      }}>
        <p className="b2-form-context">目标：{target.label}</p>
        <label>修改类型<select name="operation" defaultValue="replace_label">
          <option value="replace_label">替换标题</option>
          {target.kind === "edge" ? <option value="replace_relation">替换关系</option> : null}
          <option value="reclassify">重新分类</option>
          <option value="remove">建议移除</option>
        </select></label>
        <label>建议值<input name="value" maxLength={240} placeholder="明确写出替换内容或分类" /></label>
        <label>理由<textarea name="rationale" rows={3} required placeholder="为什么团队应该采纳？" onFocus={() => callbacks.onTyping?.(target.id, true)} onBlur={() => callbacks.onTyping?.(target.id, false)} /></label>
        <button type="submit" className="b2-primary" disabled={disabled || !callbacks.onSubmitProposal}>提交提案</button>
      </form>
    </details>
  );
}

function TeamNodeEditor({ model, callbacks, item, onClose }: {
  model: RelayReadyRoomModel;
  callbacks: RelayRoomCallbacks;
  item?: TeamNodeItem;
  onClose(): void;
}) {
  return (
    <form className="b2-editor" aria-label={item ? "编辑团队观点" : "新增团队观点"} onSubmit={async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const draft: TeamNodeDraft = {
        id: item?.id,
        label: String(data.get("label") ?? "").trim(),
        kind: String(data.get("kind")) as PublicGraphNode["kind"],
        modeIds: data.getAll("modeIds").map(String),
        expectedRevision: item?.revision,
      };
      const result = item
        ? callbacks.onUpdateTeamNode?.({ ...draft, id: item.id, expectedRevision: item.revision })
        : callbacks.onCreateTeamNode?.(draft);
      if (result !== undefined && await mutationAccepted(result)) onClose();
    }}>
      <div className="b2-editor__head"><b>{item ? "编辑本人观点" : "新增团队观点"}</b><button type="button" onClick={onClose} aria-label="关闭团队观点编辑器">×</button></div>
      <label>标题<input name="label" required maxLength={180} defaultValue={item?.label ?? ""} autoFocus /></label>
      <label>类型<select name="kind" defaultValue={item?.kind ?? "claim"}>{NODE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
      {model.bundle.atlas.graph.modes.length ? <fieldset><legend>图谱模式</legend>{model.bundle.atlas.graph.modes.map((mode) => (
        <label className="b2-check" key={mode.id}><input type="checkbox" name="modeIds" value={mode.id} defaultChecked={item?.modeIds.includes(mode.id)} /><span style={{ "--mode-color": mode.color } as CSSProperties}>{mode.label}</span></label>
      ))}</fieldset> : null}
      <button className="b2-primary" type="submit" disabled={item ? !callbacks.onUpdateTeamNode : !callbacks.onCreateTeamNode}>{item ? "保存观点" : "加入房间"}</button>
    </form>
  );
}

function TeamEdgeEditor({ callbacks, stars, item, selectedId, onClose }: {
  callbacks: RelayRoomCallbacks;
  stars: readonly B2RoomStar[];
  item?: TeamEdgeItem;
  selectedId?: string;
  onClose(): void;
}) {
  const fallbackTarget = stars.find((star) => star.node.id !== selectedId)?.node.id ?? selectedId ?? "";
  return (
    <form className="b2-editor" aria-label={item ? "编辑团队关系" : "新增团队关系"} onSubmit={async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const draft: TeamEdgeDraft = {
        id: item?.id,
        source: String(data.get("source")),
        target: String(data.get("target")),
        type: String(data.get("type") ?? "relates_to").trim(),
        label: String(data.get("label") ?? "").trim(),
        expectedRevision: item?.revision,
      };
      const result = item
        ? callbacks.onUpdateTeamEdge?.({ ...draft, id: item.id, expectedRevision: item.revision })
        : callbacks.onCreateTeamEdge?.(draft);
      if (result !== undefined && await mutationAccepted(result)) onClose();
    }}>
      <div className="b2-editor__head"><b>{item ? "编辑本人关系" : "连接两颗星"}</b><button type="button" onClick={onClose} aria-label="关闭团队关系编辑器">×</button></div>
      <label>起点<select name="source" defaultValue={item?.source ?? selectedId ?? stars[0]?.node.id}>{stars.map((star) => <option key={star.node.id} value={star.node.id}>{star.node.label}</option>)}</select></label>
      <label>终点<select name="target" defaultValue={item?.target ?? fallbackTarget}>{stars.map((star) => <option key={star.node.id} value={star.node.id}>{star.node.label}</option>)}</select></label>
      <label>关系类型<input name="type" required defaultValue={item?.type ?? "relates_to"} /></label>
      <label>显示文字<input name="label" required maxLength={120} defaultValue={item?.label ?? "关联到"} /></label>
      <button className="b2-primary" type="submit" disabled={item ? !callbacks.onUpdateTeamEdge : !callbacks.onCreateTeamEdge}>{item ? "保存关系" : "新增关系"}</button>
    </form>
  );
}

function DiscussionPanel({ model, callbacks }: { model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks }) {
  const [focusedId, setFocusedId] = useState(model.bundle.proposals.find((proposal) => proposal.status === "open")?.id ?? model.bundle.proposals[0]?.id ?? "");
  const focused = model.bundle.proposals.find((proposal) => proposal.id === focusedId) ?? model.bundle.proposals[0];
  const comments = focused ? model.bundle.comments.filter((comment) => comment.proposalId === focused.id) : [];
  const decision = focused ? model.bundle.decisions.find((item) => item.proposalId === focused.id) : undefined;
  const canMutate = model.connection === "live" && model.bundle.room.status === "open" && !model.pendingMutation;
  const isOwner = model.bundle.member.role === "owner";
  const nameFor = (userId: string) => model.presence.find((member) => member.userId === userId)?.displayName
    ?? (userId === model.bundle.member.userId ? model.bundle.member.displayName : "房间成员");

  return (
    <div className="b2-tab-panel" aria-label="团队讨论">
      <PanelHeading eyebrow="结构化讨论" title="提案与共识" meta={`${model.bundle.proposals.filter((proposal) => proposal.status === "open").length} 个待决`} />
      <p className="b2-panel-intro">这里记录针对图谱的可追溯讨论，不是通用聊天。评论、提案和房主决定都会保留。</p>
      {model.bundle.proposals.length ? (
        <>
          <div className="b2-proposal-list" role="list" aria-label="房间提案">
            {model.bundle.proposals.map((proposal) => (
              <button key={proposal.id} type="button" role="listitem" className={proposal.id === focused?.id ? "is-active" : ""} onClick={() => setFocusedId(proposal.id)}>
                <span>{proposal.targetType.replaceAll("_", " ")}</span><b>{proposal.rationale}</b><i data-status={proposal.status}>{proposal.status}</i>
              </button>
            ))}
          </div>
          {focused ? <article className="b2-proposal-detail">
            <div className="b2-detail-meta"><span>{focused.operation.replaceAll("_", " ")}</span><span>revision {focused.revision}</span></div>
            <h3>{focused.rationale}</h3>
            <pre>{JSON.stringify(focused.proposedValue, null, 2)}</pre>
            {decision ? <p className={`b2-decision is-${decision.decision}`}><b>{decision.decision}</b><span>{decision.rationale}</span></p> : null}
            <section className="b2-comments" aria-label="提案评论">
              {comments.length ? comments.map((comment) => <article key={comment.id}><b>{nameFor(comment.createdBy)}</b><p>{comment.body}</p><time>{displayTime(comment.createdAt)}</time></article>) : <p className="b2-empty">还没有评论。</p>}
              <form onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const body = String(new FormData(form).get("body") ?? "").trim();
                const result = callbacks.onAppendComment?.(focused.id, body);
                if (result !== undefined && await mutationAccepted(result)) form.reset();
              }}>
                <label><span className="b2-visually-hidden">添加评论</span><textarea name="body" required rows={2} placeholder="补充依据或提出具体问题" onFocus={() => callbacks.onTyping?.(focused.id, true)} onBlur={() => callbacks.onTyping?.(focused.id, false)} /></label>
                {model.typingTargetIds?.includes(focused.id) ? <p className="b2-typing" role="status">有成员正在输入…</p> : null}
                <button type="submit" disabled={!canMutate || !callbacks.onAppendComment}>评论</button>
              </form>
            </section>
            {isOwner && focused.status === "open" ? <form className="b2-owner-decision" onSubmit={(event) => event.preventDefault()}>
              <label>房主决定依据<textarea name="rationale" rows={2} required placeholder="记录接受、拒绝或延期的原因" onFocus={() => callbacks.onTyping?.(focused.id, true)} onBlur={() => callbacks.onTyping?.(focused.id, false)} /></label>
              <div>{(["accepted", "rejected", "deferred"] as ProposalDecision["decision"][]).map((status) => <button key={status} type="button" disabled={!canMutate || !callbacks.onDecideProposal} onClick={(event) => {
                const form = event.currentTarget.closest("form");
                const textarea = form?.querySelector<HTMLTextAreaElement>("textarea");
                const rationale = textarea?.value.trim() ?? "";
                if (!rationale) return textarea?.focus();
                callbacks.onDecideProposal?.(focused.id, status, rationale);
              }}>{status === "accepted" ? "接受" : status === "rejected" ? "拒绝" : "延期"}</button>)}</div>
            </form> : null}
          </article> : null}
        </>
      ) : <p className="b2-empty">目前没有提案。选择节点后可在“节点”中提出修改。</p>}

      <section className="b2-room-activity">
        <h3>房间状态</h3><p>revision {model.bundle.room.revision} · 最新活动 seq {model.bundle.lastActivitySeq}</p>
        <div>{model.presence.map((member) => <span key={member.userId}><i>{initials(member.displayName)}</i><b>{member.displayName}</b><small>{member.role === "owner" ? "房主" : "成员"} · {displayTime(member.onlineAt)}</small></span>)}</div>
      </section>
      <OfflineDrafts model={model} callbacks={callbacks} />
    </div>
  );
}

function NodePanel({ model, callbacks, stars, paths, selected }: {
  model: RelayReadyRoomModel;
  callbacks: RelayRoomCallbacks;
  stars: readonly B2RoomStar[];
  paths: readonly B2RoomPath[];
  selected?: B2RoomStar;
}) {
  const [nodeEditor, setNodeEditor] = useState<TeamNodeItem | "create" | null>(null);
  const [edgeEditor, setEdgeEditor] = useState<TeamEdgeItem | "create" | null>(null);
  const [proposalPathId, setProposalPathId] = useState<string | null>(null);
  const selectedId = selected?.node.id;
  const ownNode = model.bundle.teamItems.find((item): item is TeamNodeItem => item.itemType === "node" && item.id === selectedId && item.createdBy === model.bundle.member.userId);
  const ownEdges = model.bundle.teamItems.filter((item): item is TeamEdgeItem => item.itemType === "edge" && item.createdBy === model.bundle.member.userId);
  const selectedEvidence = selected?.node.evidenceIds.flatMap((id) => {
    const value = model.bundle.atlas.evidence[id];
    return value ? [{ id, ...value }] : [];
  }) ?? [];
  const ownStance = selected ? model.bundle.stances.find((stance) => stance.nodeId === selected.node.id && stance.userId === model.bundle.member.userId)?.stance : undefined;
  const canMutate = model.connection === "live" && model.bundle.room.status === "open" && !model.pendingMutation;
  const proposalPath = paths.find((path) => path.edge.id === proposalPathId);

  return (
    <div className="b2-tab-panel" aria-label="节点工作台">
      <PanelHeading eyebrow="证据与团队层" title={selected ? selected.node.label : "选择一颗星"} meta={selected?.node.origin === "source" ? "来源锁定" : selected ? "团队贡献" : undefined} />
      {selected ? <>
        <div className="b2-node-summary">
          <div><span>确认 <b>{selected.node.review?.confirm ?? 0}</b></span><span>质疑 <b>{selected.node.review?.challenge ?? 0}</b></span><span>待证据 <b>{selected.node.review?.needsEvidence ?? 0}</b></span></div>
          <div className="b2-live__stance" aria-label="对节点表态">
            <button type="button" aria-pressed={ownStance === "confirm"} disabled={!canMutate || !callbacks.onSetStance} onClick={() => callbacks.onSetStance?.(selected.node.id, "confirm")}>确认</button>
            <button type="button" aria-pressed={ownStance === "challenge"} disabled={!canMutate || !callbacks.onSetStance} onClick={() => callbacks.onSetStance?.(selected.node.id, "challenge")}>质疑</button>
            <button type="button" aria-pressed={ownStance === "needs_evidence"} disabled={!canMutate || !callbacks.onSetStance} onClick={() => callbacks.onSetStance?.(selected.node.id, "needs_evidence")}>需要证据</button>
          </div>
        </div>
        <section className="b2-evidence"><h3>已批准证据 · {selectedEvidence.length}</h3>{selectedEvidence.length ? selectedEvidence.map((evidence) => <blockquote key={evidence.id}>{evidence.excerpt}{evidence.speaker ? <cite>{evidence.speaker}</cite> : null}</blockquote>) : <p className="b2-empty">该节点没有获准公开的证据摘录。</p>}</section>
        {ownNode && callbacks.onUpdateTeamNode ? <button type="button" className="b2-secondary" onClick={() => setNodeEditor(ownNode)}>编辑本人观点</button> : null}
        <ProposalComposer target={{ id: selected.node.id, origin: selected.node.origin, kind: "node", label: selected.node.label }} callbacks={callbacks} disabled={!canMutate} />
      </> : <p className="b2-empty">从星图中选择节点，查看证据、表态或提出修改。</p>}

      <section className="b2-team-layer">
        <div className="b2-team-layer__actions"><button type="button" onClick={() => setNodeEditor("create")} disabled={!canMutate || !callbacks.onCreateTeamNode}>＋ 团队观点</button><button type="button" onClick={() => setEdgeEditor("create")} disabled={!canMutate || stars.length < 2 || !callbacks.onCreateTeamEdge}>连接节点</button></div>
        {nodeEditor ? <TeamNodeEditor model={model} callbacks={callbacks} item={nodeEditor === "create" ? undefined : nodeEditor} onClose={() => setNodeEditor(null)} /> : null}
        {edgeEditor ? <TeamEdgeEditor callbacks={callbacks} stars={stars} selectedId={selectedId} item={edgeEditor === "create" ? undefined : edgeEditor} onClose={() => setEdgeEditor(null)} /> : null}
        <details className="b2-relations"><summary>关系与修改提案 · {paths.length}</summary>{paths.map((path) => <article key={path.edge.id}><div><b>{path.edge.label || path.edge.type}</b><small>{path.edge.source} → {path.edge.target}</small></div><div>{ownEdges.some((edge) => edge.id === path.edge.id) ? <button type="button" onClick={() => setEdgeEditor(ownEdges.find((edge) => edge.id === path.edge.id)!)}>编辑</button> : null}<button type="button" onClick={() => setProposalPathId(proposalPathId === path.edge.id ? null : path.edge.id)}>提案</button></div></article>)}</details>
        {proposalPath ? <ProposalComposer target={{ id: proposalPath.edge.id, origin: proposalPath.edge.origin === "team" ? "team" : "source", kind: "edge", label: proposalPath.edge.label || proposalPath.edge.type }} callbacks={callbacks} disabled={!canMutate} /> : null}
      </section>
      <OfflineDrafts model={model} callbacks={callbacks} />
    </div>
  );
}

function DevinRunCard({ model, callbacks, run }: { model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks; run: DevinRun }) {
  const seed = useId().replaceAll(":", "");
  const [attempt, setAttempt] = useState(0);
  const requestId = `b2_devin_message_${seed}_${attempt}`;
  const events = model.devinEvents[run.id] ?? [];
  const isOwner = model.bundle.member.role === "owner";
  const canSend = isOwner && model.connection === "live" && !model.pendingMutation && ["queued", "working", "needs_input", "approval_needed"].includes(run.state);
  const healthLabel = run.providerHealth === "healthy" ? "正常"
    : run.providerHealth === "delayed" ? "延迟"
    : run.providerHealth === "stale" ? "失联"
    : "未知";
  return <article className="b2-devin-run">
    <div className="b2-detail-meta"><span>Devin Session event log</span><i data-state={run.state}>{run.state.replaceAll("_", " ")}</i></div>
    <h4>{run.statusDetail ?? "暂无更多状态信息"}</h4>
    <dl><div><dt>Provider 连接</dt><dd><span className="b2-provider-health" data-health={run.providerHealth}>{healthLabel}</span>{run.consecutiveFailures ? ` · 连续失败 ${run.consecutiveFailures}` : ""}</dd></div><div><dt>最近成功轮询</dt><dd>{run.lastSuccessfulPollAt ? displayTime(run.lastSuccessfulPollAt) : "尚未确认"}</dd></div><div><dt>最近 Provider event</dt><dd>{run.lastProviderEventAt ? displayTime(run.lastProviderEventAt) : "尚未收到"}</dd></div>{run.retryAfterAt ? <div><dt>下次可重试</dt><dd>{displayTime(run.retryAfterAt)}</dd></div> : null}<div><dt>Session ID</dt><dd>{run.externalSessionId ?? "尚未返回"}</dd></div><div><dt>官方页面</dt><dd>{run.externalUrl ? <a href={run.externalUrl} target="_blank" rel="noreferrer">打开 Session ↗</a> : "尚未返回"}</dd></div><div><dt>Pull Request</dt><dd>{run.pullRequestUrl ? <a href={run.pullRequestUrl} target="_blank" rel="noreferrer">查看 PR ↗</a> : "尚未生成"}</dd></div><div><dt>Checks</dt><dd>{run.checksState ?? "unknown"}</dd></div></dl>
    <details><summary>事件记录 · {events.length}</summary>{events.length ? <ol>{events.map((event) => <li key={event.id}><div className="b2-devin-event-meta"><time>{displayTime(event.createdAt)}</time><span>{event.actorType}</span><span>{event.eventType}</span></div><p>{event.text}</p></li>)}</ol> : <p className="b2-empty">还没有 provider event。</p>}</details>
    {canSend && callbacks.onSendDevinMessage ? <form onSubmit={async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = String(new FormData(form).get("message") ?? "").trim();
      const outcome = await callbacks.onSendDevinMessage?.(run.id, message, requestId) ?? "unknown";
      if (outcome === "accepted") form.reset();
      if (outcome !== "unknown") setAttempt((value) => value + 1);
    }}><label>给当前 Session 补充说明<textarea name="message" required rows={2} /></label><button type="submit">发送</button></form> : null}
  </article>;
}

function ActionBriefCard({ model, callbacks, brief }: { model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks; brief: ActionBrief }) {
  const seed = useId().replaceAll(":", "");
  const [attempt, setAttempt] = useState(0);
  const runs = model.bundle.devinRuns.filter((run) => run.actionBriefId === brief.id);
  const latestRun = [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const isOwner = model.bundle.member.role === "owner";
  const canStart = runs.length === 0 || latestRun?.state === "not_configured" || latestRun?.state === "failed";
  async function startRun() {
    const result = callbacks.onStartDevin?.(brief.id, `b2_devin_start_${seed}_${attempt}`);
    if (result !== undefined && await mutationAccepted(result)) setAttempt((value) => value + 1);
  }
  return <article className="b2-brief"><div className="b2-detail-meta"><span>Action Brief</span><span>{brief.baselineSha}</span></div><h3>{brief.title}</h3><p>{brief.objective}</p><dl><div><dt>允许文件</dt><dd>{brief.allowedFiles.join(", ") || "未指定"}</dd></div><div><dt>验收命令</dt><dd>{brief.acceptanceCommands.join(" · ") || "未指定"}</dd></div></dl>
    {runs.length ? runs.map((run) => <DevinRunCard key={run.id} model={model} callbacks={callbacks} run={run} />) : <div className="b2-run-empty"><p>还没有创建 Devin Session。</p>{isOwner && callbacks.onStartDevin ? <button type="button" disabled={model.connection !== "live" || Boolean(model.pendingMutation)} onClick={() => void startRun()}>创建 Devin Session</button> : <span>仅房主可启动</span>}</div>}
    {runs.length && canStart && isOwner && callbacks.onStartDevin ? <div className="b2-run-empty"><p>{latestRun?.state === "not_configured" ? "配置就绪后可用新的请求身份重试。" : "上一次运行已失败，可启动新的尝试。"}</p><button type="button" disabled={model.connection !== "live" || Boolean(model.pendingMutation)} onClick={() => void startRun()}>启动新的 Devin 尝试</button></div> : null}
  </article>;
}

function ExecutionPanel({ model, callbacks }: { model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks }) {
  const accepted = model.bundle.decisions.filter((decision) => decision.decision === "accepted");
  const isOwner = model.bundle.member.role === "owner";
  const canMutate = model.connection === "live" && model.bundle.room.status === "open" && !model.pendingMutation;
  return <div className="b2-tab-panel" aria-label="执行工作台">
    <PanelHeading eyebrow="房主批准后的执行" title="Decision Handoff" meta={`${model.bundle.actionBriefs.length} 个 Brief`} />
    <div className="b2-handoff-stats"><span><b>{accepted.length}</b> 已接受决定</span><span><b>{model.bundle.proposals.filter((item) => item.status === "open").length}</b> 待决提案</span><span><b>{model.bundle.devinRuns.length}</b> Devin Run</span></div>
    {isOwner && accepted.length ? <details className="b2-composer"><summary>把已接受决定转成 Action Brief</summary><form onSubmit={async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const draft: ActionBriefDraft = {
        decisionId: String(data.get("decisionId")), title: String(data.get("title") ?? "").trim(), objective: String(data.get("objective") ?? "").trim(), baselineSha: String(data.get("baselineSha") ?? "").trim(), allowedFiles: asLines(data.get("allowedFiles")), acceptanceCommands: asLines(data.get("acceptanceCommands")), forbiddenActions: asLines(data.get("forbiddenActions")), approvedContext: asLines(data.get("approvedContext")),
      };
      const result = callbacks.onCreateActionBrief?.(draft);
      if (result !== undefined && await mutationAccepted(result)) form.reset();
    }}>
      <label>已接受决定<select name="decisionId">{accepted.map((decision) => <option key={decision.id} value={decision.id}>{decision.rationale}</option>)}</select></label><label>标题<input name="title" required /></label><label>目标<textarea name="objective" rows={3} required /></label><label>Baseline SHA<input name="baselineSha" required pattern="(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})" title="请输入 40 或 64 位 Git commit SHA" placeholder="40 或 64 位 Git commit SHA" /></label><label>允许文件<textarea name="allowedFiles" rows={2} placeholder="每行一个路径" /></label><label>验收命令<textarea name="acceptanceCommands" rows={2} placeholder="每行一个命令" /></label><label>禁止事项<textarea name="forbiddenActions" rows={2} /></label><label>获准上下文<textarea name="approvedContext" rows={2} /></label><button className="b2-primary" type="submit" disabled={!canMutate || !callbacks.onCreateActionBrief}>创建 Brief</button>
    </form></details> : null}
    {model.bundle.actionBriefs.length ? model.bundle.actionBriefs.map((brief) => <ActionBriefCard key={brief.id} model={model} callbacks={callbacks} brief={brief} />) : <p className="b2-empty">房主接受提案后，可在这里创建受边界约束的 Action Brief。</p>}
    <OfflineDrafts model={model} callbacks={callbacks} />
  </div>;
}

export function B2Workbench({ model, callbacks, stars, paths, selected, activeTab, onTabChange, onOpenStructuredView }: B2WorkbenchProps) {
  const tabCounts = useMemo(() => ({
    discussion: model.bundle.proposals.filter((proposal) => proposal.status === "open").length,
    execution: model.bundle.actionBriefs.length,
  }), [model.bundle.actionBriefs.length, model.bundle.proposals]);
  return (
    <aside className="b2-live__workbench">
      <div className="b2-live__tabs" role="tablist" aria-label="房间工作台">
        <button type="button" role="tab" aria-selected={activeTab === "discussion"} onClick={() => onTabChange("discussion")}>讨论{tabCounts.discussion ? ` ${tabCounts.discussion}` : ""}</button>
        <button type="button" role="tab" aria-selected={activeTab === "node"} onClick={() => onTabChange("node")}>节点</button>
        <button type="button" role="tab" aria-selected={activeTab === "execution"} onClick={() => onTabChange("execution")}>执行{tabCounts.execution ? ` ${tabCounts.execution}` : ""}</button>
      </div>
      <section className="b2-live__room-status">
        <div><span className={`b2-live__connection is-${model.connection}`} /><strong>{model.connection === "live" ? "实时协作中" : model.connection === "connecting" ? "正在连接" : model.connection === "reconnecting" ? "正在重连" : "离线"}</strong></div>
        <small>{model.bundle.member.role === "owner" ? "房主" : "成员"} · seq {model.bundle.lastActivitySeq}</small>
      </section>
      <div className="b2-live__panel-scroll">
        {activeTab === "discussion" ? <DiscussionPanel model={model} callbacks={callbacks} /> : null}
        {activeTab === "node" ? <NodePanel model={model} callbacks={callbacks} stars={stars} paths={paths} selected={selected} /> : null}
        {activeTab === "execution" ? <ExecutionPanel model={model} callbacks={callbacks} /> : null}
      </div>
      {model.notice ? <p className="b2-live__notice" role="status">{model.notice}</p> : null}
      {onOpenStructuredView ? <button type="button" className="b2-live__structured" onClick={onOpenStructuredView}>打开旧版完整面板（回退）</button> : null}
    </aside>
  );
}

import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import {
  AtlasGraphView,
  type AtlasGraphEdge,
  type AtlasGraphNode,
  type AtlasSelection,
} from "@dialogue-atlas/atlas-graph";
import type {
  ActionBrief,
  ConnectionState,
  DevinRun,
  NodeStanceKind,
  PresenceMember,
  Proposal,
  ProposalDecision,
  PublicGraphNode,
  PublicPoint,
  TeamEdgeItem,
  TeamNodeItem,
} from "@dialogue-atlas/relay-contract";
import { buildRoomGraph } from "./room-graph";
import type {
  ActionBriefDraft,
  EdgeEditorState,
  NodeEditorState,
  OfflineDraft,
  ProposalDraft,
  RelayBootstrapModel,
  RelayReadyRoomModel,
  RelayRoomCallbacks,
  RelayRoomProps,
} from "./types";
import "./relay-room.css";

type RoomPanel = "review" | "proposals" | "handoff";

const STANCES: Array<{ value: NodeStanceKind; label: string; short: string }> = [
  { value: "confirm", label: "Confirm this item", short: "Confirm" },
  { value: "challenge", label: "Challenge this item", short: "Challenge" },
  { value: "needs_evidence", label: "Request more evidence", short: "Needs evidence" },
];

const NODE_KINDS: PublicGraphNode["kind"][] = ["anchor", "claim", "evidence", "decision", "action", "note"];

function asLines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readableTime(value?: string): string {
  if (!value) return "Not yet synced";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function mutationAccepted(result: void | boolean | Promise<boolean>): Promise<boolean> {
  return await result !== false;
}

function connectionCopy(state: ConnectionState): { title: string; detail: string } {
  switch (state) {
    case "live":
      return { title: "Live collaboration", detail: "Durable changes and room presence are connected." };
    case "connecting":
      return { title: "Connecting", detail: "Loading the room and opening the collaboration channel." };
    case "reconnecting":
      return { title: "Reconnecting", detail: "Local drafts are retained while fresh room activity is loaded." };
    case "offline":
      return { title: "Offline", detail: "New drafts stay on this device until a safe replay succeeds." };
  }
}

function BootstrapView({ model, callbacks }: { model: RelayBootstrapModel; callbacks: RelayRoomCallbacks }) {
  if (model.phase === "join_required") {
    return (
      <main className="relay-bootstrap">
        <section className="relay-bootstrap__card" aria-labelledby="join-title">
          <div className="relay-mark" aria-hidden="true">DA</div>
          <p className="relay-eyebrow">Dialogue Atlas Relay</p>
          <h1 id="join-title">Join a private review room</h1>
          <p>Relay uses an anonymous room identity. No email address or original conversation is requested here.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              callbacks.onJoin?.({
                inviteToken: String(data.get("inviteToken") ?? model.inviteToken ?? "").trim(),
                displayName: String(data.get("displayName") ?? "").trim(),
              });
            }}
          >
            <label>
              Display name
              <input name="displayName" required autoComplete="nickname" maxLength={48} placeholder="How teammates will see you" />
            </label>
            <label>
              Invite code
              <input name="inviteToken" required defaultValue={model.inviteToken} autoComplete="off" />
            </label>
            {model.message ? <p className="relay-form-error" role="alert">{model.message}</p> : null}
            <button className="relay-primary-button" type="submit">Join room</button>
          </form>
          <p className="relay-bootstrap__privacy">Only the approved Relay package and room contributions are loaded.</p>
        </section>
      </main>
    );
  }

  if (model.phase === "error") {
    return (
      <main className="relay-bootstrap">
        <section className="relay-bootstrap__card relay-bootstrap__card--error" role="alert">
          <div className="relay-mark" aria-hidden="true">!</div>
          <p className="relay-eyebrow">Room unavailable</p>
          <h1>Relay could not open this room</h1>
          <p>{model.message ?? "The room may be unavailable or this anonymous member may not have access."}</p>
          {model.retryable && callbacks.onRetry ? (
            <button className="relay-primary-button" type="button" onClick={callbacks.onRetry}>Try again</button>
          ) : null}
        </section>
      </main>
    );
  }

  const copy = model.phase === "anonymous_bootstrap"
    ? ["Starting an anonymous session", "No email sign-in is needed."]
    : model.phase === "joining"
      ? ["Joining the review room", "Validating the invite and room membership."]
      : ["Loading the approved package", "Fetching the latest durable room revision."];

  return (
    <main className="relay-bootstrap" aria-busy="true">
      <section className="relay-bootstrap__card" role="status" aria-live="polite">
        <div className="relay-mark relay-mark--pulse" aria-hidden="true">DA</div>
        <p className="relay-eyebrow">Dialogue Atlas Relay</p>
        <h1>{copy[0]}</h1>
        <p>{model.message ?? copy[1]}</p>
        <div className="relay-progress" aria-hidden="true"><span /></div>
      </section>
    </main>
  );
}

function ConnectionBanner({ model, callbacks }: { model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks }) {
  const copy = model.demoMode && model.connection === "live"
    ? { title: "Static interaction preview", detail: "No network adapter is connected; changes stay in this browser session." }
    : connectionCopy(model.connection);
  return (
    <div className={`relay-connection relay-connection--${model.connection}`} role="status" aria-live="polite">
      <span className="relay-connection__signal" aria-hidden="true" />
      <div>
        <strong>{copy.title}</strong>
        <span>{copy.detail}</span>
      </div>
      {model.connection !== "live" && callbacks.onReconnect ? (
        <button type="button" onClick={callbacks.onReconnect}>Reconnect</button>
      ) : null}
    </div>
  );
}

function MemberPresence({ members, currentUserId }: { members: readonly PresenceMember[]; currentUserId: string }) {
  return (
    <div className="relay-members" aria-label="Members online">
      <span className="relay-members__count">{members.length} online</span>
      <ul>
        {members.map((member) => (
          <li key={member.userId} title={member.activeNodeId ? `${member.displayName} is viewing ${member.activeNodeId}` : member.displayName}>
            <span className="relay-avatar" aria-hidden="true">{member.displayName.slice(0, 1).toUpperCase()}</span>
            <span>{member.displayName}{member.userId === currentUserId ? " (you)" : ""}</span>
            {member.activeNodeId ? <i aria-label={`Viewing node ${member.activeNodeId}`} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OfflineTray({ drafts, model, callbacks }: { drafts: readonly OfflineDraft[]; model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks }) {
  if (drafts.length === 0 && model.connection === "live") return null;
  return (
    <section className="relay-offline" aria-labelledby="offline-title">
      <div className="relay-offline__heading">
        <div>
          <p className="relay-eyebrow">Local safety queue</p>
          <h2 id="offline-title">{drafts.length} retained draft{drafts.length === 1 ? "" : "s"}</h2>
        </div>
        <span>Last sync: {readableTime(model.offline.lastSyncedAt)}</span>
      </div>
      {drafts.length === 0 ? <p>Connection is recovering. No unsaved room mutations are waiting.</p> : (
        <ul>
          {drafts.map((draft) => (
            <li key={draft.id} className={draft.status === "conflict" ? "has-conflict" : ""}>
              <div>
                <strong>{draft.label}</strong>
                <span>{draft.kind.replaceAll("_", " ")} · saved {readableTime(draft.savedAt)}</span>
                {draft.status === "conflict" ? (
                  <em>Revision conflict: local expected {draft.expectedRevision ?? "?"}, room has {draft.serverRevision ?? "?"}.</em>
                ) : null}
              </div>
              <div className="relay-offline__actions">
                {callbacks.onResolveDraft ? (
                  <button type="button" disabled={model.connection !== "live"} onClick={() => callbacks.onResolveDraft?.(draft.id, "retry_local")}>Retry local</button>
                ) : null}
                {draft.status === "conflict" && callbacks.onResolveDraft ? (
                  <button type="button" onClick={() => callbacks.onResolveDraft?.(draft.id, "accept_server")}>Use room version</button>
                ) : null}
                {callbacks.onDiscardDraft ? (
                  <button className="relay-text-button" type="button" onClick={() => callbacks.onDiscardDraft?.(draft.id)}>Discard</button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NodeEditor({ state, model, callbacks, onClose }: {
  state: NodeEditorState;
  model: RelayReadyRoomModel;
  callbacks: RelayRoomCallbacks;
  onClose(): void;
}) {
  const title = state.mode === "create" ? "Add a team node" : "Edit team node";
  return (
    <form
      className="relay-editor"
      aria-label={title}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const draft = {
          ...state.draft,
          label: String(data.get("label") ?? "").trim(),
          kind: String(data.get("kind")) as PublicGraphNode["kind"],
          modeIds: data.getAll("modeIds").map(String),
        };
        const result = state.mode === "create"
          ? callbacks.onCreateTeamNode?.(draft)
          : draft.id && draft.expectedRevision !== undefined
            ? callbacks.onUpdateTeamNode?.({ ...draft, id: draft.id, expectedRevision: draft.expectedRevision })
            : false;
        if (result !== undefined && await mutationAccepted(result)) onClose();
      }}
    >
      <div className="relay-section-heading">
        <div><p className="relay-eyebrow">Editable team layer</p><h3>{title}</h3></div>
        <button className="relay-icon-button" type="button" onClick={onClose} aria-label="Close team node editor">×</button>
      </div>
      <label>Label<input name="label" required maxLength={180} defaultValue={state.draft.label} autoFocus /></label>
      <label>Kind
        <select name="kind" defaultValue={state.draft.kind}>{NODE_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select>
      </label>
      <fieldset>
        <legend>Conversation regions</legend>
        {model.bundle.atlas.graph.modes.map((mode) => (
          <label className="relay-check" key={mode.id}>
            <input name="modeIds" value={mode.id} type="checkbox" defaultChecked={state.draft.modeIds.includes(mode.id)} />
            <span style={{ "--mode-color": mode.color } as React.CSSProperties}>{mode.label}</span>
          </label>
        ))}
      </fieldset>
      <button className="relay-primary-button" type="submit" disabled={state.mode === "create" ? !callbacks.onCreateTeamNode : !callbacks.onUpdateTeamNode}>{state.mode === "create" ? "Add to room" : "Save team node"}</button>
    </form>
  );
}

function EdgeEditor({ state, graphNodes, callbacks, onClose }: {
  state: EdgeEditorState;
  graphNodes: readonly AtlasGraphNode[];
  callbacks: RelayRoomCallbacks;
  onClose(): void;
}) {
  const title = state.mode === "create" ? "Connect two nodes" : "Edit team relationship";
  return (
    <form
      className="relay-editor"
      aria-label={title}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const draft = {
          ...state.draft,
          source: String(data.get("source")),
          target: String(data.get("target")),
          type: String(data.get("type") ?? "relates_to").trim(),
          label: String(data.get("label") ?? "").trim(),
        };
        const result = state.mode === "create"
          ? callbacks.onCreateTeamEdge?.(draft)
          : draft.id && draft.expectedRevision !== undefined
            ? callbacks.onUpdateTeamEdge?.({ ...draft, id: draft.id, expectedRevision: draft.expectedRevision })
            : false;
        if (result !== undefined && await mutationAccepted(result)) onClose();
      }}
    >
      <div className="relay-section-heading">
        <div><p className="relay-eyebrow">Editable team layer</p><h3>{title}</h3></div>
        <button className="relay-icon-button" type="button" onClick={onClose} aria-label="Close team edge editor">×</button>
      </div>
      <label>From
        <select name="source" defaultValue={state.draft.source}>{graphNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
      </label>
      <label>To
        <select name="target" defaultValue={state.draft.target}>{graphNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
      </label>
      <label>Relationship type<input name="type" required defaultValue={state.draft.type} /></label>
      <label>Visible label<input name="label" required maxLength={120} defaultValue={state.draft.label} /></label>
      <button className="relay-primary-button" type="submit" disabled={state.mode === "create" ? !callbacks.onCreateTeamEdge : !callbacks.onUpdateTeamEdge}>{state.mode === "create" ? "Add relationship" : "Save relationship"}</button>
    </form>
  );
}

function ProposalForm({ target, callbacks }: { target: AtlasGraphNode | AtlasGraphEdge; callbacks: RelayRoomCallbacks }) {
  const isNode = "kind" in target;
  const origin = !isNode && target.baseOrigin
    ? target.baseOrigin === "team" ? "team" : "source"
    : target.origin;
  return (
    <details className="relay-proposal-form">
      <summary>Suggest a semantic change</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const operation = String(data.get("operation")) as Proposal["operation"];
          const value = String(data.get("value") ?? "").trim();
          const draft: ProposalDraft = {
            targetType: `${origin === "source" ? "source" : "team"}_${isNode ? "node" : "edge"}` as Proposal["targetType"],
            targetId: target.id,
            operation,
            proposedValue: operation === "remove" ? { remove: true } : { value },
            rationale: String(data.get("rationale") ?? "").trim(),
          };
          const result = callbacks.onSubmitProposal?.(draft);
          if (result !== undefined && await mutationAccepted(result)) form.reset();
        }}
      >
        <label>Change
          <select name="operation" defaultValue="replace_label">
            <option value="replace_label">Replace label</option>
            {!isNode ? <option value="replace_relation">Replace relation</option> : null}
            <option value="reclassify">Reclassify</option>
            <option value="remove">Recommend removal</option>
          </select>
        </label>
        <label>Proposed value<input name="value" maxLength={240} placeholder="The exact replacement or classification" /></label>
        <label>Rationale<textarea name="rationale" required rows={3} placeholder="Why should the owner consider this change?" onFocus={() => callbacks.onTyping?.(target.id, true)} onBlur={() => callbacks.onTyping?.(target.id, false)} /></label>
        <button className="relay-primary-button" type="submit" disabled={!callbacks.onSubmitProposal}>Submit proposal</button>
      </form>
    </details>
  );
}

function ReviewPanel({ model, callbacks, selectedNode, selectedEdge, openNodeEditor, openEdgeEditor }: {
  model: RelayReadyRoomModel;
  callbacks: RelayRoomCallbacks;
  selectedNode?: AtlasGraphNode;
  selectedEdge?: AtlasGraphEdge;
  openNodeEditor(node: TeamNodeItem): void;
  openEdgeEditor(edge: TeamEdgeItem): void;
}) {
  if (!selectedNode && !selectedEdge) {
    return (
      <div className="relay-empty-state">
        <span aria-hidden="true">↖</span>
        <h3>Select a graph item</h3>
        <p>Review its approved evidence, record a stance, or propose a semantic change.</p>
      </div>
    );
  }

  if (selectedEdge) {
    const teamItem = model.bundle.teamItems.find((item): item is TeamEdgeItem => item.itemType === "edge" && item.id === selectedEdge.id);
    return (
      <section className="relay-inspector" aria-labelledby="edge-inspector-title">
        <div className="relay-inspector__origin">
          <span>{(selectedEdge.baseOrigin ?? selectedEdge.origin) === "team" ? "Team relationship" : "Published relationship"}</span>
          {selectedEdge.acceptedProposal ? <i>Owner-accepted overlay</i> : (selectedEdge.baseOrigin ?? selectedEdge.origin) === "source" ? <i>Meaning locked</i> : null}
        </div>
        <h3 id="edge-inspector-title">{selectedEdge.label || selectedEdge.type}</h3>
        <p className="relay-relation">{selectedEdge.source} <span>→</span> {selectedEdge.target}</p>
        <dl><div><dt>Type</dt><dd>{selectedEdge.type}</dd></div><div><dt>Open proposals</dt><dd>{selectedEdge.openProposals ?? 0}</dd></div></dl>
        {teamItem?.createdBy === model.bundle.member.userId && callbacks.onUpdateTeamEdge ? <button type="button" aria-label="Edit team relationship details" onClick={() => openEdgeEditor(teamItem)}>Edit team relationship</button> : null}
        <ProposalForm target={selectedEdge} callbacks={callbacks} />
      </section>
    );
  }

  const node = selectedNode!;
  const ownStance = model.bundle.stances.find((stance) => stance.nodeId === node.id && stance.userId === model.bundle.member.userId);
  const evidence = node.evidenceIds.map((id) => ({ id, value: model.bundle.atlas.evidence[id] })).filter((item) => item.value);
  const teamItem = model.bundle.teamItems.find((item): item is TeamNodeItem => item.itemType === "node" && item.id === node.id);
  return (
    <section className="relay-inspector" aria-labelledby="node-inspector-title">
      <div className="relay-inspector__origin">
        <span>{node.origin === "source" ? "Published source" : "Team contribution"}</span>
        {node.acceptedProposal ? <i>Owner-accepted overlay</i> : node.origin === "source" ? <i>Meaning locked</i> : <i>Editable by callbacks</i>}
      </div>
      <h3 id="node-inspector-title">{node.label}</h3>
      <p className="relay-kind">{node.kind} · {node.acts.join(" · ") || "team-authored"}</p>

      <fieldset className="relay-stances">
        <legend>Your stance</legend>
        {STANCES.map((stance) => (
          <button
            key={stance.value}
            type="button"
            aria-label={stance.label}
            aria-pressed={ownStance?.stance === stance.value}
            className={`relay-stance relay-stance--${stance.value}`}
            disabled={!callbacks.onSetStance}
            onClick={() => callbacks.onSetStance?.(node.id, stance.value)}
          >{stance.short}</button>
        ))}
      </fieldset>

      <div className="relay-review-counts" aria-label="Team stance totals">
        <span><b>{node.review?.confirm ?? 0}</b> confirm</span>
        <span><b>{node.review?.challenge ?? 0}</b> challenge</span>
        <span><b>{node.review?.needsEvidence ?? 0}</b> need evidence</span>
      </div>

      <section className="relay-evidence" aria-labelledby="evidence-title">
        <div className="relay-section-heading"><h4 id="evidence-title">Approved evidence</h4><span>{evidence.length}</span></div>
        {evidence.length ? evidence.map(({ id, value }) => (
          <blockquote key={id}><p>“{value?.excerpt}”</p>{value?.speaker ? <cite>{value.speaker}</cite> : null}</blockquote>
        )) : <p className="relay-muted">No excerpt was approved for this item.</p>}
      </section>

      {teamItem?.createdBy === model.bundle.member.userId && callbacks.onUpdateTeamNode ? <button type="button" aria-label="Edit team node details" onClick={() => openNodeEditor(teamItem)}>Edit team node</button> : null}
      <ProposalForm target={node} callbacks={callbacks} />
    </section>
  );
}

function ProposalPanel({ model, callbacks }: { model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks }) {
  const [focusedId, setFocusedId] = useState<string | null>(model.bundle.proposals[0]?.id ?? null);
  useEffect(() => {
    if (focusedId && !model.bundle.proposals.some((proposal) => proposal.id === focusedId)) setFocusedId(model.bundle.proposals[0]?.id ?? null);
  }, [focusedId, model.bundle.proposals]);
  const focused = model.bundle.proposals.find((proposal) => proposal.id === focusedId) ?? model.bundle.proposals[0];
  const decision = focused ? model.bundle.decisions.find((item) => item.proposalId === focused.id) : undefined;
  const comments = focused ? model.bundle.comments.filter((comment) => comment.proposalId === focused.id) : [];
  const isOwner = model.bundle.member.role === "owner";

  return (
    <section className="relay-proposals" aria-labelledby="proposal-panel-title">
      <div className="relay-section-heading">
        <div><p className="relay-eyebrow">Semantic changes</p><h3 id="proposal-panel-title">Proposals</h3></div>
        <span>{model.bundle.proposals.filter((proposal) => proposal.status === "open").length} open</span>
      </div>
      {model.bundle.proposals.length === 0 ? <div className="relay-empty-state"><h4>No proposals yet</h4><p>Select a node or relationship to suggest a change.</p></div> : (
        <>
          <div className="relay-proposal-list" role="list" aria-label="Room proposals">
            {model.bundle.proposals.map((proposal) => (
              <button key={proposal.id} type="button" role="listitem" className={proposal.id === focused?.id ? "is-active" : ""} onClick={() => setFocusedId(proposal.id)}>
                <span>{proposal.operation.replaceAll("_", " ")}</span>
                <strong>{proposal.rationale}</strong>
                <i>{proposal.status}</i>
              </button>
            ))}
          </div>
          {focused ? (
            <article className="relay-proposal-detail">
              <div className="relay-inspector__origin"><span>{focused.targetType.replaceAll("_", " ")}</span><i>revision {focused.revision}</i></div>
              <h4>{focused.operation.replaceAll("_", " ")}</h4>
              <p>{focused.rationale}</p>
              <pre>{JSON.stringify(focused.proposedValue, null, 2)}</pre>
              {decision ? <p className={`relay-decision relay-decision--${decision.decision}`}><strong>{decision.decision}</strong> · {decision.rationale}</p> : null}

              <section className="relay-comments" aria-labelledby={`comments-${focused.id}`}>
                <h5 id={`comments-${focused.id}`}>Comments</h5>
                {comments.length ? <ul>{comments.map((comment) => <li key={comment.id}><p>{comment.body}</p><span>{readableTime(comment.createdAt)}</span></li>)}</ul> : <p className="relay-muted">No comments yet.</p>}
                <form onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const data = new FormData(form);
                  const result = callbacks.onAppendComment?.(focused.id, String(data.get("body") ?? "").trim());
                  if (result !== undefined && await mutationAccepted(result)) form.reset();
                }}>
                  <label><span className="relay-visually-hidden">Add a comment</span><textarea name="body" required rows={2} placeholder="Add context or ask a concrete question" onFocus={() => callbacks.onTyping?.(focused.id, true)} onBlur={() => callbacks.onTyping?.(focused.id, false)} /></label>
                  {model.typingTargetIds?.includes(focused.id) ? <p className="relay-typing" role="status">A teammate is typing…</p> : null}
                  <button type="submit" disabled={!callbacks.onAppendComment}>Comment</button>
                </form>
              </section>

              {isOwner && focused.status === "open" ? (
                <form className="relay-owner-decision" onSubmit={(event) => event.preventDefault()}>
                  <label>Owner rationale<textarea name="ownerRationale" required rows={2} placeholder="Record why this decision is being made" onFocus={() => callbacks.onTyping?.(focused.id, true)} onBlur={() => callbacks.onTyping?.(focused.id, false)} /></label>
                  <div>
                    {(["accepted", "rejected", "deferred"] as ProposalDecision["decision"][]).map((status) => (
                      <button key={status} type="button" onClick={(event) => {
                        const form = event.currentTarget.closest("form");
                        const rationale = String(new FormData(form ?? undefined).get("ownerRationale") ?? "").trim();
                        if (!rationale) {
                          form?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
                          return;
                        }
                        callbacks.onDecideProposal?.(focused.id, status, rationale);
                      }} disabled={!callbacks.onDecideProposal}>{status}</button>
                    ))}
                  </div>
                </form>
              ) : null}
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}

function DevinRunCard({ run, events, callbacks, pending }: {
  run: DevinRun;
  events: RelayReadyRoomModel["devinEvents"][string];
  callbacks: RelayRoomCallbacks;
  pending: boolean;
}) {
  const requestSeed = useId().replaceAll(":", "");
  const [messageAttempt, setMessageAttempt] = useState(0);
  const clientRequestId = `devin_message_${requestSeed}_${messageAttempt}`;
  return (
    <article className="relay-devin-run">
      <div className="relay-section-heading">
        <div><p className="relay-eyebrow">Devin run</p><h5>{run.state.replaceAll("_", " ")}</h5></div>
        <span className={`relay-run-state relay-run-state--${run.state}`}>{run.checksState ? `checks ${run.checksState}` : "no check report"}</span>
      </div>
      <p>{run.statusDetail ?? (run.state === "not_configured" ? "No Devin service integration is configured for this room." : "No additional status detail was reported.")}</p>
      <dl>
        <div><dt>Updated</dt><dd>{readableTime(run.updatedAt)}</dd></div>
        <div><dt>Session ID</dt><dd>{run.externalSessionId ?? "No external session reported"}</dd></div>
        <div><dt>Official session</dt><dd>{run.externalUrl ? <a href={run.externalUrl} target="_blank" rel="noreferrer">Open Devin session ↗</a> : "No session link reported"}</dd></div>
        <div><dt>Pull request</dt><dd>{run.pullRequestUrl ? <a href={run.pullRequestUrl} target="_blank" rel="noreferrer">Open reported PR ↗</a> : "No pull request reported"}</dd></div>
      </dl>
      <details className="relay-event-log">
        <summary>Event log · {events?.length ?? 0}</summary>
        {events?.length ? <ol>{events.map((event) => <li key={event.id}><time>{readableTime(event.createdAt)}</time><p>{event.text}</p></li>)}</ol> : <p className="relay-muted">No server event has been reported.</p>}
      </details>
      {callbacks.onSendDevinMessage && ["queued", "working", "needs_input", "approval_needed"].includes(run.state) ? (
        <form onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const result = callbacks.onSendDevinMessage?.(run.id, String(data.get("message") ?? "").trim(), clientRequestId);
          const outcome = result === undefined ? "unknown" : await result;
          if (outcome === "accepted") {
            form.reset();
            setMessageAttempt((attempt) => attempt + 1);
          } else if (outcome === "rejected") {
            // A definitive provider rejection may be retried, but only under a
            // fresh idempotency key. Preserve the message so the owner can edit
            // or resubmit it without being trapped by the rejected request id.
            setMessageAttempt((attempt) => attempt + 1);
          }
        }}>
          <label>Message to the approved run<textarea name="message" required rows={2} onFocus={() => callbacks.onTyping?.(run.id, true)} onBlur={() => callbacks.onTyping?.(run.id, false)} /></label>
          <button type="submit" disabled={pending}>Send message</button>
        </form>
      ) : null}
    </article>
  );
}

function ActionBriefCard({ brief, model, callbacks }: { brief: ActionBrief; model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks }) {
  const runs = model.bundle.devinRuns.filter((run) => run.actionBriefId === brief.id);
  const latestRun = [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const requestSeed = useId().replaceAll(":", "");
  const [startAttempt, setStartAttempt] = useState(0);
  const startRequestId = `devin_start_${requestSeed}_${startAttempt}`;
  const canStart = runs.length === 0 || latestRun?.state === "not_configured" || latestRun?.state === "failed";

  async function startDevinAttempt() {
    const result = callbacks.onStartDevin?.(brief.id, startRequestId);
    if (result !== undefined && await mutationAccepted(result)) setStartAttempt((attempt) => attempt + 1);
  }
  return (
    <article className="relay-action-brief">
      <div className="relay-section-heading"><div><p className="relay-eyebrow">Action brief</p><h4>{brief.title}</h4></div><span>{brief.baselineSha || "baseline missing"}</span></div>
      <p>{brief.objective}</p>
      <dl>
        <div><dt>Allowed files</dt><dd>{brief.allowedFiles.join(", ") || "None specified"}</dd></div>
        <div><dt>Acceptance</dt><dd>{brief.acceptanceCommands.join(" · ") || "None specified"}</dd></div>
      </dl>
      {runs.length === 0 ? (
        <div className="relay-devin-empty">
          <p>No Devin run has been requested for this brief.</p>
          {model.bundle.member.role === "owner" && callbacks.onStartDevin ? <button type="button" disabled={Boolean(model.pendingMutation)} onClick={() => { void startDevinAttempt(); }}>Request Devin run</button> : null}
        </div>
      ) : runs.map((run) => <DevinRunCard key={run.id} run={run} events={model.devinEvents[run.id]} callbacks={callbacks} pending={Boolean(model.pendingMutation)} />)}
      {runs.length > 0 && canStart && model.bundle.member.role === "owner" && callbacks.onStartDevin ? (
        <div className="relay-devin-empty">
          <p>{latestRun?.state === "not_configured" ? "Provider access can be checked again after configuration changes." : "The failed attempt is terminal; a new attempt uses a distinct request identity."}</p>
          <button type="button" disabled={Boolean(model.pendingMutation)} onClick={() => { void startDevinAttempt(); }}>Start a new Devin attempt</button>
        </div>
      ) : null}
    </article>
  );
}

function HandoffPanel({ model, callbacks }: { model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks }) {
  const accepted = model.bundle.decisions.filter((decision) => decision.decision === "accepted");
  const isOwner = model.bundle.member.role === "owner";
  return (
    <section className="relay-handoff" aria-labelledby="handoff-title">
      <div className="relay-section-heading">
        <div><p className="relay-eyebrow">Decision handoff</p><h3 id="handoff-title">Approved work</h3></div>
        <span>{model.bundle.actionBriefs.length} brief{model.bundle.actionBriefs.length === 1 ? "" : "s"}</span>
      </div>
      <div className="relay-handoff__summary">
        <span><b>{model.bundle.stances.filter((stance) => stance.stance === "confirm").length}</b> confirmations</span>
        <span><b>{model.bundle.proposals.filter((proposal) => proposal.status === "open").length}</b> open proposals</span>
        <span><b>{accepted.length}</b> accepted changes</span>
      </div>

      {isOwner && accepted.length > 0 ? (
        <details className="relay-brief-form">
          <summary>Create an owner-approved action brief</summary>
          <form onSubmit={async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const draft: ActionBriefDraft = {
              decisionId: String(data.get("decisionId")),
              title: String(data.get("title") ?? "").trim(),
              objective: String(data.get("objective") ?? "").trim(),
              baselineSha: String(data.get("baselineSha") ?? "").trim(),
              allowedFiles: asLines(data.get("allowedFiles")),
              acceptanceCommands: asLines(data.get("acceptanceCommands")),
              forbiddenActions: asLines(data.get("forbiddenActions")),
              approvedContext: asLines(data.get("approvedContext")),
            };
            const result = callbacks.onCreateActionBrief?.(draft);
            if (result !== undefined && await mutationAccepted(result)) form.reset();
          }}>
            <label>Accepted decision<select name="decisionId">{accepted.map((decision) => <option key={decision.id} value={decision.id}>{decision.rationale}</option>)}</select></label>
            <label>Brief title<input name="title" required /></label>
            <label>Objective<textarea name="objective" rows={3} required /></label>
            <label>Baseline SHA<input name="baselineSha" required pattern="(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})" title="Enter a 40- or 64-character Git commit SHA" placeholder="Pinned 40- or 64-character commit SHA" /></label>
            <label>Allowed files<textarea name="allowedFiles" rows={3} placeholder="One path per line" /></label>
            <label>Acceptance commands<textarea name="acceptanceCommands" rows={3} placeholder="One command per line" /></label>
            <label>Forbidden actions<textarea name="forbiddenActions" rows={2} placeholder="One boundary per line" /></label>
            <label>Approved context<textarea name="approvedContext" rows={2} placeholder="Only context safe to send" /></label>
            <button className="relay-primary-button" type="submit" disabled={!callbacks.onCreateActionBrief}>Create brief</button>
          </form>
        </details>
      ) : null}

      {model.bundle.actionBriefs.length ? model.bundle.actionBriefs.map((brief) => <ActionBriefCard key={brief.id} brief={brief} model={model} callbacks={callbacks} />) : (
        <div className="relay-empty-state"><h4>No action brief yet</h4><p>An owner can turn an accepted proposal into a bounded implementation handoff.</p></div>
      )}
    </section>
  );
}

function ReadyRoom({ model, callbacks }: { model: RelayReadyRoomModel; callbacks: RelayRoomCallbacks }) {
  const graph = useMemo(() => {
    const base = buildRoomGraph(model.bundle);
    return model.dragPreviews && Object.keys(model.dragPreviews).length
      ? { ...base, layout: { ...base.layout, ...model.dragPreviews } }
      : base;
  }, [model.bundle, model.dragPreviews]);
  const [panel, setPanel] = useState<RoomPanel>("review");
  const [nodeEditor, setNodeEditor] = useState<NodeEditorState | null>(null);
  const [edgeEditor, setEdgeEditor] = useState<EdgeEditorState | null>(null);
  const roomCallbacks: RelayRoomCallbacks = model.connection === "live" ? callbacks : {
    onReconnect: callbacks.onReconnect,
    onCopyInvite: callbacks.onCopyInvite,
    onSelectionChange: callbacks.onSelectionChange,
    onResolveDraft: callbacks.onResolveDraft,
    onDiscardDraft: callbacks.onDiscardDraft,
  };
  const selectedNode = model.selection?.kind === "node" ? graph.nodes.find((node) => node.id === model.selection?.id) : undefined;
  const selectedEdge = model.selection?.kind === "edge" ? graph.edges.find((edge) => edge.id === model.selection?.id) : undefined;

  function select(selection: AtlasSelection) {
    callbacks.onSelectionChange?.(selection);
    if (selection) setPanel("review");
  }

  function openTeamNodeEditor(item: TeamNodeItem) {
    setNodeEditor({ mode: "edit", draft: { id: item.id, label: item.label, kind: item.kind, modeIds: item.modeIds, expectedRevision: item.revision } });
    setEdgeEditor(null);
    setPanel("review");
  }

  function openTeamEdgeEditor(item: TeamEdgeItem) {
    setEdgeEditor({ mode: "edit", draft: { id: item.id, source: item.source, target: item.target, type: item.type, label: item.label, expectedRevision: item.revision } });
    setNodeEditor(null);
    setPanel("review");
  }

  return (
    <main className="relay-room">
      <header className="relay-room__header">
        <div className="relay-brand">
          <div className="relay-mark" aria-hidden="true">DA</div>
          <div><p className="relay-eyebrow">Dialogue Atlas Relay</p><h1>{model.bundle.room.title}</h1></div>
        </div>
        <div className="relay-room__header-actions">
          {model.demoMode ? <span className="relay-demo-badge">Static demo fixture</span> : null}
          {model.bundle.room.status === "closed" ? <span className="relay-demo-badge">Closed</span> : null}
          <span className="relay-role">{model.bundle.member.role}</span>
          {model.invite ? <button type="button" onClick={() => callbacks.onCopyInvite?.(model.invite!.shareUrl)}>Copy invite</button> : null}
          {model.bundle.member.role === "owner" && model.bundle.room.status === "open" && callbacks.onCloseRoom ? (
            <button
              type="button"
              disabled={Boolean(model.pendingMutation)}
              onClick={() => {
                if (window.confirm("Close this room? Its history will remain readable, but no one can add new collaboration or redeem invites.")) {
                  void callbacks.onCloseRoom?.();
                }
              }}
            >Close room</button>
          ) : null}
        </div>
      </header>

      <ConnectionBanner model={model} callbacks={callbacks} />
      {model.notice ? <p className="relay-notice" role="status">{model.notice}</p> : null}
      <div className="relay-room__context">
        <MemberPresence members={model.presence} currentUserId={model.bundle.member.userId} />
        <p><strong>Room revision {model.bundle.room.revision}</strong><span> · package published {readableTime(model.bundle.atlas.publishedAt)}</span></p>
      </div>
      <OfflineTray drafts={model.offline.drafts} model={model} callbacks={callbacks} />

      <nav className="relay-room__tabs" aria-label="Room panels" role="tablist">
        {(["review", "proposals", "handoff"] as RoomPanel[]).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={panel === item} onClick={() => setPanel(item)}>
            {item === "review" ? "Review" : item === "proposals" ? `Proposals (${model.bundle.proposals.filter((proposal) => proposal.status === "open").length})` : "Handoff"}
          </button>
        ))}
      </nav>

      <div className="relay-room__workspace">
        <section className="relay-room__map" aria-label="Shared decision map">
          <AtlasGraphView
            graph={graph}
            selection={model.selection}
            presence={model.presence}
            callbacks={{
              onSelectionChange: select,
              onNodePositionChange: roomCallbacks.onSaveNodePosition,
              onNodeDragPreview: roomCallbacks.onPreviewNodePosition,
              onCreateTeamNode: roomCallbacks.onCreateTeamNode ? (position: PublicPoint) => {
                setNodeEditor({ mode: "create", draft: { label: "", kind: "note", modeIds: [], position } });
                setEdgeEditor(null);
                setPanel("review");
              } : undefined,
              onCreateTeamEdge: roomCallbacks.onCreateTeamEdge ? (source, target) => {
                setEdgeEditor({ mode: "create", draft: { source, target, type: "relates_to", label: "Relates to" } });
                setNodeEditor(null);
                setPanel("review");
              } : undefined,
              onEditTeamNode: (nodeId) => {
                const item = model.bundle.teamItems.find((entry): entry is TeamNodeItem => entry.itemType === "node" && entry.id === nodeId && entry.createdBy === model.bundle.member.userId);
                if (item) openTeamNodeEditor(item);
              },
              onEditTeamEdge: (edgeId) => {
                const item = model.bundle.teamItems.find((entry): entry is TeamEdgeItem => entry.itemType === "edge" && entry.id === edgeId && entry.createdBy === model.bundle.member.userId);
                if (item) openTeamEdgeEditor(item);
              },
            }}
          />
        </section>

        <aside className="relay-room__panel" role="tabpanel" aria-label={`${panel} panel`}>
          {model.pendingMutation ? <div className="relay-pending" role="status">Saving {model.pendingMutation}…</div> : null}
          {model.connection !== "live" ? <div className="relay-write-paused" role="status">Durable editing is paused while Relay reconnects. Text already entered in an open form stays here.</div> : null}
          {nodeEditor ? <NodeEditor state={nodeEditor} model={model} callbacks={roomCallbacks} onClose={() => setNodeEditor(null)} />
            : edgeEditor ? <EdgeEditor state={edgeEditor} graphNodes={graph.nodes} callbacks={roomCallbacks} onClose={() => setEdgeEditor(null)} />
              : panel === "review" ? <ReviewPanel model={model} callbacks={roomCallbacks} selectedNode={selectedNode} selectedEdge={selectedEdge} openNodeEditor={openTeamNodeEditor} openEdgeEditor={openTeamEdgeEditor} />
                : panel === "proposals" ? <ProposalPanel model={model} callbacks={roomCallbacks} />
                  : <HandoffPanel model={model} callbacks={roomCallbacks} />}
        </aside>
      </div>
    </main>
  );
}

export function RelayRoom({ model, callbacks = {} }: RelayRoomProps) {
  return model.phase === "ready" ? <ReadyRoom model={model} callbacks={callbacks} /> : <BootstrapView model={model} callbacks={callbacks} />;
}

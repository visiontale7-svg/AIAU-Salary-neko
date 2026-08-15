import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RelayPackageV1,
  ShareDraft,
  ShareReceipt,
} from "@dialogue-atlas/relay-contract";
import { atlasIpc, ipcErrorMessage } from "../ipc";
import { useAtlasStore } from "../store";
import { CloseIcon, RelayIcon } from "../components/icons";
import { createRelayInvite, publishRelayPackage, relayRuntimeConfig } from "./relayPublisher";

type PublishStage = "loading" | "review" | "publishing" | "failed";

export function RelayPublishDialog() {
  const snapshot = useAtlasStore((state) => state.snapshot);
  const activeRelayRoomId = useAtlasStore((state) => state.activeRelayRoomId);
  const setShare = useAtlasStore((state) => state.setShare);
  const openRelayRoom = useAtlasStore((state) => state.openRelayRoom);
  const setToast = useAtlasStore((state) => state.setToast);
  const [stage, setStage] = useState<PublishStage>("loading");
  const [draft, setDraft] = useState<ShareDraft | null>(null);
  const [title, setTitle] = useState("");
  const [nodeIds, setNodeIds] = useState<Set<string>>(new Set());
  const [evidenceIds, setEvidenceIds] = useState<Set<string>>(new Set());
  const [finalizedPackage, setFinalizedPackage] = useState<RelayPackageV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publications, setPublications] = useState<ShareReceipt[]>([]);
  const [publishTarget, setPublishTarget] = useState<"new" | "current">("new");
  const [mintingInviteRoomId, setMintingInviteRoomId] = useState<string | null>(null);
  const mounted = useRef(true);
  const runtimeConfigured = useMemo(() => {
    try {
      return relayRuntimeConfig() !== null;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    let active = true;
    setStage("loading");
    void Promise.all([
      atlasIpc.buildSharePreview(snapshot.id),
      atlasIpc.listSharePublications(snapshot.id),
    ]).then(([nextDraft, history]) => {
      if (!active) return;
      setDraft(nextDraft);
      setTitle(nextDraft.title);
      setNodeIds(new Set(nextDraft.nodes.filter((node) => node.selectedByDefault).map((node) => node.draftItemId)));
      setPublications(history);
      setStage("review");
    }).catch((reason) => {
      if (!active) return;
      setError(ipcErrorMessage(reason, "无法生成分享预览"));
      setStage("failed");
    });
    return () => { active = false; };
  }, [snapshot.id]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShare(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [setShare, stage]);

  const selectedEvidenceCount = evidenceIds.size;
  const selectedNodeCount = nodeIds.size;
  const currentSnapshotRoom = activeRelayRoomId
    ? publications.find((publication) => publication.roomId === activeRelayRoomId)
    : undefined;

  function toggleNode(nodeId: string, checked: boolean) {
    setNodeIds((current) => {
      const next = new Set(current);
      if (checked) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
    if (!checked && draft) {
      const node = draft.nodes.find((candidate) => candidate.draftItemId === nodeId);
      if (node) {
        setEvidenceIds((current) => {
          const next = new Set(current);
          node.evidence.forEach((evidence) => next.delete(evidence.draftEvidenceId));
          return next;
        });
      }
    }
  }

  async function publish() {
    if (!draft || selectedNodeCount === 0 || !runtimeConfigured) return;
    setStage("publishing");
    setError(null);
    try {
      const pkg = finalizedPackage ?? await atlasIpc.finalizeSharePackage(draft.draftId, {
        nodeDraftIds: [...nodeIds],
        evidenceDraftIds: [...evidenceIds],
        title: title.trim(),
      });
      setFinalizedPackage(pkg);
      const published = await publishRelayPackage(
        snapshot.id,
        pkg,
        publishTarget === "current" ? currentSnapshotRoom?.roomId : undefined,
      );
      const receipt = await atlasIpc.recordShareReceipt(published.receipt);
      if (mounted.current) {
        openRelayRoom(receipt.roomId, published.inviteUrl);
        setToast("协作空间已发布；原始 JSONL 与完整对话仍只保存在本机");
      } else {
        setToast("协作空间已在后台发布完成；可从发布历史打开房间");
      }
    } catch (reason) {
      const message = ipcErrorMessage(reason, "发布协作空间失败");
      if (mounted.current) {
        setError(message);
        setStage("failed");
      } else {
        setToast(message);
      }
    }
  }

  async function copyFreshInvite(roomId: string) {
    setMintingInviteRoomId(roomId);
    try {
      const inviteUrl = await createRelayInvite(roomId);
      await navigator.clipboard.writeText(inviteUrl);
      setToast("新的访客邀请链接已复制；24 小时内有效");
    } catch (reason) {
      setToast(ipcErrorMessage(reason, "无法创建新的邀请链接"));
    } finally {
      setMintingInviteRoomId(null);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShare(false);
      }}
    >
      <section className="modal is-wide relay-share-dialog panel-shadow" role="dialog" aria-modal="true" aria-labelledby="relay-share-title">
        <header className="modal-header">
          <div>
            <span>本地审批 · 公开协作投影</span>
            <h2 id="relay-share-title">发布 Relay 协作空间</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={() => setShare(false)}><CloseIcon size={17} /></button>
        </header>

        <div className="modal-body relay-share-body">
          {stage === "loading" ? <div className="relay-share-loading" role="status"><span className="analysis-spinner" /> 正在从 SQLite 重新生成公开预览…</div> : null}

          {draft ? <>
            <div className="relay-privacy-boundary">
              <RelayIcon size={22} />
              <div>
                <strong>只发布你批准的图谱投影</strong>
                <p>原始 JSONL、完整 transcript、本地 ID、路径、模型输出和 provider 配置不会上传。证据默认全部关闭。</p>
              </div>
            </div>

            <label htmlFor="relay-share-title-input">协作空间标题</label>
            <input id="relay-share-title-input" value={title} maxLength={160} disabled={stage === "publishing" || Boolean(finalizedPackage)} onChange={(event) => setTitle(event.target.value)} />

            <div className="relay-share-summary">
              <strong>{selectedNodeCount} / {draft.nodes.length} 个节点</strong>
              <span>{selectedEvidenceCount} 段逐字证据获准公开</span>
              <span>草稿 {new Date(draft.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 失效</span>
            </div>

            {currentSnapshotRoom ? <fieldset className="relay-publish-target" disabled={stage === "publishing" || Boolean(finalizedPackage)}>
              <legend>发布目标</legend>
              <label>
                <input
                  type="radio"
                  name="relay-publish-target"
                  value="new"
                  checked={publishTarget === "new"}
                  onChange={() => setPublishTarget("new")}
                />
                <span><strong>创建新的协作空间</strong><small>适合不同主题或希望重新开始讨论时使用。</small></span>
              </label>
              <label>
                <input
                  type="radio"
                  name="relay-publish-target"
                  value="current"
                  checked={publishTarget === "current"}
                  onChange={() => setPublishTarget("current")}
                />
                <span><strong>发布为当前图谱的既有房间新版本</strong><small>房间 {currentSnapshotRoom.roomId} · 旧版本及其讨论保留，新图谱使用独立协作叠层。</small></span>
              </label>
            </fieldset> : null}

            {draft.warnings.length ? <div className="warning-box">{draft.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}

            <div className="relay-share-list" aria-label="公开节点与证据审批">
              {draft.nodes.map((node) => {
                const selected = nodeIds.has(node.draftItemId);
                return <article key={node.draftItemId} className={selected ? "is-selected" : ""}>
                  <label className="relay-node-approval">
                    <input type="checkbox" checked={selected} disabled={stage === "publishing" || Boolean(finalizedPackage)} onChange={(event) => toggleNode(node.draftItemId, event.target.checked)} />
                    <span>
                      <strong>{node.label}</strong>
                      <em>{node.speaker === "user" ? "用户来源" : node.speaker === "assistant" ? "GPT 来源" : "图谱节点"} · {node.kind}</em>
                    </span>
                  </label>
                  {node.evidence.length ? <div className="relay-evidence-approvals">
                    {node.evidence.map((evidence) => <label key={evidence.draftEvidenceId}>
                      <input
                        type="checkbox"
                        checked={evidenceIds.has(evidence.draftEvidenceId)}
                        disabled={!selected || stage === "publishing" || Boolean(finalizedPackage)}
                        onChange={(event) => setEvidenceIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(evidence.draftEvidenceId);
                          else next.delete(evidence.draftEvidenceId);
                          return next;
                        })}
                      />
                      <span>
                        <b>{evidence.ownerKind === "edge" ? "关系证据" : "节点证据"} · {evidence.ownerLabel}</b>
                        {evidence.excerpt}
                      </span>
                    </label>)}
                  </div> : null}
                </article>;
              })}
            </div>

            {publications.length ? <details className="relay-publication-history">
              <summary>过去发布 {publications.length} 次</summary>
              {publications.map((receipt) => <div key={receipt.publicationId}>
                <span>{new Date(receipt.publishedAt).toLocaleString("zh-CN")}</span>
                <span className="relay-publication-actions">
                  <button type="button" onClick={() => openRelayRoom(receipt.roomId, receipt.relayUrl)}>打开房间</button>
                  <button type="button" disabled={mintingInviteRoomId === receipt.roomId} onClick={() => void copyFreshInvite(receipt.roomId)}>
                    {mintingInviteRoomId === receipt.roomId ? "创建中…" : "创建新邀请"}
                  </button>
                </span>
              </div>)}
            </details> : null}
          </> : null}
        </div>

        {error ? <div className="modal-error" role="alert">{error}</div> : null}
        {!runtimeConfigured && draft ? <div className="relay-config-note" role="status">
          本地公开预览已可用；Supabase 与 Relay Web 尚未配置，因此不会创建云端房间。
        </div> : null}
        <footer className="modal-actions relay-share-actions">
          <span>{finalizedPackage ? "公开包已锁定；再次提交只会重试同一发布请求。" : "证据必须逐段勾选，未选内容不会进入包。"}</span>
          <button type="button" onClick={() => setShare(false)}>{stage === "publishing" ? "关闭（后台发布）" : "关闭"}</button>
          <button type="button" className="primary" disabled={!draft || !runtimeConfigured || selectedNodeCount === 0 || !title.trim() || stage === "publishing"} onClick={() => void publish()}>
            {stage === "publishing" ? "正在创建房间…" : finalizedPackage ? "重试发布" : "批准并发布"}
          </button>
        </footer>
      </section>
    </div>
  );
}

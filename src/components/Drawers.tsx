import { useMemo, useState } from "react";
import type { AtlasSnapshot, ValidationIssue } from "../domain";
import { useAtlasStore } from "../store";
import { CloseIcon, EditIcon, SparkleIcon } from "./icons";

export function Drawers() {
  const drawer = useAtlasStore((state) => state.drawer);
  if (drawer === "context") return <ContextDrawer />;
  if (drawer === "outline") return <OutlineDrawer />;
  if (drawer === "modes") return <ModesDrawer />;
  if (drawer === "review") return <ReviewDrawer />;
  return null;
}

interface ReviewIssueGroup {
  key: string;
  issues: ValidationIssue[];
}

function groupReviewIssues(issues: ValidationIssue[]) {
  const groups: ReviewIssueGroup[] = [];
  const groupedWarnings = new Map<string, ReviewIssueGroup>();

  issues.forEach((issue, index) => {
    if (issue.severity !== "warning" || !issue.itemId) {
      groups.push({ key: `single-${index}`, issues: [issue] });
      return;
    }
    const fingerprint = `${issue.stage}\u0000${issue.severity}\u0000${issue.message}`;
    const existing = groupedWarnings.get(fingerprint);
    if (existing) {
      existing.issues.push(issue);
      return;
    }
    const group = { key: `warning-${index}`, issues: [issue] };
    groupedWarnings.set(fingerprint, group);
    groups.push(group);
  });

  return groups;
}

function reviewItemContext(snapshot: AtlasSnapshot, itemId: string | undefined) {
  if (!itemId) return null;
  const unit = snapshot.units.find((candidate) => candidate.id === itemId);
  if (unit) {
    return {
      badge: unit.turnId,
      label: unit.label,
      selection: { kind: "node" as const, id: itemId },
    };
  }
  const relation = snapshot.relations.find((candidate) => candidate.id === itemId);
  if (relation) {
    return {
      badge: "关系",
      label: relation.label || relation.type,
      selection: { kind: "edge" as const, id: itemId },
    };
  }
  return { badge: "项目", label: itemId, selection: null };
}

function ReviewDrawer() {
  const snapshot = useAtlasStore((state) => state.snapshot);
  const select = useAtlasStore((state) => state.select);
  const issues = snapshot.validationIssues ?? [];
  const issueGroups = useMemo(() => groupReviewIssues(issues), [issues]);
  return (
    <DrawerShell title="待复核项目" eyebrow="确定性校验结果">
      <p className="drawer-note">
        无证据、引用不匹配或端点无效的模型输出不会进入主图。相同的逐节点回退提示会合并计数；根错误仍单独保留。
      </p>
      {issues.length ? (
        <div className="review-list">
          {issueGroups.map((group) => {
            const issue = group.issues[0];
            const grouped = group.issues.length > 1;
            if (!grouped) {
              const context = reviewItemContext(snapshot, issue.itemId);
              return (
                <button
                  type="button"
                  key={group.key}
                  className={`review-item is-${issue.severity}`}
                  onClick={() => context?.selection && select(context.selection)}
                  disabled={!context?.selection}
                >
                  <span>{issue.severity === "error" ? "需复核" : "提示"}</span>
                  <strong>{issue.stage}</strong>
                  <p>{issue.message}</p>
                </button>
              );
            }
            return (
              <div
                key={group.key}
                className={`review-item is-${issue.severity}`}
                role="group"
                aria-label={`${issue.stage}：${group.issues.length} 个同类提示`}
              >
                <span>提示 ×{group.issues.length}</span>
                <strong>{issue.stage} · {group.issues.length} 个项目</strong>
                <p>{issue.message}</p>
                <details style={{ gridColumn: "1 / -1" }}>
                  <summary style={{ cursor: "pointer", color: "#536b8d", fontSize: "9px" }}>
                    展开 {group.issues.length} 个受影响项目
                  </summary>
                  <div className="transcript-list" style={{ marginTop: 8 }}>
                    {group.issues.map((groupedIssue, index) => {
                      const context = reviewItemContext(snapshot, groupedIssue.itemId);
                      return (
                        <button
                          type="button"
                          key={`${groupedIssue.itemId ?? "item"}-${index}`}
                          className="transcript-item"
                          onClick={() => context?.selection && select(context.selection)}
                          disabled={!context?.selection}
                        >
                          <span className="outline-turn">{context?.badge ?? "项目"}</span>
                          <span><strong>{context?.label ?? "无法定位的项目"}</strong></span>
                        </button>
                      );
                    })}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-review"><strong>没有待复核项目</strong><p>当前显示的节点和关系均通过了本地证据校验。</p></div>
      )}
    </DrawerShell>
  );
}

function DrawerShell({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  const setDrawer = useAtlasStore((state) => state.setDrawer);
  return (
    <aside className="right-drawer panel-shadow">
      <header>
        <div><span>{eyebrow}</span><h2>{title}</h2></div>
        <button type="button" aria-label="关闭侧栏" onClick={() => setDrawer("none")}><CloseIcon /></button>
      </header>
      <div className="drawer-content">{children}</div>
    </aside>
  );
}

function ContextDrawer() {
  const snapshot = useAtlasStore((state) => state.snapshot);
  const selection = useAtlasStore((state) => state.selection);
  const select = useAtlasStore((state) => state.select);
  const turn = useMemo(() => {
    if (!selection) return 14;
    if (selection.kind === "node") return snapshot.units.find((unit) => unit.id === selection.id)?.turnOrdinal ?? 14;
    const relation = snapshot.relations.find((item) => item.id === selection.id);
    return snapshot.units.find((unit) => unit.id === relation?.source)?.turnOrdinal ?? 14;
  }, [selection, snapshot.relations, snapshot.units]);
  const units = snapshot.units
    .filter((unit) => !unit.secondary && unit.kind !== "unresolved" && Math.abs(unit.turnOrdinal - turn) <= 2)
    .sort((a, b) => a.turnOrdinal - b.turnOrdinal || a.id.localeCompare(b.id));
  const sourceRows = useMemo(() => {
    if (!snapshot.sourceMessages?.length || !snapshot.visibleTurns?.length) return [];
    const messages = new Map(snapshot.sourceMessages.map((message) => [message.id, message]));
    return snapshot.visibleTurns
      .filter((visibleTurn) => Math.abs(visibleTurn.ordinal - turn) <= 2)
      .flatMap((visibleTurn) => visibleTurn.messageIds.flatMap((messageId) => {
        const message = messages.get(messageId);
        if (!message) return [];
        const unit = snapshot.units.find((candidate) =>
          candidate.sourceSpans.some((span) => span.messageId === messageId),
        );
        return [{ visibleTurn, message, unit }];
      }));
  }, [snapshot.sourceMessages, snapshot.units, snapshot.visibleTurns, turn]);
  return (
    <DrawerShell title="逐字上下文" eyebrow="Source of truth">
      <p className="drawer-note">这里只展示可见的用户／GPT 文本，不包含隐藏推理、工具调用或系统注入。</p>
      <div className="transcript-list">
        {sourceRows.length ? sourceRows.map(({ visibleTurn, message, unit }) => (
          <button
            type="button"
            key={message.id}
            className={`transcript-item ${selection?.kind === "node" && selection.id === unit?.id ? "is-selected" : ""}`}
            onClick={() => unit && select({ kind: "node", id: unit.id })}
          >
            <span className={`quote-speaker ${message.speaker}`}>{message.speaker === "user" ? "用户" : "GPT"}</span>
            <span><strong>T{String(visibleTurn.ordinal).padStart(2, "0")}{message.phase ? ` · ${message.phase}` : ""}</strong><p>{message.text}</p></span>
          </button>
        )) : units.map((unit) => (
          <button
            type="button"
            key={unit.id}
            className={`transcript-item ${selection?.kind === "node" && selection.id === unit.id ? "is-selected" : ""}`}
            onClick={() => select({ kind: "node", id: unit.id })}
          >
            <span className={`quote-speaker ${unit.speaker}`}>{unit.speaker === "user" ? "用户" : "GPT"}</span>
            <span><strong>{unit.turnId} · {unit.label}</strong><p>{unit.fullText}</p></span>
          </button>
        ))}
      </div>
    </DrawerShell>
  );
}

function OutlineDrawer() {
  const snapshot = useAtlasStore((state) => state.snapshot);
  const selection = useAtlasStore((state) => state.selection);
  const select = useAtlasStore((state) => state.select);
  const visible = snapshot.units
    .filter((unit) => !unit.secondary && unit.kind !== "unresolved")
    .sort((a, b) => a.turnOrdinal - b.turnOrdinal || a.id.localeCompare(b.id));
  return (
    <DrawerShell title="键盘大纲" eyebrow="等价线性视图">
      <p className="drawer-note">按轮次阅读与选择全部主要节点；关系仍可在证据面板逐条检查。</p>
      <ol className="outline-list">
        {visible.map((unit) => (
          <li key={unit.id}>
            <button
              type="button"
              className={selection?.kind === "node" && selection.id === unit.id ? "is-selected" : ""}
              onClick={() => select({ kind: "node", id: unit.id })}
            >
              <span className={`outline-turn ${unit.speaker}`}>{unit.turnId}</span>
              <span><strong>{unit.label}</strong><small>{unit.acts.join(" · ")}</small></span>
            </button>
          </li>
        ))}
      </ol>
    </DrawerShell>
  );
}

function ModesDrawer() {
  const snapshot = useAtlasStore((state) => state.snapshot);
  const applyCorrection = useAtlasStore((state) => state.applyCorrection);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <DrawerShell title="对话模式" eyebrow="可关闭的 AI 推断">
      <p className="drawer-note">模式不是聚类或固定阶段。它们允许重叠、重复出现、低置信或无归属。</p>
      <div className="mode-list">
        {snapshot.modes.map((mode) => {
          const count = snapshot.units.filter((unit) => unit.modeIds.includes(mode.id)).length;
          return (
            <div className="mode-item" key={mode.id}>
              <i style={{ background: mode.color }} />
              <div>
                {editing === mode.id ? (
                  <input
                    autoFocus
                    aria-label={`模式名称：${mode.label}`}
                    defaultValue={mode.label}
                    onBlur={(event) => {
                      const label = event.target.value.trim() || mode.label;
                      void applyCorrection({ kind: "update_mode", modeId: mode.id, label });
                      setEditing(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                ) : <strong>{mode.label}</strong>}
                <small>{mode.kind} · {count} 个片段 · {Math.round(mode.confidence * 100)}%</small>
              </div>
              <button type="button" aria-label={`修改模式 ${mode.label}`} onClick={() => setEditing(mode.id)}><EditIcon size={15} /></button>
            </div>
          );
        })}
      </div>
      <div className="ai-disclosure"><SparkleIcon size={16} /><span>柔色边界只表示模型 membership，不代表对话真的按阶段顺利推进。</span></div>
    </DrawerShell>
  );
}

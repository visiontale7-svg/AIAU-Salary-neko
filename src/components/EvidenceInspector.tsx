import { useMemo } from "react";
import { useAtlasStore } from "../store";
import { ChevronIcon, EditIcon } from "./icons";

export function EvidenceInspector() {
  const snapshot = useAtlasStore((state) => state.snapshot);
  const selection = useAtlasStore((state) => state.selection);
  const setDrawer = useAtlasStore((state) => state.setDrawer);
  const setCorrection = useAtlasStore((state) => state.setCorrection);

  const evidence = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "edge") {
      const relation = snapshot.relations.find((item) => item.id === selection.id);
      return relation
        ? {
            title: `原文证据 · ${relation.evidence.title ?? relation.label ?? relation.type}`,
            user: relation.evidence.user?.exactQuote,
            assistant: relation.evidence.assistant?.exactQuote,
            source: `${relation.type} · 置信度 ${Math.round(relation.confidence * 100)}%`,
          }
        : null;
    }
    const unit = snapshot.units.find((item) => item.id === selection.id);
    return unit
      ? {
          title: `原文证据 · ${unit.turnId} · ${unit.id}`,
          user: unit.speaker === "user" ? unit.sourceSpans[0]?.exactQuote : undefined,
          assistant: unit.speaker === "assistant" ? unit.sourceSpans[0]?.exactQuote : undefined,
          source: `${unit.acts.join(" · ")} · ${unit.provenance === "user" ? "人工纠正" : "AI 推断"}`,
        }
      : null;
  }, [selection, snapshot.relations, snapshot.units]);

  if (!evidence) {
    return (
      <aside className="evidence-inspector is-empty" aria-label="原文证据">
        <p>选择一个节点或关系，查看逐字证据。</p>
      </aside>
    );
  }

  return (
    <aside className="evidence-inspector panel-shadow" aria-label="原文证据">
      <div className="inspector-heading">
        <div>
          <strong>{evidence.title}</strong>
          <span>{evidence.source}</span>
        </div>
        <button type="button" aria-label="展开原文上下文" onClick={() => setDrawer("context")}>
          <ChevronIcon size={16} />
        </button>
      </div>
      <div className="evidence-quotes">
        {evidence.user ? (
          <div className="quote-row">
            <span className="quote-speaker user">用户</span>
            <p>“{evidence.user}”</p>
          </div>
        ) : null}
        {evidence.assistant ? (
          <div className="quote-row">
            <span className="quote-speaker assistant">GPT</span>
            <p>“{evidence.assistant}”</p>
          </div>
        ) : null}
      </div>
      <div className="inspector-actions">
        <button type="button" onClick={() => setDrawer("context")}>查看上下文</button>
        <button type="button" className="primary" onClick={() => setCorrection(true)}>
          <EditIcon size={14} /> 纠正分析
        </button>
      </div>
    </aside>
  );
}


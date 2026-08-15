import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useAtlasStore } from "../store";
import type { DialogueFlowNode } from "../graph/graphTypes";
import { SparkleIcon } from "./icons";
import { nodeDisplayLabel } from "./nodeLabel";

const actTone = (act: string) => {
  if (["质疑", "纠正", "反例", "撤回"].includes(act)) return "violet";
  if (["证据", "回答", "解释", "论证"].includes(act)) return "blue";
  if (["限定", "约束", "区分"].includes(act)) return "green";
  return "neutral";
};

export function DialogueNode({ data }: NodeProps<DialogueFlowNode>) {
  const { unit, selected, dimmed, matched } = data;
  const select = useAtlasStore((state) => state.select);
  const displayLabel = nodeDisplayLabel(unit.label, unit.provenance === "fallback");

  if (unit.kind === "unresolved") {
    return (
      <div className={`unresolved-node ${selected ? "is-selected" : ""}`}>
        <Handle id="t-left" type="target" position={Position.Left} />
        <button
          type="button"
          className="unresolved-button"
          aria-label={`节点：${displayLabel}`}
          onClick={() => select({ kind: "node", id: unit.id })}
        >
          ?
        </button>
      </div>
    );
  }

  return (
    <div
      className={[
        "dialogue-node-wrap",
        `kind-${unit.kind}`,
        selected ? "is-selected" : "",
        dimmed ? "is-dimmed" : "",
        matched ? "is-matched" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Handle id="s-top" type="source" position={Position.Top} />
      <Handle id="t-top" type="target" position={Position.Top} />
      <Handle id="s-right" type="source" position={Position.Right} />
      <Handle id="t-right" type="target" position={Position.Right} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} />
      <Handle id="t-bottom" type="target" position={Position.Bottom} />
      <Handle id="s-left" type="source" position={Position.Left} />
      <Handle id="t-left" type="target" position={Position.Left} />
      <button
        type="button"
        className="dialogue-node"
        aria-label={`节点：${displayLabel}；${unit.turnId}；${unit.speaker === "user" ? "用户" : "GPT"}`}
        onClick={() => select({ kind: "node", id: unit.id })}
      >
        <span className="node-kicker">
          <span>{unit.kind === "operation" ? "操作" : unit.turnId}</span>
          {unit.provenance === "user" ? <span className="corrected-mark">已纠正</span> : null}
          {unit.provenance === "fallback" ? <span className="fallback-mark">待复核</span> : null}
          {unit.state === "downgraded" ? <span className="state-mark">已降级</span> : null}
          {unit.state === "open" ? <span className="state-mark open">待验证</span> : null}
        </span>
        <span className="node-title">{displayLabel}</span>
        {unit.kind !== "operation" ? (
          <span className="node-footer">
            <span className={`speaker-mark ${unit.speaker}`}>
              {unit.speaker === "user" ? "用户" : "GPT"}
            </span>
            <span className="act-row">
              {unit.acts.slice(0, 2).map((act) => (
                <span key={act} className={`act-chip tone-${actTone(act)}`}>
                  {act}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span className="operation-footer">
            <SparkleIcon size={13} /> 位于模式岛之外
          </span>
        )}
      </button>
    </div>
  );
}
